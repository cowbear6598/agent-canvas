import { existsSync } from "fs";
import { WebSocketResponseEvents } from "../schemas";
import type {
  PodListResultPayload,
  PodGetResultPayload,
  PodScheduleSetPayload,
  PodDirectoryOpenedPayload,
  Pod,
  ScheduleConfig,
} from "../types";
import type {
  PodCreatePayload,
  PodListPayload,
  PodGetPayload,
  PodMovePayload,
  PodRenamePayload,
  PodSetModelPayload,
  PodSetSchedulePayload,
  PodDeletePayload,
  PodOpenDirectoryPayload,
  PodSetPluginsPayload,
} from "../schemas";
import { podStore } from "../services/podStore.js";
import {
  createPodWithWorkspace,
  deletePodWithCleanup,
} from "../services/podService.js";
import { socketService } from "../services/socketService.js";
import { repositoryService } from "../services/repositoryService.js";
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
    const { name, x, y, rotation } = payload;

    const result = await createPodWithWorkspace(
      canvasId,
      { name, x, y, rotation },
      requestId,
    );

    if (
      handleResultError(
        result,
        connectionId,
        WebSocketResponseEvents.POD_CREATED,
        requestId,
        createI18nError('errors.podCreateFailed'),
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
      createI18nError('errors.podDeleteFailed'),
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
      createI18nError('errors.podUpdateFailed', { id: podId }),
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

    if (podStore.hasName(canvasId, trimmedName)) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_RENAMED,
        createI18nError('errors.podNameDuplicate'),
        requestId,
        podId,
        "DUPLICATE_NAME",
      );
      return;
    }

    const oldName = podStore.getById(canvasId, podId)?.name;

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { name: trimmedName },
      requestId,
      WebSocketResponseEvents.POD_RENAMED,
      (pod) => {
        logger.log(
          "Pod",
          "Rename",
          `已重命名 Pod「${oldName ?? podId}」為「${pod.name}」`,
        );
        return {
          requestId,
          canvasId,
          success: true,
          pod,
          podId: pod.id,
          name: pod.name,
        };
      },
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

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { model },
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
        createI18nError('errors.podUpdateFailed', { id: podId }),
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

const PLATFORM_COMMANDS: Record<string, string> = {
  darwin: "open",
  linux: "xdg-open",
  win32: "explorer",
};

function getOpenCommand(platform: string): string | null {
  return PLATFORM_COMMANDS[platform] ?? null;
}

export const handlePodOpenDirectory = withCanvasId<PodOpenDirectoryPayload>(
  WebSocketResponseEvents.POD_DIRECTORY_OPENED,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodOpenDirectoryPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId } = payload;

    const pod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_DIRECTORY_OPENED,
      requestId,
    );
    if (!pod) {
      return;
    }

    const targetPath = pod.repositoryId
      ? repositoryService.getRepositoryPath(pod.repositoryId)
      : pod.workspacePath;

    if (!existsSync(targetPath)) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_DIRECTORY_OPENED,
        createI18nError('errors.targetDirectoryNotExists'),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    const command = getOpenCommand(process.platform);
    if (!command) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_DIRECTORY_OPENED,
        createI18nError('errors.unsupportedOs', { os: process.platform }),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    const proc = Bun.spawn([command, targetPath]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_DIRECTORY_OPENED,
        createI18nError('errors.openDirectoryFailed'),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    const response: PodDirectoryOpenedPayload = {
      requestId,
      success: true,
      path: targetPath,
    };

    emitSuccess(
      connectionId,
      WebSocketResponseEvents.POD_DIRECTORY_OPENED,
      response,
    );

    logger.log("Pod", "Load", `已打開目錄: ${targetPath}`);
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

    const result = podStore.update(canvasId, podId, { pluginIds });
    if (!result) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        createI18nError('errors.podUpdateFailed', { id: podId }),
        requestId,
        podId,
        "INTERNAL_ERROR",
      );
      return;
    }

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_PLUGINS_SET,
      {
        requestId,
        canvasId,
        success: true,
        pod: result.pod,
      },
    );
  },
);
