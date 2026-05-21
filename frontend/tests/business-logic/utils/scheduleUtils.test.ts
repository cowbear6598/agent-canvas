import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatScheduleFrequency,
  getNextTriggerTime,
  formatScheduleTooltip,
} from "@/utils/scheduleUtils";
import type { Schedule } from "@/types/pod";

describe("scheduleUtils", () => {
  describe("formatScheduleFrequency", () => {
    it("應該格式化「每秒」頻率", () => {
      const schedule: Schedule = {
        frequency: "every-second",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每秒");
    });

    it("應該格式化「每 X 分鐘」頻率", () => {
      const schedule: Schedule = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 5,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每 5 分鐘");
    });

    it("應該格式化「每 X 小時」頻率", () => {
      const schedule: Schedule = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 3,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每 3 小時");
    });

    it("應該格式化「每天」頻率", () => {
      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 9,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每天 09:30");
    });

    it("應該格式化「每週」頻率（單一天）", () => {
      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 14,
        minute: 0,
        weekdays: [1],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每週一 14:00");
    });

    it("應該格式化「每週」頻率（多個天）", () => {
      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [1, 3, 5],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("每週一、三、五 10:00");
    });

    it("應該處理未知頻率", () => {
      const schedule = {
        frequency: "unknown",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      } as any;

      const result = formatScheduleFrequency(schedule);
      expect(result).toBe("未知頻率");
    });
  });

  describe("getNextTriggerTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("應該計算「每秒」的下次觸發時間", () => {
      const now = new Date("2026-02-08T10:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-second",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getTime()).toBe(now.getTime() + 1000);
    });

    it("應該計算「每秒」的下次觸發時間（有上次觸發時間）", () => {
      const now = new Date("2026-02-08T10:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-second",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: "2026-02-08T09:59:59",
      };

      const result = getNextTriggerTime(schedule, schedule.lastTriggeredAt);
      expect(result.getTime()).toBe(now.getTime() + 1000);
    });

    it("應該計算「每 X 分鐘」的下次觸發時間", () => {
      const now = new Date("2026-02-08T10:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 5,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getTime()).toBe(now.getTime() + 5 * 60 * 1000);
    });

    it("應該計算「每 X 小時」的下次觸發時間", () => {
      const now = new Date("2026-02-08T10:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 2,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
    });

    it("應該計算「每天」的下次觸發時間（今天尚未執行）", () => {
      // UTC 01:00 = UTC+8 09:00，排程設定 10:30，尚未到達
      vi.setSystemTime(new Date("2026-02-08T01:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      // UTC+8 10:30 = UTC 02:30，同一天（2/8）
      expect(result.getUTCHours()).toBe(2);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCDate()).toBe(8);
    });

    it("應該計算「每天」的下次觸發時間（今天已執行）", () => {
      // UTC 04:00 = UTC+8 12:00，排程設定 10:30，已過
      vi.setSystemTime(new Date("2026-02-08T04:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      // 明天 UTC+8 10:30 = 明天 UTC 02:30（2/9）
      expect(result.getUTCHours()).toBe(2);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCDate()).toBe(9);
    });

    it("應該計算「每週」的下次觸發時間（本週有下次）", () => {
      // UTC 00:00（週一）= UTC+8 08:00（週一），weekdays=[3,5]，下次是週三
      vi.setSystemTime(new Date("2026-02-09T00:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [3, 5],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      // UTC+8 週三 10:00 = UTC 週三 02:00（2026-02-11T02:00:00Z）
      expect(result.getUTCDay()).toBe(3);
      expect(result.getUTCHours()).toBe(2);
      expect(result.getUTCMinutes()).toBe(0);
    });

    it("應該計算「每週」的下次觸發時間（需要下週）", () => {
      const now = new Date("2026-02-13T12:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [1],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getDay()).toBe(1);
      expect(result.getDate()).toBe(16);
    });

    it("應該計算「每週」的下次觸發時間（當天但時間已過）", () => {
      const now = new Date("2026-02-09T12:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [1],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getDay()).toBe(1);
      expect(result.getDate()).toBe(16);
    });

    it("應該處理「每週」空的 weekdays", () => {
      const now = new Date("2026-02-08T10:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule);
      expect(result.getTime()).toBe(now.getTime() + 60 * 1000);
    });

    it("getNextTriggerTime 接收 timezoneOffset=8 時，每天排程應以 UTC+8 計算下次觸發時間", () => {
      // UTC 02:00 = UTC+8 10:00，排程設定 12:00，所以下次觸發是 UTC+8 12:00 = UTC 04:00
      vi.setSystemTime(new Date("2026-02-08T02:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule, null, 8);
      expect(result.toISOString()).toBe("2026-02-08T04:00:00.000Z");
    });

    it("getNextTriggerTime 接收 timezoneOffset=0 時，每天排程應以 UTC 計算下次觸發時間", () => {
      // UTC 10:00，排程設定 12:00，下次是 UTC 12:00
      vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule, null, 0);
      expect(result.toISOString()).toBe("2026-02-08T12:00:00.000Z");
    });

    it("getNextTriggerTime 接收 timezoneOffset=-5 時，每天排程應以 UTC-5 計算下次觸發時間", () => {
      // UTC 15:00 = UTC-5 10:00，排程設定 12:00，下次是 UTC-5 12:00 = UTC 17:00
      vi.setSystemTime(new Date("2026-02-08T15:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 12,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule, null, -5);
      expect(result.toISOString()).toBe("2026-02-08T17:00:00.000Z");
    });

    it("calculateEveryDay 接收 timezoneOffset 時應正確計算跨日情境", () => {
      // UTC 23:00 = UTC+8 2/9 07:00，排程設定 06:00，UTC+8 2/9 06:00 已過，下次是 2/10 06:00 UTC+8 = UTC 2/9 22:00
      vi.setSystemTime(new Date("2026-02-08T23:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 6,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule, null, 8);
      expect(result.toISOString()).toBe("2026-02-09T22:00:00.000Z");
    });

    it("calculateEveryWeek 接收 timezoneOffset 時應正確計算跨日的星期判斷", () => {
      // UTC 2/8 20:00 = UTC+8 2/9 04:00（星期一）
      // 排程：星期一 10:00 UTC+8 = UTC 02:00，下次 = 2026-02-09T02:00:00Z
      vi.setSystemTime(new Date("2026-02-08T20:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [1],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = getNextTriggerTime(schedule, null, 8);
      expect(result.toISOString()).toBe("2026-02-09T02:00:00.000Z");
    });
  });

  describe("formatScheduleTooltip", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("應該格式化排程提示（每秒）", () => {
      // UTC 02:00 = UTC+8 10:00，下次觸發 +1s 後，tooltip 應顯示 UTC+8 的 10:00
      vi.setSystemTime(new Date("2026-02-08T02:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-second",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleTooltip(schedule);
      expect(result).toBe("每秒 | 下次：10:00");
    });

    it("應該格式化排程提示（每天）", () => {
      const now = new Date("2026-02-08T08:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 14,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleTooltip(schedule);
      expect(result).toBe("每天 14:30 | 下次：14:30");
    });

    it("應該格式化排程提示（每週）", () => {
      const now = new Date("2026-02-08T08:00:00");
      vi.setSystemTime(now);

      const schedule: Schedule = {
        frequency: "every-week",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 10,
        minute: 0,
        weekdays: [1, 3, 5],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleTooltip(schedule);
      expect(result).toContain("每週一、三、五 10:00");
      expect(result).toContain("下次：");
    });

    it("formatScheduleTooltip 接收 timezoneOffset 時應顯示正確的下次觸發時間", () => {
      // UTC 02:00 = UTC+8 10:00，排程設定 14:30，下次顯示應為 14:30（UTC+8 時間）
      vi.setSystemTime(new Date("2026-02-08T02:00:00Z"));

      const schedule: Schedule = {
        frequency: "every-day",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 14,
        minute: 30,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result = formatScheduleTooltip(schedule, 8);
      expect(result).toContain("下次：14:30");
    });

    it("每秒、每 X 分鐘、每 X 小時頻率不受 timezoneOffset 影響（基於間隔計算）", () => {
      vi.setSystemTime(new Date("2026-02-08T10:00:00Z"));

      const secondSchedule: Schedule = {
        frequency: "every-second",
        second: 0,
        intervalMinute: 0,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const minuteSchedule: Schedule = {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 5,
        intervalHour: 0,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const hourSchedule: Schedule = {
        frequency: "every-x-hour",
        second: 0,
        intervalMinute: 0,
        intervalHour: 2,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
        lastTriggeredAt: null,
      };

      const result0Second = getNextTriggerTime(secondSchedule, null, 0);
      const result8Second = getNextTriggerTime(secondSchedule, null, 8);
      expect(result0Second.getTime()).toBe(result8Second.getTime());

      const result0Minute = getNextTriggerTime(minuteSchedule, null, 0);
      const result8Minute = getNextTriggerTime(minuteSchedule, null, 8);
      expect(result0Minute.getTime()).toBe(result8Minute.getTime());

      const result0Hour = getNextTriggerTime(hourSchedule, null, 0);
      const result8Hour = getNextTriggerTime(hourSchedule, null, 8);
      expect(result0Hour.getTime()).toBe(result8Hour.getTime());
    });
  });
});
