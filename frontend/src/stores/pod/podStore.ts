import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  Pod,
  PodStatus,
  Position,
  Schedule,
  TypeMenuState,
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
  PodMultiInstanceSetPayload,
  PodCreatedPayload,
  PodCreatePayload,
  PodDeletedPayload,
  PodDeletePayload,
  PodListPayload,
  PodListResultPayload,
  PodMovePayload,
  PodRenamedPayload,
  PodRenamePayload,
  PodScheduleSetPayload,
  PodSetMultiInstancePayload,
  PodSetSchedulePayload,
} from "@/types/websocket";
import { updatePodMcpServers as updatePodMcpServersApi } from "@/services/mcpApi";
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

const MAX_COORD = 100000;

const POD_FALLBACK_INITIAL_X = 100;
const POD_FALLBACK_X_SPACING = 300;
const POD_FALLBACK_INITIAL_Y = 150;
const POD_FALLBACK_Y_STAGGER = 100;

export const usePodStore = defineStore("pod", () => {
  const { executeAction } = useCanvasWebSocketAction();
  const { showSuccessToast, showErrorToast } = useToast();

  const pods = ref<Pod[]>(initialPods);
  const selectedPodId = ref<string | null>(null);
  const activePodId = ref<string | null>(null);
  const typeMenu = ref<TypeMenuState>({
    visible: false,
    position: null,
  });
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

  function enrichPod(pod: Pod, existingOutput?: string[]): Pod {
    return enrichPodFn(pod, existingOutput);
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

    const existing = pods.value[index]!;
    const mergedPod = {
      ...pod,
      output: pod.output !== undefined ? pod.output : existing.output,
    };

    if (!isValidPod(mergedPod)) {
      logger.warn("[PodStore] updatePod 驗證失敗，已忽略更新");
      return;
    }
    pods.value.splice(index, 1, mergedPod);
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
      output: pod.output,
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

  function updatePodStatus(id: string, status: PodStatus): void {
    const pod = findPodById(id);
    if (pod) {
      pod.status = status;
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

  function selectPod(podId: string | null): void {
    selectedPodId.value = podId;
  }

  function setActivePod(podId: string | null): void {
    activePodId.value = podId;
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

  function clearPodOutputsByIds(podIds: string[]): void {
    for (const podId of podIds) {
      updatePodField(podId, "output", []);
    }
  }

  /**
   * 切換指定 Pod 的 provider，並自動修正所有下游 connection 的 summaryModel。
   * 此方法為「使用者主動切換 provider」的唯一入口，初始化載入時不應呼叫，
   * 以避免 capability 尚未載入時誤重置 summaryModel。
   */
  async function updatePodProvider(
    podId: string,
    provider: string,
    providerConfig: Record<string, unknown>,
  ): Promise<void> {
    const pod = findPodById(podId);
    if (!pod) return;

    pod.provider = provider;
    pod.providerConfig = providerConfig as Pod["providerConfig"];

    const connectionStore = useConnectionStore();
    await connectionStore.reconcileSummaryModelsForPod(podId);
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

  function updatePodCommand(podId: string, commandId: string | null): void {
    updatePodField(podId, "commandId", commandId);
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

  async function setMultiInstanceWithBackend(
    podId: string,
    multiInstance: boolean,
  ): Promise<Pod | null> {
    const result = await executeAction<
      PodSetMultiInstancePayload,
      PodMultiInstanceSetPayload
    >(
      {
        requestEvent: WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
        responseEvent: WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
        payload: { podId, multiInstance },
      },
      {
        errorCategory: "Pod",
        errorAction: t("common.error.operation"),
        errorMessage: t("store.pod.multiInstanceFailed"),
      },
    );

    if (!result.success || !result.data.success || !result.data.pod)
      return null;

    showSuccessToast("Pod", t("common.success.update"));
    return result.data.pod;
  }

  function addPodFromEvent(pod: Pod): void {
    const enrichedPod = enrichPod(pod);

    if (!isValidPod(enrichedPod)) return;

    pods.value.push(enrichedPod);
  }

  function removePod(podId: string): void {
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

  // 切換 canvas 時重設 pod 相關狀態
  function resetForCanvasSwitch(): void {
    pods.value = [];
    selectedPodId.value = null;
    activePodId.value = null;
  }

  return {
    pods,
    selectedPodId,
    activePodId,
    typeMenu,
    scheduleFiredPodIds,
    selectedPod,
    podCount,
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
    updatePodStatus,
    movePod,
    syncPodPosition,
    renamePodWithBackend,
    setScheduleWithBackend,
    selectPod,
    setActivePod,
    showTypeMenu,
    hideTypeMenu,
    updatePodField,
    clearPodOutputsByIds,
    updatePodProvider,
    updatePodProviderConfigModel,
    updatePodThinkingLevel,
    updatePodRepository,
    updatePodCommand,
    updatePodPlugins,
    updatePodMcpServers,
    setMcpServersWithBackend,
    setMultiInstanceWithBackend,
    addPodFromEvent,
    removePod,
    updatePodPosition,
    updatePodName,
    triggerScheduleFiredAnimation,
    clearScheduleFiredAnimation,
    resetForCanvasSwitch,
  };
});
