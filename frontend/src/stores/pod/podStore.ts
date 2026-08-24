import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  Pod,
  Position,
  TypeMenuState,
  PodGoal,
} from "@/types";
import { registerRepositoryMemorySyncHandlers } from "./repositoryMemorySync";
import { initialPods } from "@/data/initialPods";
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
import { createPodCommandActions } from "./podCommandActions";
import {
  getMcpAvailabilityInvalidationProviders,
  updatePodProviderConfigModelState,
  updatePodThinkingLevelState,
} from "./podUpdateEffects";

const MAX_COORD = 100000;

const POD_FALLBACK_INITIAL_X = 100;
const POD_FALLBACK_X_SPACING = 300;
const POD_FALLBACK_INITIAL_Y = 150;
const POD_FALLBACK_Y_STAGGER = 100;

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

    for (const provider of getMcpAvailabilityInvalidationProviders(
      existingPod,
      pod,
    )) {
      invalidatePodMcpAvailabilityCache(provider, pod.id);
    }

    pods.value.splice(index, 1, pod);
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

  const commandActions = createPodCommandActions({
    executeAction,
    sendCanvasAction,
    t,
    showSuccessToast,
    showErrorToast,
    findPodById,
    syncPodsFromBackend,
    updatePod,
    updatePodGoal: (podId, goal) => updatePodGoal(podId, goal),
  });

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

  /** 將 model 寫入 providerConfig.model（provider-agnostic） */
  function updatePodProviderConfigModel(podId: string, model: string): void {
    const pod = findPodById(podId);
    if (!pod) return;

    // 驗證 model 名稱格式，防止非法字串（例如 CLI 旗標注入）
    if (!isValidModelName(model)) {
      logger.warn(`[PodStore] model 不合法，已拒絕更新：${model}`);
      return;
    }

    pod.providerConfig = updatePodProviderConfigModelState(
      pod.providerConfig,
      model,
    );
  }

  /**
   * 將 thinkingLevel 寫入 providerConfig.thinkingLevel。
   * 不做格式驗證：thinkingLevel 沒有 CLI 注入風險，後端回傳已是白名單枚舉。
   */
  function updatePodThinkingLevel(podId: string, level: string): void {
    const pod = findPodById(podId);
    if (!pod) return;

    pod.providerConfig = updatePodThinkingLevelState(
      pod.providerConfig,
      level,
    );
  }

  function updatePodFastMode(podId: string, enabled: boolean): void {
    const pod = findPodById(podId);
    if (!pod) return;
    pod.fastModeEnabled = enabled;
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

  registerRepositoryMemorySyncHandlers({
    applyRepositoryMemoryState: setRepositoryMemoryState,
    applyPods: (updatedPods) => {
      for (const pod of updatedPods) {
        updatePod(pod);
      }
    },
  });

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

  function updatePodCodexSkills(podId: string, skillKeys: string[]): void {
    updatePodField(podId, "codexSkillKeys", skillKeys);
  }

  /** 純前端狀態更新：設定 pod 的 MCP server 名稱清單（不發 WebSocket） */
  function updatePodMcpServers(podId: string, names: string[]): void {
    updatePodField(podId, "mcpServerNames", names);
  }

  function updatePodAgentCanvasMcpEnabled(
    podId: string,
    enabled: boolean,
  ): void {
    updatePodField(podId, "agentCanvasMcpEnabled", enabled);
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
    createPodWithBackend: commandActions.createPodWithBackend,
    deletePodWithBackend: commandActions.deletePodWithBackend,
    syncPodsFromBackend,
    loadPodsFromBackend: commandActions.loadPodsFromBackend,
    movePod,
    syncPodPosition: commandActions.syncPodPosition,
    renamePodWithBackend: commandActions.renamePodWithBackend,
    setScheduleWithBackend: commandActions.setScheduleWithBackend,
    setGoalWithBackend: commandActions.setGoalWithBackend,
    setPodMemoryEnabledWithBackend:
      commandActions.setPodMemoryEnabledWithBackend,
    getPodMemory: commandActions.getPodMemory,
    clearPodMemoryWithBackend: commandActions.clearPodMemoryWithBackend,
    selectPod,
    setActivePod,
    openGoalEditor,
    closeGoalEditor,
    showTypeMenu,
    hideTypeMenu,
    updatePodField,
    updatePodProvider: commandActions.updatePodProvider,
    updatePodProviderConfigModel,
    updatePodThinkingLevel,
    updatePodFastMode,
    updatePodRepository,
    setRepositoryMemoryState,
    updatePodGoal,
    updatePodPlugins,
    updatePodCodexSkills,
    updatePodMcpServers,
    updatePodAgentCanvasMcpEnabled,
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
