import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  Pod,
  Position,
  Schedule,
  TypeMenuState,
  PodGoal,
  PodProvider,
  ProviderConfig,
} from "@/types";
import { initialPods } from "@/data/initialPods";
import { generateRequestId } from "@/services/utils";
import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type {
  PodCreatedPayload,
  PodCreatePayload,
  PodDeletedPayload,
  PodDeletePayload,
  PodListPayload,
  PodListResultPayload,
  PodMovePayload,
  PodGoalSetPayload,
  PodGetMemoryPayload,
  PodClearMemoryPayload,
  PodMemoryClearedPayload,
  PodMemoryResultPayload,
  PodProviderSetPayload,
  PodRenamedPayload,
  PodRenamePayload,
  PodScheduleSetPayload,
  PodSetMemoryEnabledPayload,
  PodSetGoalPayload,
  PodMemoryEnabledSetPayload,
  PodSetProviderPayload,
  PodSetSchedulePayload,
} from "@/types/websocket";
import { updatePodMcpServers as updatePodMcpServersApi } from "@/services/mcpApi";
import { invalidatePodMcpAvailabilityCache } from "@/services/managedMcpApi";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import {
  isValidPod as isValidPodFn,
  enrichPod as enrichPodFn,
  isValidModelName,
} from "@/lib/podValidation";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { logger } from "@/utils/logger";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";

const MAX_COORD = 100000;

const POD_FALLBACK_INITIAL_X = 100;
const POD_FALLBACK_X_SPACING = 300;
const POD_FALLBACK_INITIAL_Y = 150;
const POD_FALLBACK_Y_STAGGER = 100;

function areGoalsEqual(
  left: PodGoal | null | undefined,
  right: PodGoal | null | undefined,
): boolean {
  const leftTodos = left?.todos ?? [];
  const rightTodos = right?.todos ?? [];

  if (leftTodos.length !== rightTodos.length) return false;

  return leftTodos.every((todo, index) => {
    const other = rightTodos[index];
    return other && todo.id === other.id && todo.text === other.text;
  });
}

export const usePodStore = defineStore("pod", () => {
  const { executeAction } = useCanvasWebSocketAction();
  const { sendCanvasAction } = useSendCanvasAction();
  const { showSuccessToast, showErrorToast } = useToast();

  const pods = ref<Pod[]>(initialPods);
  const selectedPodId = ref<string | null>(null);
  const activePodId = ref<string | null>(null);
  const typeMenu = ref<TypeMenuState>({
    visible: false,
    position: null,
  });
  const goalEditorPodId = ref<string | null>(null);
  const scheduleFiredPodIds = ref<Set<string>>(new Set());

  /**
   * Pod id → Pod 的 Map，隨 pods 陣列自動更新。
   * 讓 selectedPod 與 getPodById 查找由 O(n) 降為 O(1)。
   */
  const podMap = computed((): Map<string, Pod> => {
    const map = new Map<string, Pod>();
    for (const pod of pods.value) {
      map.set(pod.id, pod);
    }
    return map;
  });

  const selectedPod = computed(
    (): Pod | null => podMap.value.get(selectedPodId.value ?? "") ?? null,
  );

  const podCount = computed((): number => pods.value.length);

  const goalEditorPod = computed(
    (): Pod | null => podMap.value.get(goalEditorPodId.value ?? "") ?? null,
  );

  const getPodById = computed(() => (id: string): Pod | undefined => {
    return podMap.value.get(id);
  });

  const getNextPodName = computed(() => (): string => {
    const existingNames = new Set(pods.value.map((pod) => pod.name));
    let i = 1;
    while (existingNames.has(`Pod ${i}`)) {
      i++;
    }
    return `Pod ${i}`;
  });

  const isScheduleFiredAnimating = computed(() => (podId: string): boolean => {
    return scheduleFiredPodIds.value.has(podId);
  });

  function findPodById(podId: string): Pod | undefined {
    return podMap.value.get(podId);
  }

  function enrichPod(pod: Pod): Pod {
    return enrichPodFn(pod);
  }

  function isValidPod(pod: Pod): boolean {
    return isValidPodFn(pod);
  }

  function addPod(pod: Pod): void {
    if (isValidPod(pod)) {
      pods.value.push(pod);
    }
  }

  function updatePod(pod: Pod): void {
    const index = pods.value.findIndex(
      (existingPod) => existingPod.id === pod.id,
    );
    if (index === -1) return;
    const existingPod = pods.value[index];
    if (!existingPod) return;

    if (!isValidPod(pod)) {
      logger.warn("[PodStore] updatePod 驗證失敗，已忽略更新");
      return;
    }

    if (
      existingPod.provider !== pod.provider ||
      !areGoalsEqual(existingPod.goal ?? null, pod.goal ?? null)
    ) {
      invalidatePodMcpAvailabilityCache(existingPod.provider, existingPod.id);
      if (existingPod.provider !== pod.provider) {
        invalidatePodMcpAvailabilityCache(pod.provider, pod.id);
      }
    }

    pods.value.splice(index, 1, pod);
  }

  async function createPodWithBackend(
    pod: Omit<Pod, "id">,
  ): Promise<Pod | null> {
    const result = await executeAction<PodCreatePayload, PodCreatedPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_CREATE,
        responseEvent: WebSocketResponseEvents.POD_CREATED,
        payload: {
          name: pod.name,
          x: pod.x,
          y: pod.y,
          rotation: pod.rotation,
          provider: pod.provider,
          providerConfig: pod.providerConfig,
          goal: pod.goal ?? null,
        },
      },
      {
        errorCategory: "Pod",
        errorAction: t("common.error.create"),
        errorMessage: t("store.pod.createFailed"),
      },
    );

    if (!result.success) return null;

    if (!result.data.pod) {
      const errorMessage = t("store.pod.createBackendFailed");
      showErrorToast("Pod", t("common.error.create"), errorMessage);
      return null;
    }

    showSuccessToast("Pod", t("common.success.create"), pod.name);

    return {
      ...result.data.pod,
      x: pod.x,
      y: pod.y,
      rotation: pod.rotation,
    };
  }

  async function deletePodWithBackend(id: string): Promise<void> {
    const pod = findPodById(id);
    const podName = pod?.name ?? "Pod";

    const result = await executeAction<PodDeletePayload, PodDeletedPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_DELETE,
        responseEvent: WebSocketResponseEvents.POD_DELETED,
        payload: { podId: id },
      },
      {
        errorCategory: "Pod",
        errorAction: t("common.error.delete"),
        errorMessage: t("store.pod.deleteFailed"),
      },
    );

    if (!result.success) return;

    showSuccessToast("Pod", t("common.success.delete"), podName);
  }

  function syncPodsFromBackend(podsData: Pod[]): void {
    invalidatePodMcpAvailabilityCache();
    const enrichedPods = podsData.map((pod, index) => {
      const enriched = enrichPod(pod);
      return {
        ...enriched,
        x: pod.x ?? POD_FALLBACK_INITIAL_X + index * POD_FALLBACK_X_SPACING,
        y:
          pod.y ??
          POD_FALLBACK_INITIAL_Y + (index % 2) * POD_FALLBACK_Y_STAGGER,
      };
    });
    pods.value = enrichedPods.filter((pod) => isValidPod(pod));
  }

  async function loadPodsFromBackend(): Promise<void> {
    const canvasId = getActiveCanvasIdOrWarn("PodStore");
    if (!canvasId) return;

    const response = await createWebSocketRequest<
      PodListPayload,
      PodListResultPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_LIST,
      responseEvent: WebSocketResponseEvents.POD_LIST_RESULT,
      payload: {
        canvasId,
      },
    });

    if (response.pods) {
      syncPodsFromBackend(response.pods);
    }
  }

  function movePod(id: string, x: number, y: number): void {
    const pod = findPodById(id);
    if (!pod) return;

    const safeX = Number.isFinite(x)
      ? Math.max(-MAX_COORD, Math.min(MAX_COORD, x))
      : pod.x;
    const safeY = Number.isFinite(y)
      ? Math.max(-MAX_COORD, Math.min(MAX_COORD, y))
      : pod.y;

    pod.x = safeX;
    pod.y = safeY;
  }

  function syncPodPosition(id: string): void {
    const pod = findPodById(id);
    if (!pod) return;

    const canvasId = getActiveCanvasIdOrWarn("PodStore");
    if (!canvasId) return;

    websocketClient.emit<PodMovePayload>(WebSocketRequestEvents.POD_MOVE, {
      requestId: generateRequestId(),
      canvasId,
      podId: id,
      x: pod.x,
      y: pod.y,
    });
  }

  async function renamePodWithBackend(
    podId: string,
    name: string,
  ): Promise<boolean> {
    const result = await executeAction<PodRenamePayload, PodRenamedPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_RENAME,
        responseEvent: WebSocketResponseEvents.POD_RENAMED,
        payload: { podId, name },
      },
      {
        errorCategory: "Pod",
        errorAction: t("store.pod.renameFailed"),
        errorMessage: t("store.pod.renameFailed"),
      },
    );

    if (!result.success) return false;

    showSuccessToast("Pod", t("store.pod.renamed"), name);
    return true;
  }

  async function setScheduleWithBackend(
    podId: string,
    schedule: Schedule | null,
  ): Promise<Pod | null> {
    const result = await executeAction<
      PodSetSchedulePayload,
      PodScheduleSetPayload
    >(
      {
        requestEvent: WebSocketRequestEvents.POD_SET_SCHEDULE,
        responseEvent: WebSocketResponseEvents.POD_SCHEDULE_SET,
        payload: { podId, schedule },
      },
      {
        errorCategory: "Schedule",
        errorAction: t("common.error.operation"),
        errorMessage: t("store.pod.scheduleFailed"),
      },
    );

    if (!result.success || !result.data.success || !result.data.pod)
      return null;

    const action =
      schedule === null
        ? t("common.success.delete")
        : t("common.success.update");
    showSuccessToast("Schedule", action);
    return result.data.pod;
  }

  async function setGoalWithBackend(
    podId: string,
    goal: PodGoal | null,
  ): Promise<Pod | null> {
    const result = await executeAction<PodSetGoalPayload, PodGoalSetPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_SET_GOAL,
        responseEvent: WebSocketResponseEvents.POD_GOAL_SET,
        payload: { podId, goal },
      },
      {
        errorCategory: "Pod",
        errorAction: t("common.error.save"),
        errorMessage: t("pod.goal.saveFailed"),
      },
    );

    if (!result.success || !result.data.success || !result.data.pod) {
      return null;
    }

    updatePodGoal(podId, result.data.pod.goal ?? null);

    const action =
      goal === null ? t("pod.goal.clearSuccess") : t("pod.goal.saveSuccess");
    showSuccessToast("Pod", t("common.success.save"), action);
    return result.data.pod;
  }

  async function setPodMemoryEnabledWithBackend(
    podId: string,
    memoryEnabled: boolean,
  ): Promise<Pod | null> {
    const result = await sendCanvasAction<
      PodSetMemoryEnabledPayload,
      PodMemoryEnabledSetPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_SET_MEMORY_ENABLED,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
      payload: { podId, memoryEnabled },
    });

    if (!result.success || !result.data.success || !result.data.pod) {
      showErrorToast(
        "Pod",
        t(
          memoryEnabled
            ? "canvas.podContextMenu.memoryEnableFailed"
            : "canvas.podContextMenu.memoryDisableFailed",
        ),
        t(
          memoryEnabled
            ? "canvas.podContextMenu.memoryEnableFailedDesc"
            : "canvas.podContextMenu.memoryDisableFailedDesc",
        ),
      );
      return null;
    }

    updatePod(result.data.pod);

    showSuccessToast(
      "Pod",
      t(
        memoryEnabled
          ? "canvas.podContextMenu.memoryEnabled"
          : "canvas.podContextMenu.memoryDisabled",
      ),
    );

    return result.data.pod;
  }

  async function clearPodMemoryWithBackend(podId: string): Promise<Pod | null> {
    const result = await sendCanvasAction<
      PodClearMemoryPayload,
      PodMemoryClearedPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_CLEAR_MEMORY,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_CLEARED,
      payload: { podId },
    });

    if (!result.success || !result.data.success || !result.data.pod) {
      showErrorToast(
        "Pod",
        t("canvas.podContextMenu.clearMemoryFailed"),
        t("canvas.podContextMenu.clearMemoryFailedDesc"),
      );
      return null;
    }

    updatePod(result.data.pod);
    showSuccessToast(
      "Pod",
      t("canvas.podContextMenu.memoryCleared"),
      t("canvas.podContextMenu.memoryClearedDesc"),
    );

    return result.data.pod;
  }

  async function getPodMemory(podId: string): Promise<{
    success: boolean;
    memoryEnabled?: boolean;
    hasSummary?: boolean;
    summary?: string | null;
    summaryUpdatedAt?: string | null;
    error?: string;
  }> {
    const result = await sendCanvasAction<
      PodGetMemoryPayload,
      PodMemoryResultPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_GET_MEMORY,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_RESULT,
      payload: { podId },
    });

    if (!result.success || !result.data.success) {
      const errorMessage = result.success
        ? (result.data.error ?? t("common.error.load"))
        : t("common.error.load");
      showErrorToast("Pod", t("common.error.load"), errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }

    const pod = findPodById(podId);
    if (pod) {
      pod.memoryEnabled = result.data.memoryEnabled;
      pod.hasPodMemory = result.data.hasSummary;
    }

    return {
      success: true,
      memoryEnabled: result.data.memoryEnabled,
      hasSummary: result.data.hasSummary,
      summary: result.data.summary,
      summaryUpdatedAt: result.data.summaryUpdatedAt,
    };
  }

  function selectPod(podId: string | null): void {
    selectedPodId.value = podId;
  }

  function setActivePod(podId: string | null): void {
    activePodId.value = podId;
  }

  function openGoalEditor(podId: string): void {
    if (!findPodById(podId)) return;
    goalEditorPodId.value = podId;
  }

  function closeGoalEditor(): void {
    goalEditorPodId.value = null;
  }

  function showTypeMenu(position: Position): void {
    typeMenu.value = {
      visible: true,
      position,
    };
  }

  function hideTypeMenu(): void {
    typeMenu.value = {
      visible: false,
      position: null,
    };
  }

  function updatePodField<K extends keyof Pod>(
    podId: string,
    field: K,
    value: Pod[K],
  ): void {
    const pod = findPodById(podId);
    if (!pod) return;
    pod[field] = value;
  }

  /**
   * 切換指定 Pod 的 provider。
   * 成功後以後端回傳的 pod 更新本地狀態，並收斂所有下游 connection 的 summaryModel。
   */
  async function updatePodProvider(
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ): Promise<Pod | null> {
    const pod = findPodById(podId);
    if (!pod) return null;

    const result = await sendCanvasAction<
      PodSetProviderPayload,
      PodProviderSetPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_SET_PROVIDER,
      responseEvent: WebSocketResponseEvents.POD_PROVIDER_SET,
      payload: { podId, provider, providerConfig },
    });

    if (!result.success || !result.data.pod) {
      showErrorToast(
        "Pod",
        t("canvas.podContextMenu.providerSwitchFailed"),
        t("canvas.podContextMenu.providerSwitchFailedDesc"),
      );
      return null;
    }

    updatePod(result.data.pod);

    const providerLabels: Record<string, string> = {
      claude: "Claude",
      codex: "Codex",
      opencode: "OpenCode",
    };
    showSuccessToast(
      "Pod",
      t("canvas.podContextMenu.providerSwitched"),
      t("canvas.podContextMenu.providerSwitchedDesc", {
        provider: providerLabels[provider] ?? provider,
      }),
    );

    const connectionStore = useConnectionStore();
    await connectionStore.reconcileSummaryModelsForPod(podId);
    return result.data.pod;
  }

  /** 將 model 寫入 providerConfig.model（provider-agnostic） */
  function updatePodProviderConfigModel(podId: string, model: string): void {
    const pod = findPodById(podId);
    if (!pod) return;

    // 驗證 model 名稱格式，防止非法字串（例如 CLI 旗標注入）
    if (!isValidModelName(model)) {
      logger.warn(`[PodStore] model 不合法，已拒絕更新：${model}`);
      return;
    }

    // 切 model 後 thinkingLevel 由後端 pod:model:set 事件覆蓋
    pod.providerConfig = { ...pod.providerConfig, model };
  }

  /**
   * 將 thinkingLevel 寫入 providerConfig.thinkingLevel。
   * 不做格式驗證：thinkingLevel 沒有 CLI 注入風險，後端回傳已是白名單枚舉。
   */
  function updatePodThinkingLevel(podId: string, level: string): void {
    const pod = findPodById(podId);
    if (!pod) return;

    pod.providerConfig = { ...pod.providerConfig, thinkingLevel: level };
  }

  function updatePodRepository(
    podId: string,
    repositoryId: string | null,
  ): void {
    updatePodField(podId, "repositoryId", repositoryId);
  }

  function setRepositoryMemoryState(
    repositoryId: string,
    state: {
      hasRepoMemory?: boolean;
      repoMemoryEnabled?: boolean;
    },
  ): void {
    for (const pod of pods.value) {
      if (pod.repositoryId !== repositoryId) {
        continue;
      }

      if (state.hasRepoMemory !== undefined) {
        pod.hasRepoMemory = state.hasRepoMemory;
      }
      if (state.repoMemoryEnabled !== undefined) {
        pod.repoMemoryEnabled = state.repoMemoryEnabled;
      }
    }
  }

  function updatePodGoal(podId: string, goal: PodGoal | null): void {
    const pod = findPodById(podId);
    if (!pod) return;

    const enrichedPod = enrichPod({
      ...pod,
      goal,
    });
    updatePod(enrichedPod);
  }

  function updatePodPlugins(podId: string, pluginIds: string[]): void {
    updatePodField(podId, "pluginIds", pluginIds);
  }

  /** 純前端狀態更新：設定 pod 的 MCP server 名稱清單（不發 WebSocket） */
  function updatePodMcpServers(podId: string, names: string[]): void {
    updatePodField(podId, "mcpServerNames", names);
  }

  /**
   * Backend-sync：呼叫 updatePodMcpServers API 後更新本地狀態。
   * 失敗時 throw McpServerNamesError，由呼叫端決定是否 rollback。
   */
  async function setMcpServersWithBackend(
    podId: string,
    names: string[],
  ): Promise<void> {
    const canvasId = getActiveCanvasIdOrWarn("PodStore");
    if (!canvasId) return;

    await updatePodMcpServersApi(canvasId, podId, names);
    updatePodMcpServers(podId, names);
  }

  function addPodFromEvent(pod: Pod): void {
    const enrichedPod = enrichPod(pod);

    if (!isValidPod(enrichedPod)) return;

    pods.value.push(enrichedPod);
  }

  function removePod(podId: string): void {
    const pod = findPodById(podId);
    if (pod) {
      invalidatePodMcpAvailabilityCache(pod.provider, pod.id);
    }

    pods.value = pods.value.filter((pod) => pod.id !== podId);

    if (selectedPodId.value === podId) {
      selectedPodId.value = null;
    }

    if (activePodId.value === podId) {
      activePodId.value = null;
    }

    const connectionStore = useConnectionStore();
    connectionStore.deleteConnectionsByPodId(podId);
  }

  function updatePodPosition(podId: string, x: number, y: number): void {
    const pod = findPodById(podId);
    if (pod) {
      pod.x = x;
      pod.y = y;
    }
  }

  function updatePodName(podId: string, name: string): void {
    updatePodField(podId, "name", name);
  }

  function triggerScheduleFiredAnimation(podId: string): void {
    // 先在原 Set 上操作，再以 new Set() 淺複製觸發響應式更新，避免展開整個 Set
    const next = new Set(scheduleFiredPodIds.value);
    next.delete(podId);
    next.add(podId);
    scheduleFiredPodIds.value = next;
  }

  function clearScheduleFiredAnimation(podId: string): void {
    // 同上，淺複製後刪除再賦值觸發響應式
    const next = new Set(scheduleFiredPodIds.value);
    next.delete(podId);
    scheduleFiredPodIds.value = next;
  }

  function resetForCanvasSwitch(): void {
    invalidatePodMcpAvailabilityCache();
    pods.value = [];
    selectedPodId.value = null;
    activePodId.value = null;
    goalEditorPodId.value = null;
  }

  return {
    pods,
    selectedPodId,
    activePodId,
    typeMenu,
    goalEditorPodId,
    scheduleFiredPodIds,
    selectedPod,
    podCount,
    goalEditorPod,
    getPodById,
    getNextPodName,
    isScheduleFiredAnimating,
    findPodById,
    enrichPod,
    isValidPod,
    addPod,
    updatePod,
    createPodWithBackend,
    deletePodWithBackend,
    syncPodsFromBackend,
    loadPodsFromBackend,
    movePod,
    syncPodPosition,
    renamePodWithBackend,
    setScheduleWithBackend,
    setGoalWithBackend,
    setPodMemoryEnabledWithBackend,
    getPodMemory,
    clearPodMemoryWithBackend,
    selectPod,
    setActivePod,
    openGoalEditor,
    closeGoalEditor,
    showTypeMenu,
    hideTypeMenu,
    updatePodField,
    updatePodProvider,
    updatePodProviderConfigModel,
    updatePodThinkingLevel,
    updatePodRepository,
    setRepositoryMemoryState,
    updatePodGoal,
    updatePodPlugins,
    updatePodMcpServers,
    setMcpServersWithBackend,
    addPodFromEvent,
    removePod,
    updatePodPosition,
    updatePodName,
    triggerScheduleFiredAnimation,
    clearScheduleFiredAnimation,
    resetForCanvasSwitch,
  };
});
