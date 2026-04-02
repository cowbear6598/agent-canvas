import { WebSocketResponseEvents } from "../schemas";
import type { Pod, ScheduleConfig } from "../types";
import { podStore } from "./podStore.js";
import { messageStore } from "./messageStore.js";
import { socketService } from "./socketService.js";
import { workflowExecutionService } from "./workflow";
import { commandService } from "./commandService.js";
import { logger } from "../utils/logger.js";
import { fireAndForget } from "../utils/operationHelpers.js";
import { executeStreamingChat } from "./claude/streamingChatExecutor.js";
import { launchMultiInstanceRun } from "../utils/runChatHelpers.js";
import { onRunChatComplete } from "../utils/chatCallbacks.js";
import {
  toOffsettedParts,
  isSameDayWithOffset,
} from "../utils/timezoneUtils.js";
import { configStore } from "./configStore.js";
import { NormalModeExecutionStrategy } from "./normalExecutionStrategy.js";

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
  if (isFirstTrigger(schedule.lastTriggeredAt)) {
    return true;
  }
  return !isSameDayWithOffset(new Date(schedule.lastTriggeredAt!), now, offset);
}

export const shouldFireCheckers: Record<
  ScheduleConfig["frequency"],
  ShouldFireChecker
> = {
  "every-second": (schedule, now, _offset) => {
    if (isFirstTrigger(schedule.lastTriggeredAt)) return true;
    const elapsedSeconds =
      (now.getTime() - schedule.lastTriggeredAt!.getTime()) / MS_PER_SECOND;
    return elapsedSeconds >= schedule.second;
  },

  "every-x-minute": (schedule, now, _offset) => {
    if (isFirstTrigger(schedule.lastTriggeredAt)) return true;
    const elapsedMinutes =
      (now.getTime() - schedule.lastTriggeredAt!.getTime()) / MS_PER_MINUTE;
    return elapsedMinutes >= schedule.intervalMinute;
  },

  "every-x-hour": (schedule, now, _offset) => {
    if (isFirstTrigger(schedule.lastTriggeredAt)) return true;
    const elapsedHours =
      (now.getTime() - schedule.lastTriggeredAt!.getTime()) / MS_PER_HOUR;
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
      logger.log("Schedule", "Update", "排程器已在運行中");
      return;
    }

    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);

    logger.log("Schedule", "Create", "排程器已啟動");
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      logger.log("Schedule", "Delete", "排程器已停止");
    }
  }

  private tick(): void {
    const now = new Date();
    const offset = configStore.getTimezoneOffset();
    const podsWithSchedule = podStore.getAllWithSchedule();

    for (const { canvasId, pod } of podsWithSchedule) {
      if (pod.schedule && this.shouldFire(pod.schedule, now, offset)) {
        fireAndForget(
          this.fireSchedule(canvasId, pod, now),
          "Schedule",
          `觸發 Pod「${pod.id}」排程失敗`,
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

  private async fireSchedule(
    canvasId: string,
    pod: Pod,
    now: Date,
  ): Promise<void> {
    if (pod.status !== "idle") {
      logger.log("Schedule", "Update", `Pod「${pod.id}」正忙碌，跳過排程觸發`);
      return;
    }

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

    if (pod.multiInstance === true) {
      const commands = await commandService.list();
      const command = pod.commandId
        ? commands.find((cmd) => cmd.id === pod.commandId)
        : null;
      const displayMessage = command ? `/${command.name} ` : "";

      await launchMultiInstanceRun({
        canvasId,
        podId: pod.id,
        message: "",
        displayMessage,
        abortable: false,
        onComplete: (runContext) =>
          onRunChatComplete(runContext, canvasId, pod.id),
      });
    } else {
      await this.sendScheduleMessage(canvasId, pod.id);
    }
  }

  private async sendScheduleMessage(
    canvasId: string,
    podId: string,
  ): Promise<void> {
    podStore.setStatus(canvasId, podId, "chatting");

    await messageStore.addMessage(canvasId, podId, "user", "");

    const onScheduleChatComplete = async (
      completedCanvasId: string,
      completedPodId: string,
    ): Promise<void> => {
      fireAndForget(
        workflowExecutionService.checkAndTriggerWorkflows(
          completedCanvasId,
          completedPodId,
        ),
        "Schedule",
        `檢查 Pod「${completedPodId}」自動觸發 Workflow 失敗`,
      );
    };

    const strategy = new NormalModeExecutionStrategy(canvasId);

    await executeStreamingChat(
      { canvasId, podId, message: "", abortable: false, strategy },
      { onComplete: onScheduleChatComplete },
    );
  }
}

export const scheduleService = new ScheduleService();
