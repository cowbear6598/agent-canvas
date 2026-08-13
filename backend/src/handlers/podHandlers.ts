import { WebSocketResponseEvents } from "../schemas";
import type {
  PodListResultPayload,
  PodGetResultPayload,
  PodMemoryEnabledSetPayload,
  PodMemoryResultPayload,
  PodMemoryClearedPayload,
  PodPluginsSetPayload,
} from "../types";
import { toPodPublicView } from "../types/index.js";
import type {
  PodCreatePayload,
  PodListPayload,
  PodGetPayload,
  PodMovePayload,
  PodRenamePayload,
  PodSetGoalPayload,
  PodSetProviderPayload,
  PodSetModelPayload,
  PodSetThinkingLevelPayload,
  PodSetFastModePayload,
  PodSetSchedulePayload,
  PodSetMemoryEnabledPayload,
  PodGetMemoryPayload,
  PodClearMemoryPayload,
  PodDeletePayload,
  PodSetPluginsPayload,
} from "../schemas";
import { podStore } from "../services/podStore.js";
import {
  createPodWithWorkspace,
  deletePodWithCleanup,
} from "../services/podService.js";
import { socketService } from "../services/socketService.js";
import { emitSuccess, emitError } from "../utils/websocketResponse.js";
import { logger } from "../utils/logger.js";
import {
  validatePod,
  withCanvasId,
  handleResultError,
} from "../utils/handlerHelpers.js";
import { createI18nError } from "../utils/i18nError.js";
import { memoryStateService } from "../services/memoryStateService.js";
import { dispatchApplicationCommand } from "../services/commands/applicationCommand.js";
import {
  podCommandService,
} from "../services/commands/podCommandService.js";

export { buildScheduleUpdates } from "../services/commands/podCommandService.js";

export const handlePodCreate = withCanvasId<PodCreatePayload>(
  WebSocketResponseEvents.POD_CREATED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodCreatePayload,
    requestId: string,
  ): Promise<void> => {
    const { name, x, y, rotation, provider, providerConfig, goal } = payload;

    const result = await createPodWithWorkspace(
      canvasId,
      { name, x, y, rotation, provider, providerConfig, goal },
      requestId,
    );

    if (
      handleResultError(
        result,
        connectionId,
        WebSocketResponseEvents.POD_CREATED,
        requestId,
        createI18nError("errors.podCreateFailed"),
        canvasId,
      )
    )
      return;

    logger.log("Pod", "Create", `已建立 Pod「${result.data.pod.name}」`);
  },
);

export const handlePodList = withCanvasId<PodListPayload>(
  WebSocketResponseEvents.POD_LIST_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    _payload: PodListPayload,
    requestId: string,
  ): Promise<void> => {
    const pods = podStore.list(canvasId).map(toPodPublicView);

    const response: PodListResultPayload = {
      requestId,
      success: true,
      pods,
    };

    emitSuccess(
      connectionId,
      WebSocketResponseEvents.POD_LIST_RESULT,
      response,
    );
  },
);

export async function handlePodGet(
  connectionId: string,
  payload: PodGetPayload,
  requestId: string,
): Promise<void> {
  const { podId } = payload;

  const pod = validatePod(
    connectionId,
    podId,
    WebSocketResponseEvents.POD_GET_RESULT,
    requestId,
  );

  if (!pod) {
    return;
  }

  const response: PodGetResultPayload = {
    requestId,
    success: true,
    pod: toPodPublicView(pod),
  };

  emitSuccess(connectionId, WebSocketResponseEvents.POD_GET_RESULT, response);
}

export const handlePodDelete = withCanvasId<PodDeletePayload>(
  WebSocketResponseEvents.POD_DELETED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodDeletePayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const result = await deletePodWithCleanup(canvasId, podId, requestId);
    handleResultError(
      result,
      connectionId,
      WebSocketResponseEvents.POD_DELETED,
      requestId,
      createI18nError("errors.podDeleteFailed"),
      canvasId,
    );
  },
);

export const handlePodMove = withCanvasId<PodMovePayload>(
  WebSocketResponseEvents.POD_MOVED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodMovePayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, x, y } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MOVED,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.move({ canvasId, podId, requestId, x, y }),
    );
  },
);

export const handlePodSetGoal = withCanvasId<PodSetGoalPayload>(
  WebSocketResponseEvents.POD_GOAL_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetGoalPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, goal } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_GOAL_SET,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.setGoal({ canvasId, podId, requestId, goal }),
    );
  },
);

export const handlePodRename = withCanvasId<PodRenamePayload>(
  WebSocketResponseEvents.POD_RENAMED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodRenamePayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, name } = payload;
    const trimmedName = name.trim();

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_RENAMED,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.rename({
        canvasId,
        podId,
        requestId,
        existingPod,
        name: trimmedName,
      }),
    );
  },
);

export const handlePodSetProvider = withCanvasId<PodSetProviderPayload>(
  WebSocketResponseEvents.POD_PROVIDER_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetProviderPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, provider, providerConfig } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_PROVIDER_SET,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.setProvider({
        canvasId,
        podId,
        requestId,
        provider,
        providerConfig,
      }),
    );
  },
);

export const handlePodSetModel = withCanvasId<PodSetModelPayload>(
  WebSocketResponseEvents.POD_MODEL_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetModelPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, model } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MODEL_SET,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.setModel({
        canvasId,
        podId,
        requestId,
        existingPod,
        model,
      }),
    );
  },
);

export const handlePodSetThinkingLevel =
  withCanvasId<PodSetThinkingLevelPayload>(
    WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
    async (
      connectionId: string,
      canvasId: string,
      payload: PodSetThinkingLevelPayload,
      requestId: string,
    ): Promise<void> => {
      const { podId, level } = payload;

      const existingPod = validatePod(
        connectionId,
        podId,
        WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
        requestId,
      );
      if (!existingPod) return;

      dispatchApplicationCommand(
        podCommandService.setThinkingLevel({
          canvasId,
          podId,
          requestId,
          existingPod,
          level,
        }),
      );
    },
  );

export const handlePodSetFastMode = withCanvasId<PodSetFastModePayload>(
  WebSocketResponseEvents.POD_FAST_MODE_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetFastModePayload,
    requestId: string,
  ): Promise<void> => {
    const existingPod = validatePod(
      connectionId,
      payload.podId,
      WebSocketResponseEvents.POD_FAST_MODE_SET,
      requestId,
    );
    if (!existingPod) return;

    dispatchApplicationCommand(
      podCommandService.setFastMode({
        canvasId,
        podId: payload.podId,
        requestId,
        existingPod,
        enabled: payload.enabled,
      }),
    );
  },
);

export const handlePodSetSchedule = withCanvasId<PodSetSchedulePayload>(
  WebSocketResponseEvents.POD_SCHEDULE_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetSchedulePayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, schedule } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_SCHEDULE_SET,
      requestId,
    );
    if (!existingPod) {
      return;
    }

    dispatchApplicationCommand(
      podCommandService.setSchedule({
        canvasId,
        podId,
        requestId,
        existingPod,
        schedule,
      }),
    );
  },
);

export const handlePodSetMemoryEnabled =
  withCanvasId<PodSetMemoryEnabledPayload>(
    WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
    async (
      connectionId: string,
      canvasId: string,
      payload: PodSetMemoryEnabledPayload,
      requestId: string,
    ): Promise<void> => {
      const { podId, memoryEnabled } = payload;

      const pod = validatePod(
        connectionId,
        podId,
        WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
        requestId,
      );
      if (!pod) {
        return;
      }

      memoryStateService.setPodMemoryEnabled(podId, memoryEnabled);

      const updatedPod = podStore.getById(canvasId, podId);
      if (!updatedPod) {
        emitError(
          connectionId,
          WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
          createI18nError("errors.podUpdateFailed", { id: podId }),
          canvasId,
          requestId,
          podId,
          "INTERNAL_ERROR",
        );
        return;
      }

      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
        {
          requestId,
          canvasId,
          success: true,
          pod: toPodPublicView(updatedPod),
        } satisfies PodMemoryEnabledSetPayload,
      );
    },
  );

export const handlePodGetMemory = withCanvasId<PodGetMemoryPayload>(
  WebSocketResponseEvents.POD_MEMORY_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodGetMemoryPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MEMORY_RESULT,
      requestId,
    );
    if (!pod) {
      return;
    }

    const state = memoryStateService.getPodState(podId);
    emitSuccess(connectionId, WebSocketResponseEvents.POD_MEMORY_RESULT, {
      requestId,
      canvasId,
      success: true,
      podId,
      memoryEnabled: state?.memoryEnabled ?? false,
      hasSummary: state?.hasSummary ?? false,
      summary: state?.summary ?? null,
      summaryUpdatedAt: state?.summaryUpdatedAt ?? null,
    } satisfies PodMemoryResultPayload);
  },
);

export const handlePodClearMemory = withCanvasId<PodClearMemoryPayload>(
  WebSocketResponseEvents.POD_MEMORY_CLEARED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodClearMemoryPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MEMORY_CLEARED,
      requestId,
    );
    if (!pod) {
      return;
    }

    memoryStateService.clearPodSummary(podId);
    memoryStateService.clearScopeMaintenanceRecords("pod", podId);

    const updatedPod = podStore.getById(canvasId, podId);
    if (!updatedPod) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_MEMORY_CLEARED,
        createI18nError("errors.podUpdateFailed", { id: podId }),
        canvasId,
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_MEMORY_CLEARED,
      {
        requestId,
        canvasId,
        success: true,
        pod: toPodPublicView(updatedPod),
      } satisfies PodMemoryClearedPayload,
    );
  },
);

export const handlePodSetPlugins = withCanvasId<PodSetPluginsPayload>(
  WebSocketResponseEvents.POD_PLUGINS_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetPluginsPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, pluginIds } = payload;

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_PLUGINS_SET,
      requestId,
    );
    if (!existingPod) {
      return;
    }

    const result = podStore.update(canvasId, podId, {
      pluginIds,
    });
    if (!result) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        createI18nError("errors.podUpdateFailed", { id: podId }),
        canvasId,
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    const successResponse: PodPluginsSetPayload = {
      requestId,
      canvasId,
      success: true,
      pod: toPodPublicView(result.pod),
    };
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_PLUGINS_SET,
      successResponse,
    );
  },
);
