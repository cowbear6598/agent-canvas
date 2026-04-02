import type { FrequencyType, Schedule } from "@/types/pod";
import { MS_PER_SECOND, MS_PER_MINUTE, MS_PER_HOUR } from "@/lib/constants";
import { t } from "@/i18n";

/**
 * 格式化 Schedule 頻率為可讀文字
 */
export function formatScheduleFrequency(schedule: Schedule): string {
  const { frequency } = schedule;

  switch (frequency) {
    case "every-second":
      return t("schedule.everySecond");
    case "every-x-minute":
      return t("schedule.everyXMinute", { n: schedule.intervalMinute });
    case "every-x-hour":
      return t("schedule.everyXHour", { n: schedule.intervalHour });
    case "every-day": {
      const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
      return t("schedule.everyDay", { time });
    }
    case "every-week": {
      const days = schedule.weekdays
        .sort((a, b) => a - b)
        .map((d) =>
          t(
            `schedule.weekdays.${d}` as `schedule.weekdays.${0 | 1 | 2 | 3 | 4 | 5 | 6}`,
          ),
        )
        .join(t("schedule.weekdaySeparator"));
      const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
      return t("schedule.everyWeek", { days, time });
    }
    default:
      return t("schedule.unknownFrequency");
  }
}

interface TzDateParts {
  tzOffsetMs: number;
  nowUtcMs: number;
  tzYear: number;
  tzMonth: number;
  tzDay: number;
  day: number;
}

/**
 * 將 now 轉換為指定時區的日期各部分
 */
function getTzDateParts(now: Date, timezoneOffset: number): TzDateParts {
  const tzOffsetMs = timezoneOffset * MS_PER_HOUR;
  const nowUtcMs = now.getTime();
  const tzDate = new Date(nowUtcMs + tzOffsetMs);
  return {
    tzOffsetMs,
    nowUtcMs,
    tzYear: tzDate.getUTCFullYear(),
    tzMonth: tzDate.getUTCMonth(),
    tzDay: tzDate.getUTCDate(),
    day: tzDate.getUTCDay(),
  };
}

type TriggerTimeCalculator = (
  schedule: Schedule,
  now: Date,
  last: Date,
  timezoneOffset: number,
) => Date;

function calculateEverySecond(
  _schedule: Schedule,
  now: Date,
  last: Date,
  _timezoneOffset: number,
): Date {
  const next = new Date(last.getTime() + MS_PER_SECOND);
  return next > now ? next : new Date(now.getTime() + MS_PER_SECOND);
}

function calculateEveryXMinute(
  schedule: Schedule,
  now: Date,
  last: Date,
  _timezoneOffset: number,
): Date {
  const next = new Date(
    last.getTime() + schedule.intervalMinute * MS_PER_MINUTE,
  );
  return next > now
    ? next
    : new Date(now.getTime() + schedule.intervalMinute * MS_PER_MINUTE);
}

function calculateEveryXHour(
  schedule: Schedule,
  now: Date,
  last: Date,
  _timezoneOffset: number,
): Date {
  const next = new Date(last.getTime() + schedule.intervalHour * MS_PER_HOUR);
  return next > now
    ? next
    : new Date(now.getTime() + schedule.intervalHour * MS_PER_HOUR);
}

function calculateEveryDay(
  schedule: Schedule,
  now: Date,
  _last: Date,
  timezoneOffset: number,
): Date {
  // 計算指定時區下的當前日期
  const { tzOffsetMs, nowUtcMs, tzYear, tzMonth, tzDay } = getTzDateParts(
    now,
    timezoneOffset,
  );

  // 在指定時區設定 schedule 的 hour/minute，再轉回 UTC
  // 指定時區的觸發時間（視為 UTC 計算）
  const tzTriggerMs = Date.UTC(
    tzYear,
    tzMonth,
    tzDay,
    schedule.hour,
    schedule.minute,
    0,
    0,
  );
  // 轉換回真正的 UTC 時間戳
  const nextUtcMs = tzTriggerMs - tzOffsetMs;

  if (nextUtcMs <= nowUtcMs) {
    // 已過，改為明天
    const tzTriggerNextDayMs = Date.UTC(
      tzYear,
      tzMonth,
      tzDay + 1,
      schedule.hour,
      schedule.minute,
      0,
      0,
    );
    return new Date(tzTriggerNextDayMs - tzOffsetMs);
  }

  return new Date(nextUtcMs);
}

function calculateEveryWeek(
  schedule: Schedule,
  now: Date,
  _last: Date,
  timezoneOffset: number,
): Date {
  const sortedWeekdays = schedule.weekdays.slice().sort((a, b) => a - b);

  if (sortedWeekdays.length === 0) {
    return new Date(now.getTime() + MS_PER_MINUTE);
  }

  // 計算指定時區下的當前日期與星期
  const {
    tzOffsetMs,
    nowUtcMs,
    tzYear,
    tzMonth,
    tzDay,
    day: currentDay,
  } = getTzDateParts(now, timezoneOffset);

  // 計算指定時區今天 schedule 時間點的 UTC 時間戳
  const tzTriggerTodayMs = Date.UTC(
    tzYear,
    tzMonth,
    tzDay,
    schedule.hour,
    schedule.minute,
    0,
    0,
  );
  const nextUtcTodayMs = tzTriggerTodayMs - tzOffsetMs;

  const targetDay = sortedWeekdays.find((day) => {
    if (day > currentDay) return true;
    return day === currentDay && nextUtcTodayMs > nowUtcMs;
  });

  let daysToAdd: number;
  if (targetDay === undefined) {
    const firstDay = sortedWeekdays[0]!;
    daysToAdd = (7 - currentDay + firstDay) % 7 || 7;
  } else {
    daysToAdd = targetDay - currentDay;
  }

  const tzTriggerMs = Date.UTC(
    tzYear,
    tzMonth,
    tzDay + daysToAdd,
    schedule.hour,
    schedule.minute,
    0,
    0,
  );
  return new Date(tzTriggerMs - tzOffsetMs);
}

const triggerTimeCalculators: Record<FrequencyType, TriggerTimeCalculator> = {
  "every-second": calculateEverySecond,
  "every-x-minute": calculateEveryXMinute,
  "every-x-hour": calculateEveryXHour,
  "every-day": calculateEveryDay,
  "every-week": calculateEveryWeek,
};

export function getNextTriggerTime(
  schedule: Schedule,
  lastTriggeredAt?: string | null,
  timezoneOffset = 8,
): Date {
  const now = new Date();
  const last = lastTriggeredAt ? new Date(lastTriggeredAt) : now;
  const calculator = triggerTimeCalculators[schedule.frequency];

  if (!calculator) return now;

  return calculator(schedule, now, last, timezoneOffset);
}

/**
 * 格式化 Schedule Tooltip 文字
 */
export function formatScheduleTooltip(
  schedule: Schedule,
  timezoneOffset = 8,
): string {
  const frequency = formatScheduleFrequency(schedule);
  const nextTime = getNextTriggerTime(
    schedule,
    schedule.lastTriggeredAt,
    timezoneOffset,
  );

  // 將 UTC 時間轉換為指定時區的顯示時間
  const tzDate = new Date(nextTime.getTime() + timezoneOffset * MS_PER_HOUR);
  const timeStr = `${String(tzDate.getUTCHours()).padStart(2, "0")}:${String(tzDate.getUTCMinutes()).padStart(2, "0")}`;

  return t("schedule.nextTime", { frequency, time: timeStr });
}
