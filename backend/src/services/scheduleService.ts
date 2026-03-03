import { WebSocketResponseEvents } from '../schemas';
import type {
  Pod,
  ScheduleConfig,
} from '../types';
import { podStore } from './podStore.js';
import { messageStore } from './messageStore.js';
import { socketService } from './socketService.js';
import { workflowExecutionService } from './workflow';
import { autoClearService } from './autoClear';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/operationHelpers.js';
import { executeStreamingChat } from './claude/streamingChatExecutor.js';

const TICK_INTERVAL_MS = 1000;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const SCHEDULE_TRIGGER_SECOND = 0;

type ShouldFireChecker = (schedule: ScheduleConfig, now: Date) => boolean;

function isScheduledTime(schedule: ScheduleConfig, now: Date): boolean {
  return now.getHours() === schedule.hour
    && now.getMinutes() === schedule.minute
    && now.getSeconds() === SCHEDULE_TRIGGER_SECOND;
}

function isFirstTriggerOrNewDay(schedule: ScheduleConfig, now: Date): boolean {
  if (!schedule.lastTriggeredAt) {
    return true;
  }
  return !isSameDay(new Date(schedule.lastTriggeredAt), now);
}

const shouldFireCheckers: Record<ScheduleConfig['frequency'], ShouldFireChecker> = {
  'every-second': (schedule, now) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedSeconds = (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_SECOND;
    return elapsedSeconds >= schedule.second;
  },

  'every-x-minute': (schedule, now) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedMinutes = (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_MINUTE;
    return elapsedMinutes >= schedule.intervalMinute;
  },

  'every-x-hour': (schedule, now) => {
    if (!schedule.lastTriggeredAt) {
      return true;
    }
    const elapsedHours = (now.getTime() - schedule.lastTriggeredAt.getTime()) / MS_PER_HOUR;
    return elapsedHours >= schedule.intervalHour;
  },

  'every-day': (schedule, now) => {
    if (!isScheduledTime(schedule, now)) {
      return false;
    }
    return isFirstTriggerOrNewDay(schedule, now);
  },

  'every-week': (schedule, now) => {
    if (!schedule.weekdays.includes(now.getDay())) {
      return false;
    }
    if (!isScheduledTime(schedule, now)) {
      return false;
    }
    return isFirstTriggerOrNewDay(schedule, now);
  },
};

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

class ScheduleService {
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.tickInterval) {
      logger.log('Schedule', 'Update', '排程器已在運行中');
      return;
    }

    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);

    logger.log('Schedule', 'Create', '排程器已啟動');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      logger.log('Schedule', 'Delete', '排程器已停止');
    }
  }

  private tick(): void {
    const now = new Date();
    const podsWithSchedule = podStore.getAllWithSchedule();

    for (const { canvasId, pod } of podsWithSchedule) {
      if (pod.schedule && this.shouldFire(pod.schedule, now)) {
        fireAndForget(
          this.fireSchedule(canvasId, pod, now),
          'Schedule',
          `觸發 Pod「${pod.id}」排程失敗`
        );
      }
    }
  }

  private shouldFire(schedule: ScheduleConfig, now: Date): boolean {
    const checker = shouldFireCheckers[schedule.frequency];
    return checker ? checker(schedule, now) : false;
  }

  private async fireSchedule(canvasId: string, pod: Pod, now: Date): Promise<void> {
    if (pod.status !== 'idle') {
      logger.log('Schedule', 'Update', `Pod「${pod.id}」正忙碌，跳過排程觸發`);
      return;
    }

    podStore.setScheduleLastTriggeredAt(canvasId, pod.id, now);

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.SCHEDULE_FIRED, {
      podId: pod.id,
      timestamp: now.toISOString(),
    });

    logger.log('Schedule', 'Update', `Pod「${pod.id}」排程已觸發`);

    await this.sendScheduleMessage(canvasId, pod.id);
  }

  private async sendScheduleMessage(canvasId: string, podId: string): Promise<void> {
    podStore.setStatus(canvasId, podId, 'chatting');

    await messageStore.addMessage(canvasId, podId, 'user', '');

    await executeStreamingChat(
      { canvasId, podId, message: '', abortable: false },
      {
        onComplete: async (canvasId, podId) => {
          fireAndForget(
            autoClearService.onPodComplete(canvasId, podId),
            'Schedule',
            'autoClear 處理失敗'
          );
          fireAndForget(
            workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
            'Schedule',
            'workflow 觸發失敗'
          );
        },
      }
    );
  }
}

export const scheduleService = new ScheduleService();
