import { WebSocketResponseEvents } from "../schemas";
import type { Pod, ScheduleConfig, ContentBlock } from "../types";
import { podStore } from "./podStore.js";
import { socketService } from "./socketService.js";
import { logger } from "../utils/logger.js";
import { fireAndForget } from "../utils/operationHelpers.js";
import { launchRun } from "../utils/runChatHelpers.js";
import { onRunChatComplete } from "../utils/chatCallbacks.js";
import {
  toOffsettedParts,
  isSameDayWithOffset,
} from "../utils/timezoneUtils.js";
import { configStore } from "./configStore.js";
import { tryExpandCommandMessage } from "./commandExpander.js";

/**
 * 排程觸發但 Command 不存在 / 訊息為空時的 fallback 字串。
 * 避免 codex stdin 為空導致崩潰。
 */
const SCHEDULE_FALLBACK_MESSAGE = "排程啟動，完成以下任務：";

/**
 * 排程路徑專用的 Command 展開 helper。
 *
 * 行為：
 *   - 呼叫 tryExpandCommandMessage（無 commandId 時回傳原訊息）
 *   - ok=true 且展開後訊息為空字串 → 回傳 SCHEDULE_FALLBACK_MESSAGE（避免 codex stdin 為空崩潰）
 *   - ok=true → 回傳展開後訊息
 *   - ok=false（Command 檔案已消失）→ warn + 回傳 SCHEDULE_FALLBACK_MESSAGE
 *
 * @param context - 呼叫來源（log 標識），例如 "schedule/multiInstance" / "schedule/sendScheduleMessage"
 */
async function expandScheduleMessage(
  pod: Pod,
  message: string | ContentBlock[],
  context: string,
): Promise<string | ContentBlock[]> {
  const expandResult = await tryExpandCommandMessage(pod, message, context);

  if (!expandResult.ok) {
    return SCHEDULE_FALLBACK_MESSAGE;
  }

  // 展開後仍可能為空字串（無 commandId 且原始訊息為空），同樣用排程啟動語句取代
  const expanded = expandResult.message;
  if (typeof expanded === "string" && expanded === "") {
    return SCHEDULE_FALLBACK_MESSAGE;
  }
  return expanded;
}

const TICK_INTERVAL_MS = 1000;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const SCHEDULE_TRIGGER_SECOND = 0;

export type ShouldFireChecker = (
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
) => boolean;

function isFirstTrigger(
  lastTriggeredAt: ScheduleConfig["lastTriggeredAt"],
): boolean {
  return !lastTriggeredAt;
}

function isScheduledTime(
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
): boolean {
  const parts = toOffsettedParts(now, offset);
  return (
    parts.hours === schedule.hour &&
    parts.minutes === schedule.minute &&
    parts.seconds === SCHEDULE_TRIGGER_SECOND
  );
}

function isFirstTriggerOrNewDay(
  schedule: ScheduleConfig,
  now: Date,
  offset: number,
): boolean {
  const lastTriggeredAt = schedule.lastTriggeredAt;
  if (isFirstTrigger(lastTriggeredAt) || lastTriggeredAt === null) {
    return true;
  }
  return !isSameDayWithOffset(new Date(lastTriggeredAt), now, offset);
}

export const shouldFireCheckers: Record<
  ScheduleConfig["frequency"],
  ShouldFireChecker
> = {
  "every-second": (schedule, now, _offset) => {
    const lastTriggeredAt = schedule.lastTriggeredAt;
    if (isFirstTrigger(lastTriggeredAt) || lastTriggeredAt === null)
      return true;
    const elapsedSeconds =
      (now.getTime() - lastTriggeredAt.getTime()) / MS_PER_SECOND;
    return elapsedSeconds >= schedule.second;
  },

  "every-x-minute": (schedule, now, _offset) => {
    const lastTriggeredAt = schedule.lastTriggeredAt;
    if (isFirstTrigger(lastTriggeredAt) || lastTriggeredAt === null)
      return true;
    const elapsedMinutes =
      (now.getTime() - lastTriggeredAt.getTime()) / MS_PER_MINUTE;
    return elapsedMinutes >= schedule.intervalMinute;
  },

  "every-x-hour": (schedule, now, _offset) => {
    const lastTriggeredAt = schedule.lastTriggeredAt;
    if (isFirstTrigger(lastTriggeredAt) || lastTriggeredAt === null)
      return true;
    const elapsedHours =
      (now.getTime() - lastTriggeredAt.getTime()) / MS_PER_HOUR;
    return elapsedHours >= schedule.intervalHour;
  },

  "every-day": (schedule, now, offset) => {
    if (!isScheduledTime(schedule, now, offset)) {
      return false;
    }
    return isFirstTriggerOrNewDay(schedule, now, offset);
  },

  "every-week": (schedule, now, offset) => {
    const parts = toOffsettedParts(now, offset);
    if (!schedule.weekdays.includes(parts.day)) {
      return false;
    }
    if (!isScheduledTime(schedule, now, offset)) {
      return false;
    }
    return isFirstTriggerOrNewDay(schedule, now, offset);
  },
};

class ScheduleService {
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.tickInterval) {
      return;
    }

    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private tick(): void {
    const now = new Date();
    const offset = configStore.getTimezoneOffset();
    const scheduleInfoList = podStore.listScheduleInfo();

    for (const { canvasId, podId, schedule } of scheduleInfoList) {
      if (this.shouldFire(schedule, now, offset)) {
        fireAndForget(
          this.fireScheduleById(canvasId, podId, now),
          "Schedule",
          `觸發 Pod「${podId}」排程失敗`,
        );
      }
    }
  }

  private shouldFire(
    schedule: ScheduleConfig,
    now: Date,
    offset: number,
  ): boolean {
    const checker = shouldFireCheckers[schedule.frequency];
    return checker ? checker(schedule, now, offset) : false;
  }

  private async fireScheduleById(
    canvasId: string,
    podId: string,
    now: Date,
  ): Promise<void> {
    const pod = podStore.getById(canvasId, podId);
    if (!pod) {
      return;
    }
    await this.fireSchedule(canvasId, pod, now);
  }

  private async fireSchedule(
    canvasId: string,
    pod: Pod,
    now: Date,
  ): Promise<void> {
    podStore.setScheduleLastTriggeredAt(canvasId, pod.id, now);

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.SCHEDULE_FIRED,
      {
        podId: pod.id,
        timestamp: now.toISOString(),
      },
    );

    logger.log("Schedule", "Update", `Pod「${pod.id}」排程已觸發`);

    // 排程路徑透過 expandScheduleMessage 統一處理 Command 展開與空字串 fallback。
    // launchRun 會自行處理展開（無 commandId 時為 no-op）；此處傳入已展開後字串即可。
    const runMessage = await expandScheduleMessage(
      pod,
      "",
      "schedule/multiInstance",
    );

    await launchRun({
      canvasId,
      podId: pod.id,
      message: runMessage,
      abortable: false,
      onComplete: (runContext) =>
        onRunChatComplete(runContext, canvasId, pod.id),
    });
  }
}

export const scheduleService = new ScheduleService();
