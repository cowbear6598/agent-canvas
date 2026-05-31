import { describe, expect, it } from "vitest";
import { buildScheduleMessage } from "../../src/services/scheduleService.js";

describe("ScheduleService", () => {
  describe("buildScheduleMessage", () => {
    it("空字串時應回傳固定的 schedule 標籤訊息", () => {
      const result = buildScheduleMessage({} as never, "");

      expect(result).toBe("<schedule>完成 Goal</schedule>");
    });

    it("非空訊息時應保留原始內容", () => {
      const result = buildScheduleMessage({} as never, "自訂排程內容");

      expect(result).toBe("自訂排程內容");
    });
  });
});
