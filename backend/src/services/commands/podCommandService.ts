import { WebSocketResponseEvents } from "../../schemas/index.js";
import type {
  PodSetGoalPayload,
  PodSetModelPayload,
  PodSetProviderPayload,
  PodSetSchedulePayload,
  PodSetThinkingLevelPayload,
  PodSetFastModePayload,
} from "../../schemas/index.js";
import type {
  Pod,
  PodGoalSetPayload,
  PodFastModeSetPayload,
  PodModelSetPayload,
  PodMovedPayload,
  PodProviderSetPayload,
  PodPublicView,
  PodRenamedPayload,
  PodScheduleSetPayload,
  ScheduleConfig,
} from "../../types/index.js";
import { toPodPublicView } from "../../types/index.js";
import {
  getDefaultThinkingLevel,
  isThinkingLevelValid,
} from "../pod/providerConfigResolver.js";
import { podStore } from "../podStore.js";
import { createI18nError } from "../../utils/i18nError.js";
import { logger } from "../../utils/logger.js";
import { WebSocketError } from "../../middleware/wsErrorHandler.js";
import type { ApplicationCommandResult } from "./applicationCommand.js";
import { isFastModeSupported } from "../provider/capabilities.js";

function getFastModeCompatibilityUpdate(
  provider: string,
  model: unknown,
): { fastModeEnabled?: false } {
  return isFastModeSupported(provider, model)
    ? {}
    : { fastModeEnabled: false };
}

function createCanvasPodDispatch<TPayload>(
  canvasId: string,
  event: string,
  payload: TPayload,
): ApplicationCommandResult<TPayload> {
  return {
    data: payload,
    dispatches: [{ scope: "canvas", canvasId, event, payload }],
  };
}

function assertUpdateResult(
  podId: string,
  result: ReturnType<typeof podStore.update>,
): NonNullable<ReturnType<typeof podStore.update>> {
  if (!result) {
    throw new WebSocketError(
      "INTERNAL_ERROR",
      createI18nError("errors.podUpdateFailed", { id: podId }),
      undefined,
      podId,
    );
  }

  return result;
}

function toPodMutationPayload<TPayload>(
  pod: PodPublicView,
  createPayload: (pod: PodPublicView) => TPayload,
): TPayload {
  return createPayload(pod);
}

function checkPodNameConflict(
  canvasId: string,
  podId: string,
  name: string,
  tryUpdate: () => ReturnType<typeof podStore.update>,
): ReturnType<typeof podStore.update> {
  if (podStore.hasName(canvasId, name)) {
    throw new WebSocketError(
      "POD_NAME_DUPLICATE",
      createI18nError("errors.podNameDuplicate"),
      undefined,
      podId,
    );
  }

  try {
    return tryUpdate();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      throw new WebSocketError(
        "POD_NAME_DUPLICATE",
        createI18nError("errors.podNameDuplicate"),
        undefined,
        podId,
      );
    }

    throw error;
  }
}

function resolveLastTriggeredAt(
  isEnabling: boolean,
  hasScheduleChanged: boolean,
  schedule: NonNullable<PodSetSchedulePayload["schedule"]>,
  existingSchedule: Pod["schedule"],
): Date | null {
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

class PodCommandService {
  move(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    x: number;
    y: number;
  }): ApplicationCommandResult<PodMovedPayload> {
    const result = assertUpdateResult(
      params.podId,
      podStore.update(params.canvasId, params.podId, { x: params.x, y: params.y }),
    );
    const payload: PodMovedPayload = {
      requestId: params.requestId,
      canvasId: params.canvasId,
      success: true,
      pod: toPodPublicView(result.pod),
    };
    return createCanvasPodDispatch(
      params.canvasId,
      WebSocketResponseEvents.POD_MOVED,
      payload,
    );
  }

  rename(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    existingPod: Pod;
    name: string;
  }): ApplicationCommandResult<PodRenamedPayload> {
    const trimmedName = params.name.trim();
    const result = assertUpdateResult(
      params.podId,
      checkPodNameConflict(params.canvasId, params.podId, trimmedName, () =>
        podStore.update(params.canvasId, params.podId, { name: trimmedName }),
      ),
    );

    logger.log(
      "Pod",
      "Rename",
      `已重命名 Pod「${params.existingPod.name}」為「${result.pod.name}」`,
    );

    const payload: PodRenamedPayload = {
      requestId: params.requestId,
      canvasId: params.canvasId,
      success: true,
      pod: toPodPublicView(result.pod),
      podId: result.pod.id,
      name: result.pod.name,
    };

    return createCanvasPodDispatch(
      params.canvasId,
      WebSocketResponseEvents.POD_RENAMED,
      payload,
    );
  }

  setGoal(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    goal: PodSetGoalPayload["goal"];
  }): ApplicationCommandResult<PodGoalSetPayload> {
    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_GOAL_SET,
      updates: { goal: params.goal },
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  setProvider(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    provider: PodSetProviderPayload["provider"];
    providerConfig: PodSetProviderPayload["providerConfig"];
  }): ApplicationCommandResult<PodProviderSetPayload> {
    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_PROVIDER_SET,
      updates: {
        provider: params.provider,
        providerConfig: params.providerConfig,
        ...getFastModeCompatibilityUpdate(
          params.provider,
          params.providerConfig.model,
        ),
      },
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  setModel(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    existingPod: Pod;
    model: PodSetModelPayload["model"];
  }): ApplicationCommandResult<PodProviderSetPayload> {
    const isModelChanged =
      params.existingPod.providerConfig?.model !== params.model;
    const safeProviderConfig: Record<string, unknown> = { model: params.model };

    if (isModelChanged) {
      const defaultLevel = getDefaultThinkingLevel(
        params.existingPod.provider,
        params.model,
      );
      if (defaultLevel !== null) {
        safeProviderConfig.thinkingLevel = defaultLevel;
      }
    } else if (params.existingPod.providerConfig?.thinkingLevel !== undefined) {
      safeProviderConfig.thinkingLevel =
        params.existingPod.providerConfig.thinkingLevel;
    }

    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_MODEL_SET,
      updates: {
        providerConfig: safeProviderConfig,
        ...getFastModeCompatibilityUpdate(
          params.existingPod.provider,
          params.model,
        ),
      },
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  setThinkingLevel(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    existingPod: Pod;
    level: PodSetThinkingLevelPayload["level"];
  }): ApplicationCommandResult<PodModelSetPayload> {
    const currentModel = params.existingPod.providerConfig?.model;
    if (
      typeof currentModel === "string" &&
      !isThinkingLevelValid(params.existingPod.provider, currentModel, params.level)
    ) {
      throw new WebSocketError(
        "pod_invalid_thinking_level",
        "此 model 不支援指定的 thinking level",
        undefined,
        params.podId,
      );
    }

    const safeProviderConfig: Record<string, unknown> = {
      ...(params.existingPod.providerConfig?.model
        ? { model: params.existingPod.providerConfig.model }
        : {}),
      thinkingLevel: params.level,
    };

    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
      updates: { providerConfig: safeProviderConfig },
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  setFastMode(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    existingPod: Pod;
    enabled: PodSetFastModePayload["enabled"];
  }): ApplicationCommandResult<PodFastModeSetPayload> {
    if (
      params.enabled &&
      !isFastModeSupported(
        params.existingPod.provider,
        params.existingPod.providerConfig?.model,
      )
    ) {
      throw new WebSocketError(
        "POD_FAST_MODE_UNSUPPORTED",
        "目前的 provider 或 model 不支援 Fast mode",
        undefined,
        params.podId,
      );
    }

    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_FAST_MODE_SET,
      updates: { fastModeEnabled: params.enabled },
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  setSchedule(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    existingPod: Pod;
    schedule: PodSetSchedulePayload["schedule"];
  }): ApplicationCommandResult<PodScheduleSetPayload> {
    return this.updatePodAndBroadcast({
      canvasId: params.canvasId,
      podId: params.podId,
      requestId: params.requestId,
      event: WebSocketResponseEvents.POD_SCHEDULE_SET,
      updates: buildScheduleUpdates(params.schedule, params.existingPod.schedule),
      createPayload: (pod) => ({
        requestId: params.requestId,
        canvasId: params.canvasId,
        success: true,
        pod,
      }),
    });
  }

  private updatePodAndBroadcast<TPayload>(params: {
    canvasId: string;
    podId: string;
    requestId: string;
    event: string;
    updates: Partial<Omit<Pod, "id" | "schedule">> & { schedule?: ScheduleConfig | null };
    createPayload: (pod: PodPublicView) => TPayload;
  }): ApplicationCommandResult<TPayload> {
    const result = assertUpdateResult(
      params.podId,
      podStore.update(params.canvasId, params.podId, params.updates),
    );

    const payload = toPodMutationPayload(
      toPodPublicView(result.pod),
      params.createPayload,
    );

    return {
      data: payload,
      dispatches: [
        {
          scope: "canvas",
          canvasId: params.canvasId,
          event: params.event,
          payload,
        },
      ],
    };
  }
}

export const podCommandService = new PodCommandService();
