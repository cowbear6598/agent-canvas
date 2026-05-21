import { describe, it, expect } from "vitest";
import { buildScheduleUpdates } from "../../src/handlers/podHandlers.js";
import type { ScheduleConfig } from "../../src/types";

/** 建立基本排程設定的輔助函數 */
function makeScheduleInput(
  overrides: Partial<ScheduleConfig> = {},
): ScheduleConfig {
  return {
    frequency: "every-day",
    second: 0,
    intervalMinute: 5,
    intervalHour: 1,
    hour: 9,
    minute: 0,
    weekdays: [],
    enabled: true,
    lastTriggeredAt: null,
    ...overrides,
  };
}

describe("buildScheduleUpdates", () => {
  describe("首次啟用（從 disabled 變 enabled）", () => {
    it("every-day 啟用時 lastTriggeredAt 應為 null", () => {
      const schedule = makeScheduleInput({ frequency: "every-day" });
      const existingSchedule = makeScheduleInput({
        frequency: "every-day",
        enabled: false,
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeNull();
    });

    it("every-week 啟用時 lastTriggeredAt 應為 null", () => {
      const schedule = makeScheduleInput({
        frequency: "every-week",
        weekdays: [1, 3, 5],
      });
      // 先前不存在排程
      const existingSchedule = null;

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeNull();
    });

    it("every-x-minute 啟用時 lastTriggeredAt 應為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 10,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 10,
        enabled: false,
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("every-x-hour 啟用時 lastTriggeredAt 應為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({
        frequency: "every-x-hour",
        intervalHour: 2,
      });
      // 先前不存在排程
      const existingSchedule = undefined;

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("every-second 啟用時 lastTriggeredAt 應為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({ frequency: "every-second" });
      const existingSchedule = null;

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("已啟用且設定有變更", () => {
    it("every-day 更新 hour 時 lastTriggeredAt 應重置為 null", () => {
      const schedule = makeScheduleInput({
        frequency: "every-day",
        hour: 10,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-day",
        hour: 9,
        enabled: true,
        lastTriggeredAt: new Date("2026-03-19T09:00:00Z"),
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeNull();
    });

    it("every-week 更新 weekdays 時 lastTriggeredAt 應重置為 null", () => {
      const schedule = makeScheduleInput({
        frequency: "every-week",
        weekdays: [1, 2, 3],
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-week",
        weekdays: [1, 3, 5],
        enabled: true,
        lastTriggeredAt: new Date("2026-03-18T09:00:00Z"),
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeNull();
    });

    it("every-x-minute 更新 intervalMinute 時 lastTriggeredAt 應重置為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 15,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 5,
        enabled: true,
        lastTriggeredAt: new Date("2026-03-19T08:00:00Z"),
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("從 every-day 變更為 every-x-hour 時 lastTriggeredAt 應重置為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({
        frequency: "every-x-hour",
        intervalHour: 2,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-day",
        enabled: true,
        lastTriggeredAt: new Date("2026-03-19T09:00:00Z"),
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("every-second 更新 second 值時 lastTriggeredAt 應重置為近似現在的時間", () => {
      const before = Date.now();
      const schedule = makeScheduleInput({
        frequency: "every-second",
        second: 10,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-second",
        second: 5,
        enabled: true,
        lastTriggeredAt: new Date("2026-03-19T08:00:00Z"),
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);
      const after = Date.now();

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBeInstanceOf(Date);
      const ts = result.schedule!.lastTriggeredAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("已啟用且設定沒有變更", () => {
    it("every-day 設定不變時 lastTriggeredAt 應保留原值", () => {
      const originalDate = new Date("2026-03-19T09:00:00Z");
      const schedule = makeScheduleInput({
        frequency: "every-day",
        hour: 9,
        minute: 0,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-day",
        hour: 9,
        minute: 0,
        enabled: true,
        lastTriggeredAt: originalDate,
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBe(originalDate);
    });

    it("every-x-minute 設定不變時 lastTriggeredAt 應保留原值", () => {
      const originalDate = new Date("2026-03-19T08:30:00Z");
      const schedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 5,
      });
      const existingSchedule = makeScheduleInput({
        frequency: "every-x-minute",
        intervalMinute: 5,
        enabled: true,
        lastTriggeredAt: originalDate,
      });

      const result = buildScheduleUpdates(schedule, existingSchedule);

      expect(result.schedule).not.toBeNull();
      expect(result.schedule!.lastTriggeredAt).toBe(originalDate);
    });
  });

  describe("schedule 為 null（清除排程）", () => {
    it("應回傳 { schedule: null }", () => {
      const existingSchedule = makeScheduleInput({ enabled: true });

      const result = buildScheduleUpdates(null, existingSchedule);

      expect(result).toEqual({ schedule: null });
    });
  });
});
