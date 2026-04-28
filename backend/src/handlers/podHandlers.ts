import { WebSocketResponseEvents } from "../schemas";
import type {
  PodListResultPayload,
  PodGetResultPayload,
  PodScheduleSetPayload,
  PodPluginsSetPayload,
  Pod,
  PodPublicView,
  ScheduleConfig,
} from "../types";
import { isPodBusy, toPodPublicView } from "../types/index.js";
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
import { scanInstalledPlugins } from "../services/pluginScanner.js";

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

function handlePodUpdate<TResponse>(
  connectionId: string,
  canvasId: string,
  podId: string,
  updates: Partial<Omit<Pod, "id">>,
  requestId: string,
  responseEvent: WebSocketResponseEvents,
  createResponse: (pod: PodPublicView) => TResponse,
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
      canvasId,
      requestId,
      podId,
      "INTERNAL_ERROR",
    );
    return;
  }

  const response = createResponse(toPodPublicView(result.pod));
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

/**
 * 封裝「預檢 + UNIQUE 例外」兩道名稱衝突防線。
 *
 * 回傳 discriminated union：
 * - `{ conflicted: true }`：名稱衝突，emitError 已發送，**caller 應直接 return**。
 * - `{ conflicted: false; result }`：無衝突，`result` 為 podStore.update 回傳值，
 *   caller 可直接使用 result 進行後續處理。
 *
 * 使用範例：
 * ```ts
 * const checkResult = checkPodNameConflict(...);
 * if (checkResult.conflicted) return;
 * const { result } = checkResult; // 此時 result 型別已收窄
 * ```
 */
function checkPodNameConflict(
  connectionId: string,
  canvasId: string,
  podId: string,
  name: string,
  requestId: string,
  tryUpdate: () => ReturnType<typeof podStore.update>,
):
  | { conflicted: true }
  | { conflicted: false; result: ReturnType<typeof podStore.update> } {
  // 預檢：讓常見重複命名情境快速回錯，避免不必要的 DB write fail。
  // 注意：預檢與 DB 寫入之間存在 TOCTOU 窗口，並發場景下仍可能發生衝突。
  // 最終判定依賴下方 SQLite UNIQUE constraint catch，預檢僅為效能優化。
  if (podStore.hasName(canvasId, name)) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_RENAMED,
      createI18nError("errors.podNameDuplicate"),
      canvasId,
      requestId,
      podId,
      "DUPLICATE_NAME",
    );
    return { conflicted: true };
  }

  try {
    const result = tryUpdate();
    return { conflicted: false, result };
  } catch (e) {
    // SQLite UNIQUE constraint 違反：並發請求造成名稱衝突（TOCTOU 防護）
    if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_RENAMED,
        createI18nError("errors.podNameDuplicate"),
        canvasId,
        requestId,
        podId,
        "POD_NAME_DUPLICATE",
      );
      return { conflicted: true };
    }
    throw e;
  }
}

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

    const oldName = existingPod.name;

    const checkResult = checkPodNameConflict(
      connectionId,
      canvasId,
      podId,
      trimmedName,
      requestId,
      () => podStore.update(canvasId, podId, { name: trimmedName }),
    );
    if (checkResult.conflicted) return;

    const { result } = checkResult;

    if (!result) {
      emitError(
        connectionId,
        WebSocketResponseEvents.POD_RENAMED,
        createI18nError("errors.podUpdateFailed", { id: podId }),
        canvasId,
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
      pod: toPodPublicView(result.pod),
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

/**
 * 決定 lastTriggeredAt 的值。
 * - 首次啟用或已啟用且排程設定有變更：高頻類型設為 new Date()，其他設為 null。
 * - 其他情況（停用、未變更）：保留既有值。
 */
function resolveLastTriggeredAt(
  isEnabling: boolean,
  hasScheduleChanged: boolean,
  schedule: NonNullable<PodSetSchedulePayload["schedule"]>,
  existingSchedule: Pod["schedule"],
): Date | null {
  // every-day 和 every-week 啟用時設為 null，讓排程在當天指定時間正常觸發
  // every-second、every-x-minute、every-x-hour 設為 new Date()，防止建立後立即觸發
  const immediateFrequencies: ScheduleConfig["frequency"][] = [
    "every-second",
    "every-x-minute",
    "every-x-hour",
  ];

  if (isEnabling || (schedule.enabled && hasScheduleChanged)) {
    return immediateFrequencies.includes(schedule.frequency)
      ? new Date()
      : null;
  }

  return existingSchedule?.lastTriggeredAt ?? null;
}

/**
 * 純函式：比對兩個排程設定的所有欄位（含 weekdays 排序正規化），
 * 回傳是否有任何欄位發生變更。
 */
function hasScheduleFieldsChanged(
  next: NonNullable<PodSetSchedulePayload["schedule"]>,
  existing: NonNullable<Pod["schedule"]>,
): boolean {
  return (
    next.frequency !== existing.frequency ||
    next.hour !== existing.hour ||
    next.minute !== existing.minute ||
    next.second !== existing.second ||
    next.intervalMinute !== existing.intervalMinute ||
    next.intervalHour !== existing.intervalHour ||
    [...next.weekdays].sort().join() !== [...existing.weekdays].sort().join()
  );
}

export function buildScheduleUpdates(
  schedule: NonNullable<PodSetSchedulePayload["schedule"]> | null,
  existingSchedule: Pod["schedule"],
): { schedule?: ScheduleConfig | null } {
  if (schedule === null) {
    return { schedule: null };
  }

  const isEnabling =
    schedule.enabled && (!existingSchedule || !existingSchedule.enabled);

  const hasScheduleChanged = existingSchedule
    ? hasScheduleFieldsChanged(schedule, existingSchedule)
    : false;

  const lastTriggeredAt = resolveLastTriggeredAt(
    isEnabling,
    hasScheduleChanged,
    schedule,
    existingSchedule,
  );

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
        canvasId,
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
      pod: toPodPublicView(updateResult.pod),
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

    // 過濾未安裝的 plugin ID：只保留實際存在的 plugin，無效 ID 以 warn log 記錄但不拒絕整個請求
    const installedPlugins = scanInstalledPlugins(existingPod.provider);
    const validPluginIdSet = new Set(installedPlugins.map((p) => p.id));
    const invalidIds = pluginIds.filter((id) => !validPluginIdSet.has(id));
    if (invalidIds.length > 0) {
      logger.warn(
        "Pod",
        "Warn",
        `handlePodSetPlugins：略過不存在的 plugin ID（已遮罩，共 ${invalidIds.length} 筆）`,
      );
    }
    const validPluginIds = pluginIds.filter((id) => validPluginIdSet.has(id));

    const result = podStore.update(canvasId, podId, {
      pluginIds: validPluginIds,
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

    // ignoredIds：被過濾掉的 plugin ID 清單，前端可據此提示使用者
    const successResponse: PodPluginsSetPayload = {
      requestId,
      canvasId,
      success: true,
      pod: toPodPublicView(result.pod),
      ignoredIds: invalidIds,
    };
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_PLUGINS_SET,
      successResponse,
    );
  },
);
