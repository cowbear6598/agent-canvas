import { describe, it, expect } from "vitest";
import { jiraProviderConfig } from "@/integration/providers/jiraProvider";

describe("jiraProvider", () => {
  describe("bindingExtraFields", () => {
    it("bindingExtraFields 為長度 1 的陣列", () => {
      const fields = jiraProviderConfig.bindingExtraFields ?? [];
      expect(fields).toHaveLength(1);
    });

    it("第一個 field 的 key 為 eventFilter", () => {
      const field = (jiraProviderConfig.bindingExtraFields ?? [])[0];
      expect(field?.key).toBe("eventFilter");
    });

    it("eventFilter options 包含 all 和 status_changed", () => {
      const field = (jiraProviderConfig.bindingExtraFields ?? [])[0];
      const values = field?.options.map((o) => o.value) ?? [];
      expect(values).toContain("all");
      expect(values).toContain("status_changed");
    });

    it("預設值（defaultValue）為 all", () => {
      const field = (jiraProviderConfig.bindingExtraFields ?? [])[0];
      expect(field?.defaultValue).toBe("all");
    });
  });

  describe("buildBindPayload", () => {
    it("選擇 status_changed 後 payload 包含正確的 extra.eventFilter", () => {
      const payload = jiraProviderConfig.buildBindPayload("app1", "*", {
        eventFilter: "status_changed",
      });
      expect(payload).toEqual({
        appId: "app1",
        resourceId: "*",
        extra: { eventFilter: "status_changed" },
      });
    });

    it("編輯已綁定的 Jira binding 時回填 all 選項後 payload 正確", () => {
      const payload = jiraProviderConfig.buildBindPayload("app1", "*", {
        eventFilter: "all",
      });
      expect(payload).toEqual({
        appId: "app1",
        resourceId: "*",
        extra: { eventFilter: "all" },
      });
    });

    it("resourceId 固定為 * 無論傳入何值", () => {
      const payload = jiraProviderConfig.buildBindPayload("app1", "PROJ-123", {
        eventFilter: "all",
      });
      expect(payload).toMatchObject({ resourceId: "*" });
    });

    it("extra.eventFilter 帶入請求中", () => {
      const payload1 = jiraProviderConfig.buildBindPayload("app1", "*", {
        eventFilter: "all",
      });
      const payload2 = jiraProviderConfig.buildBindPayload("app1", "*", {
        eventFilter: "status_changed",
      });
      expect(
        (payload1 as { extra: { eventFilter: string } }).extra.eventFilter,
      ).toBe("all");
      expect(
        (payload2 as { extra: { eventFilter: string } }).extra.eventFilter,
      ).toBe("status_changed");
    });
  });
});
