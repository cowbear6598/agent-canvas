import { WebSocketResponseEvents } from "../schemas";
import type {
  PodListResultPayload,
  PodGetResultPayload,
  PodScheduleSetPayload,
  PodPluginsSetPayload,
  Pod,
  ScheduleConfig,
} from "../types";
import { isPodBusy } from "../types/index.js";
import type {
  PodCreatePayload,
  PodListPayload,
  PodGetPayload,
  PodMovePayload,
  PodRenamePayload,
  PodSetModelPayload,
  PodSetSchedulePayload,
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

export const handlePodCreate = withCanvasId<PodCreatePayload>(
  WebSocketResponseEvents.POD_CREATED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodCreatePayload,
    requestId: string,
  ): Promise<void> => {
    const { name, x, y, rotation, provider, providerConfig } = payload;

    const result = await createPodWithWorkspace(
      canvasId,
      { name, x, y, rotation, provider, providerConfig },
      requestId,
    );

    if (
      handleResultError(
        result,
        connectionId,
        WebSocketResponseEvents.POD_CREATED,
        requestId,
        createI18nError("errors.podCreateFailed"),
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
    const pods = podStore.list(canvasId);

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
    pod,
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
    );
  },
);

function handlePodUpdate<TResponse>(
  connectionId: string,
  canvasId: string,
  podId: string,
  updates: Partial<Omit<Pod, "id">>,
  requestId: string,
  responseEvent: WebSocketResponseEvents,
  createResponse: (pod: Pod) => TResponse,
): void {
  const existingPod = validatePod(
    connectionId,
    podId,
    responseEvent,
    requestId,
  );
  if (!existingPod) {
    return;
  }

  const result = podStore.update(canvasId, podId, updates);
  if (!result) {
    emitError(
      connectionId,
      responseEvent,
      createI18nError("errors.podUpdateFailed", { id: podId }),
      requestId,
      podId,
      "INTERNAL_ERROR",
    );
    return;
  }

  const response = createResponse(result.pod);
  socketService.emitToCanvas(canvasId, responseEvent, response);
}

export const handlePodMove = withCanvasId<PodMovePayload>(
  WebSocketResponseEvents.POD_MOVED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodMovePayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, x, y } = payload;

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { x, y },
      requestId,
      WebSocketResponseEvents.POD_MOVED,
      (pod) => ({ requestId, canvasId, success: true, pod }),
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

    // 預檢：讓常見重複命名情境快速回錯（非最終保證，SQLite 層才是最終防線）
    if (podStore.hasName(canvasId, trimmedName)) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_RENAMED,
        createI18nError("errors.podNameDuplicate"),
        requestId,
        podId,
        "DUPLICATE_NAME",
      );
      return;
    }

    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_RENAMED,
      requestId,
    );
    if (!existingPod) return;

    const oldName = existingPod.name;

    let result: ReturnType<typeof podStore.update>;
    try {
      result = podStore.update(canvasId, podId, { name: trimmedName });
    } catch (e) {
      // SQLite UNIQUE constraint 違反：並發請求造成名稱衝突（TOCTOU 防護）
      if (
        e instanceof Error &&
        e.message.includes("UNIQUE constraint failed")
      ) {
        emitError(
          connectionId,
          WebSocketResponseEvents.POD_RENAMED,
          createI18nError("errors.podNameDuplicate"),
          requestId,
          podId,
          "POD_NAME_DUPLICATE",
        );
        return;
      }
      throw e;
    }

    if (!result) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_RENAMED,
        createI18nError("errors.podUpdateFailed", { id: podId }),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    logger.log(
      "Pod",
      "Rename",
      `已重命名 Pod「${oldName}」為「${result.pod.name}」`,
    );

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_RENAMED, {
      requestId,
      canvasId,
      success: true,
      pod: result.pod,
      podId: result.pod.id,
      name: result.pod.name,
    });
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

    // 讀取現有 providerConfig，以白名單 merge 後寫回，避免未知 key 污染
    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MODEL_SET,
      requestId,
    );
    if (!existingPod) return;

    // 白名單 merge：目前只保留 model；未來新增安全 key 時在此同步擴充
    const safeProviderConfig: Record<string, unknown> = {
      ...(existingPod.providerConfig?.model
        ? { model: existingPod.providerConfig.model }
        : {}),
      model,
    };

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { providerConfig: safeProviderConfig },
      requestId,
      WebSocketResponseEvents.POD_MODEL_SET,
      (pod) => ({ requestId, canvasId, success: true, pod }),
    );
  },
);

export function buildScheduleUpdates(
  schedule: NonNullable<PodSetSchedulePayload["schedule"]> | null,
  existingSchedule: Pod["schedule"],
): { schedule?: ScheduleConfig | null } {
  if (schedule === null) {
    return { schedule: null };
  }

  const isEnabling =
    schedule.enabled && (!existingSchedule || !existingSchedule.enabled);

  // every-day 和 every-week 啟用時設為 null，讓排程在當天指定時間正常觸發
  // every-second、every-x-minute、every-x-hour 設為 new Date()，防止建立後立即觸發
  const immediateFrequencies: ScheduleConfig["frequency"][] = [
    "every-second",
    "every-x-minute",
    "every-x-hour",
  ];

  const hasScheduleChanged = existingSchedule
    ? schedule.frequency !== existingSchedule.frequency ||
      schedule.hour !== existingSchedule.hour ||
      schedule.minute !== existingSchedule.minute ||
      schedule.second !== existingSchedule.second ||
      schedule.intervalMinute !== existingSchedule.intervalMinute ||
      schedule.intervalHour !== existingSchedule.intervalHour ||
      [...schedule.weekdays].sort().join() !==
        [...existingSchedule.weekdays].sort().join()
    : false;

  let lastTriggeredAt: Date | null;

  if (isEnabling) {
    lastTriggeredAt = immediateFrequencies.includes(schedule.frequency)
      ? new Date()
      : null;
  } else if (schedule.enabled && hasScheduleChanged) {
    lastTriggeredAt = immediateFrequencies.includes(schedule.frequency)
      ? new Date()
      : null;
  } else {
    lastTriggeredAt = existingSchedule?.lastTriggeredAt ?? null;
  }

  return {
    schedule: {
      ...schedule,
      lastTriggeredAt,
    },
  };
}

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

    const updates = buildScheduleUpdates(schedule, existingPod.schedule);
    const updateResult = podStore.update(canvasId, podId, updates);

    if (!updateResult) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_SCHEDULE_SET,
        createI18nError("errors.podUpdateFailed", { id: podId }),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    const response: PodScheduleSetPayload = {
      requestId,
      canvasId,
      success: true,
      pod: updateResult.pod,
    };

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_SCHEDULE_SET,
      response,
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

    if (isPodBusy(existingPod.status)) {
      const busyResponse: PodPluginsSetPayload = {
        requestId,
        canvasId,
        podId,
        success: false,
        reason: "pod-busy",
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        busyResponse,
      );
      return;
    }

    const result = podStore.update(canvasId, podId, { pluginIds });
    if (!result) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        createI18nError("errors.podUpdateFailed", { id: podId }),
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
      pod: result.pod,
    };
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_PLUGINS_SET,
      successResponse,
    );
  },
);
