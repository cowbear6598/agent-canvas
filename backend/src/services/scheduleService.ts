import { WebSocketResponseEvents } from "../schemas";
import type { Pod, ScheduleConfig, ContentBlock } from "../types";
import { podStore } from "./podStore.js";
import { socketService } from "./socketService.js";
import { workflowExecutionService } from "./workflow";
import { logger } from "../utils/logger.js";
import { fireAndForget } from "../utils/operationHelpers.js";
import { executeStreamingChat } from "./claude/streamingChatExecutor.js";
import { launchMultiInstanceRun } from "../utils/runChatHelpers.js";
import { onRunChatComplete } from "../utils/chatCallbacks.js";
import { injectUserMessage } from "../utils/chatHelpers.js";
import {
  toOffsettedParts,
  isSameDayWithOffset,
} from "../utils/timezoneUtils.js";
import { configStore } from "./configStore.js";
import { NormalModeExecutionStrategy } from "./normalExecutionStrategy.js";
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
    logger.warn(
      "Schedule",
      "Update",
      `Pod「${pod.id}」排程觸發：Command「${expandResult.commandId}」不存在，改用排程啟動語句觸發（context=${context}）`,
    );
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
      logger.log("Schedule", "Update", `找不到 Pod「${podId}」，跳過排程觸發`);
      return;
    }
    await this.fireSchedule(canvasId, pod, now);
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
      // 排程路徑透過 expandScheduleMessage 統一處理 Command 展開與空字串 fallback。
      // launchMultiInstanceRun 會自行處理展開（無 commandId 時為 no-op）；此處傳入已展開後字串即可。
      const runMessage = await expandScheduleMessage(
        pod,
        "",
        "schedule/multiInstance",
      );

      await launchMultiInstanceRun({
        canvasId,
        podId: pod.id,
        message: runMessage,
        abortable: false,
        onComplete: (runContext) =>
          onRunChatComplete(runContext, canvasId, pod.id),
      });
    } else {
      await this.sendScheduleMessage(canvasId, pod);
    }
  }

  private async sendScheduleMessage(canvasId: string, pod: Pod): Promise<void> {
    const podId = pod.id;

    // 排程路徑透過 expandScheduleMessage 統一處理 Command 展開與空字串 fallback。
    const message = await expandScheduleMessage(
      pod,
      "",
      "schedule/sendScheduleMessage",
    );

    // 統一透過 injectUserMessage 處理：設置 pod status、寫入 messageStore、
    // 並推送 POD_CHAT_USER_MESSAGE WS 事件，使前端顯示與 DB 儲存一致為展開後內容。
    await injectUserMessage({
      canvasId,
      podId,
      content: message,
    });

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
      {
        canvasId,
        podId,
        message,
        abortable: false,
        strategy,
      },
      { onComplete: onScheduleChatComplete },
    );
  }
}

export const scheduleService = new ScheduleService();
