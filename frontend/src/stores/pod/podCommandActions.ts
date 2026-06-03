import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type {
  Pod,
  Schedule,
  PodGoal,
  PodProvider,
  ProviderConfig,
} from "@/types";
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
import { generateRequestId } from "@/services/utils";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useConnectionStore } from "@/stores/connectionStore";
import type { useToast } from "@/composables/useToast";
import type { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import type { useSendCanvasAction } from "@/composables/useSendCanvasAction";

type ExecuteAction = ReturnType<typeof useCanvasWebSocketAction>["executeAction"];
type SendCanvasAction = ReturnType<typeof useSendCanvasAction>["sendCanvasAction"];
type ShowSuccessToast = ReturnType<typeof useToast>["showSuccessToast"];
type ShowErrorToast = ReturnType<typeof useToast>["showErrorToast"];
type Translate = (key: string, params?: Record<string, unknown>) => string;

interface PodCommandActionsDeps {
  executeAction: ExecuteAction;
  sendCanvasAction: SendCanvasAction;
  t: Translate;
  showSuccessToast: ShowSuccessToast;
  showErrorToast: ShowErrorToast;
  findPodById: (podId: string) => Pod | undefined;
  syncPodsFromBackend: (pods: Pod[]) => void;
  updatePod: (pod: Pod) => void;
  updatePodGoal: (podId: string, goal: PodGoal | null) => void;
}

export function createPodCommandActions(deps: PodCommandActionsDeps): {
  createPodWithBackend: (pod: Omit<Pod, "id">) => Promise<Pod | null>;
  deletePodWithBackend: (podId: string) => Promise<void>;
  loadPodsFromBackend: () => Promise<void>;
  syncPodPosition: (podId: string) => void;
  renamePodWithBackend: (podId: string, name: string) => Promise<boolean>;
  setScheduleWithBackend: (
    podId: string,
    schedule: Schedule | null,
  ) => Promise<Pod | null>;
  setGoalWithBackend: (
    podId: string,
    goal: PodGoal | null,
  ) => Promise<Pod | null>;
  setPodMemoryEnabledWithBackend: (
    podId: string,
    memoryEnabled: boolean,
  ) => Promise<Pod | null>;
  clearPodMemoryWithBackend: (podId: string) => Promise<Pod | null>;
  getPodMemory: (podId: string) => Promise<{
    success: boolean;
    memoryEnabled?: boolean;
    hasSummary?: boolean;
    summary?: string | null;
    summaryUpdatedAt?: string | null;
    error?: string;
  }>;
  updatePodProvider: (
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ) => Promise<Pod | null>;
} {
  async function createPodWithBackend(
    pod: Omit<Pod, "id">,
  ): Promise<Pod | null> {
    const result = await deps.executeAction<PodCreatePayload, PodCreatedPayload>(
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
        errorAction: deps.t("common.error.create"),
        errorMessage: deps.t("store.pod.createFailed"),
      },
    );

    if (!result.success) return null;
    if (!result.data.pod) {
      deps.showErrorToast(
        "Pod",
        deps.t("common.error.create"),
        deps.t("store.pod.createBackendFailed"),
      );
      return null;
    }

    deps.showSuccessToast("Pod", deps.t("common.success.create"), pod.name);
    return {
      ...result.data.pod,
      x: pod.x,
      y: pod.y,
      rotation: pod.rotation,
    };
  }

  async function deletePodWithBackend(podId: string): Promise<void> {
    const pod = deps.findPodById(podId);
    const podName = pod?.name ?? "Pod";

    const result = await deps.executeAction<PodDeletePayload, PodDeletedPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_DELETE,
        responseEvent: WebSocketResponseEvents.POD_DELETED,
        payload: { podId },
      },
      {
        errorCategory: "Pod",
        errorAction: deps.t("common.error.delete"),
        errorMessage: deps.t("store.pod.deleteFailed"),
      },
    );

    if (!result.success) return;
    deps.showSuccessToast("Pod", deps.t("common.success.delete"), podName);
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
      payload: { canvasId },
    });

    if (response.pods) {
      deps.syncPodsFromBackend(response.pods);
    }
  }

  function syncPodPosition(podId: string): void {
    const pod = deps.findPodById(podId);
    if (!pod) return;

    const canvasId = getActiveCanvasIdOrWarn("PodStore");
    if (!canvasId) return;

    websocketClient.emit<PodMovePayload>(WebSocketRequestEvents.POD_MOVE, {
      requestId: generateRequestId(),
      canvasId,
      podId,
      x: pod.x,
      y: pod.y,
    });
  }

  async function renamePodWithBackend(
    podId: string,
    name: string,
  ): Promise<boolean> {
    const result = await deps.executeAction<PodRenamePayload, PodRenamedPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_RENAME,
        responseEvent: WebSocketResponseEvents.POD_RENAMED,
        payload: { podId, name },
      },
      {
        errorCategory: "Pod",
        errorAction: deps.t("store.pod.renameFailed"),
        errorMessage: deps.t("store.pod.renameFailed"),
      },
    );

    if (!result.success) return false;
    deps.showSuccessToast("Pod", deps.t("store.pod.renamed"), name);
    return true;
  }

  async function setScheduleWithBackend(
    podId: string,
    schedule: Schedule | null,
  ): Promise<Pod | null> {
    const result = await deps.executeAction<
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
        errorAction: deps.t("common.error.operation"),
        errorMessage: deps.t("store.pod.scheduleFailed"),
      },
    );

    if (!result.success || !result.data.success || !result.data.pod) {
      return null;
    }

    const action =
      schedule === null
        ? deps.t("common.success.delete")
        : deps.t("common.success.update");
    deps.showSuccessToast("Schedule", action);
    return result.data.pod;
  }

  async function setGoalWithBackend(
    podId: string,
    goal: PodGoal | null,
  ): Promise<Pod | null> {
    const result = await deps.executeAction<PodSetGoalPayload, PodGoalSetPayload>(
      {
        requestEvent: WebSocketRequestEvents.POD_SET_GOAL,
        responseEvent: WebSocketResponseEvents.POD_GOAL_SET,
        payload: { podId, goal },
      },
      {
        errorCategory: "Pod",
        errorAction: deps.t("common.error.save"),
        errorMessage: deps.t("pod.goal.saveFailed"),
      },
    );

    if (!result.success || !result.data.success || !result.data.pod) {
      return null;
    }

    deps.updatePodGoal(podId, result.data.pod.goal ?? null);
    const action =
      goal === null
        ? deps.t("pod.goal.clearSuccess")
        : deps.t("pod.goal.saveSuccess");
    deps.showSuccessToast("Pod", deps.t("common.success.save"), action);
    return result.data.pod;
  }

  async function setPodMemoryEnabledWithBackend(
    podId: string,
    memoryEnabled: boolean,
  ): Promise<Pod | null> {
    const result = await deps.sendCanvasAction<
      PodSetMemoryEnabledPayload,
      PodMemoryEnabledSetPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_SET_MEMORY_ENABLED,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
      payload: { podId, memoryEnabled },
    });

    if (!result.success || !result.data.success || !result.data.pod) {
      deps.showErrorToast(
        "Pod",
        deps.t(
          memoryEnabled
            ? "canvas.podContextMenu.memoryEnableFailed"
            : "canvas.podContextMenu.memoryDisableFailed",
        ),
        deps.t(
          memoryEnabled
            ? "canvas.podContextMenu.memoryEnableFailedDesc"
            : "canvas.podContextMenu.memoryDisableFailedDesc",
        ),
      );
      return null;
    }

    deps.updatePod(result.data.pod);
    deps.showSuccessToast(
      "Pod",
      deps.t(
        memoryEnabled
          ? "canvas.podContextMenu.memoryEnabled"
          : "canvas.podContextMenu.memoryDisabled",
      ),
    );
    return result.data.pod;
  }

  async function clearPodMemoryWithBackend(podId: string): Promise<Pod | null> {
    const result = await deps.sendCanvasAction<
      PodClearMemoryPayload,
      PodMemoryClearedPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_CLEAR_MEMORY,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_CLEARED,
      payload: { podId },
    });

    if (!result.success || !result.data.success || !result.data.pod) {
      deps.showErrorToast(
        "Pod",
        deps.t("canvas.podContextMenu.clearMemoryFailed"),
        deps.t("canvas.podContextMenu.clearMemoryFailedDesc"),
      );
      return null;
    }

    deps.updatePod(result.data.pod);
    deps.showSuccessToast(
      "Pod",
      deps.t("canvas.podContextMenu.memoryCleared"),
      deps.t("canvas.podContextMenu.memoryClearedDesc"),
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
    const result = await deps.sendCanvasAction<
      PodGetMemoryPayload,
      PodMemoryResultPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_GET_MEMORY,
      responseEvent: WebSocketResponseEvents.POD_MEMORY_RESULT,
      payload: { podId },
    });

    if (!result.success || !result.data.success) {
      const errorMessage = result.success
        ? (result.data.error ?? deps.t("common.error.load"))
        : deps.t("common.error.load");
      deps.showErrorToast("Pod", deps.t("common.error.load"), errorMessage);
      return { success: false, error: errorMessage };
    }

    const pod = deps.findPodById(podId);
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

  async function updatePodProvider(
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ): Promise<Pod | null> {
    const pod = deps.findPodById(podId);
    if (!pod) return null;

    const result = await deps.sendCanvasAction<
      PodSetProviderPayload,
      PodProviderSetPayload
    >({
      requestEvent: WebSocketRequestEvents.POD_SET_PROVIDER,
      responseEvent: WebSocketResponseEvents.POD_PROVIDER_SET,
      payload: { podId, provider, providerConfig },
    });

    if (!result.success || !result.data.pod) {
      deps.showErrorToast(
        "Pod",
        deps.t("canvas.podContextMenu.providerSwitchFailed"),
        deps.t("canvas.podContextMenu.providerSwitchFailedDesc"),
      );
      return null;
    }

    deps.updatePod(result.data.pod);

    const providerLabels: Record<string, string> = {
      claude: "Claude",
      codex: "Codex",
      opencode: "OpenCode",
    };
    deps.showSuccessToast(
      "Pod",
      deps.t("canvas.podContextMenu.providerSwitched"),
      deps.t("canvas.podContextMenu.providerSwitchedDesc", {
        provider: providerLabels[provider] ?? provider,
      }),
    );

    const connectionStore = useConnectionStore();
    await connectionStore.reconcileSummaryModelsForPod(podId);
    return result.data.pod;
  }

  return {
    createPodWithBackend,
    deletePodWithBackend,
    loadPodsFromBackend,
    syncPodPosition,
    renamePodWithBackend,
    setScheduleWithBackend,
    setGoalWithBackend,
    setPodMemoryEnabledWithBackend,
    clearPodMemoryWithBackend,
    getPodMemory,
    updatePodProvider,
  };
}
