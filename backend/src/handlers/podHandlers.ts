import { WebSocketResponseEvents } from "../schemas";
import type {
  PodListResultPayload,
  PodGetResultPayload,
  PodScheduleSetPayload,
  PodMemoryEnabledSetPayload,
  PodMemoryClearedPayload,
  PodGoalSetPayload,
  PodProviderSetPayload,
  PodPluginsSetPayload,
  Pod,
  PodPublicView,
  ScheduleConfig,
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
  PodSetSchedulePayload,
  PodSetMemoryEnabledPayload,
  PodClearMemoryPayload,
  PodDeletePayload,
  PodSetPluginsPayload,
} from "../schemas";
import { podStore } from "../services/podStore.js";
import { runStore } from "../services/runStore.js";
import {
  getDefaultThinkingLevel,
  isThinkingLevelValid,
} from "../services/pod/providerConfigResolver.js";
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

export const handlePodSetGoal = withCanvasId<PodSetGoalPayload>(
  WebSocketResponseEvents.POD_GOAL_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetGoalPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, goal } = payload;

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { goal },
      requestId,
      WebSocketResponseEvents.POD_GOAL_SET,
      (pod): PodGoalSetPayload => ({ requestId, canvasId, success: true, pod }),
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

export const handlePodSetProvider = withCanvasId<PodSetProviderPayload>(
  WebSocketResponseEvents.POD_PROVIDER_SET,
  async (
    connectionId: string,
    canvasId: string,
    payload: PodSetProviderPayload,
    requestId: string,
  ): Promise<void> => {
    const { podId, provider, providerConfig } = payload;

    handlePodUpdate(
      connectionId,
      canvasId,
      podId,
      { provider, providerConfig },
      requestId,
      WebSocketResponseEvents.POD_PROVIDER_SET,
      (pod): PodProviderSetPayload => ({
        requestId,
        canvasId,
        success: true,
        pod,
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

    // 讀取現有 providerConfig，以白名單 merge 後寫回，避免未知 key 污染
    const existingPod = validatePod(
      connectionId,
      podId,
      WebSocketResponseEvents.POD_MODEL_SET,
      requestId,
    );
    if (!existingPod) return;

    // 白名單 merge：目前保留 model 與 thinkingLevel；未來新增安全 key 時在此同步擴充
    // model 切換時清空舊 thinkingLevel，改為新 model 的 default（不支援則不寫入）
    // model 相同時保留 existing thinkingLevel，避免 idempotent 呼叫造成 thinking 漂移
    const isModelChanged = existingPod.providerConfig?.model !== model;
    const safeProviderConfig: Record<string, unknown> = { model };
    if (isModelChanged) {
      const defaultLevel = getDefaultThinkingLevel(existingPod.provider, model);
      if (defaultLevel !== null) {
        safeProviderConfig.thinkingLevel = defaultLevel;
      }
    } else if (existingPod.providerConfig?.thinkingLevel !== undefined) {
      safeProviderConfig.thinkingLevel =
        existingPod.providerConfig.thinkingLevel;
    }

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

      // 讀取現有 providerConfig，以白名單 merge 後寫回，避免未知 key 污染
      const existingPod = validatePod(
        connectionId,
        podId,
        WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
        requestId,
      );
      if (!existingPod) return;

      const currentModel = existingPod.providerConfig?.model;
      if (
        typeof currentModel === "string" &&
        !isThinkingLevelValid(existingPod.provider, currentModel, level)
      ) {
        emitError(
          connectionId,
          WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
          "此 model 不支援指定的 thinking level",
          canvasId,
          requestId,
          podId,
          "pod_invalid_thinking_level",
        );
        return;
      }

      // 白名單 merge：保留 model，並寫入新的 thinkingLevel（payload.level）
      const safeProviderConfig: Record<string, unknown> = {
        ...(existingPod.providerConfig?.model
          ? { model: existingPod.providerConfig.model }
          : {}),
        thinkingLevel: level,
      };

      handlePodUpdate(
        connectionId,
        canvasId,
        podId,
        { providerConfig: safeProviderConfig },
        requestId,
        WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
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

    if (runStore.hasActiveRunForPod(podId)) {
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
