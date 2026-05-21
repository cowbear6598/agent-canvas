import { describe, it, expect } from "vitest";
import {
  SDK_ERROR_MESSAGES,
  getSdkErrorMessage,
  checkRateLimitEvent,
  checkAuthStatus,
  formatApiRetryMessage,
  checkAssistantError,
} from "../../src/services/claude/sdkErrorMapper.js";

describe("sdkErrorMapper", () => {
  describe("getSdkErrorMessage", () => {
    it("已知的錯誤類型應回傳對應訊息", () => {
      expect(getSdkErrorMessage("rate_limit")).toBe(
        SDK_ERROR_MESSAGES.rate_limit,
      );
      expect(getSdkErrorMessage("authentication_failed")).toBe(
        SDK_ERROR_MESSAGES.authentication_failed,
      );
    });

    it("未知的錯誤類型應回傳預設訊息", () => {
      expect(getSdkErrorMessage("unknown_error")).toBe(
        "與 Claude 通訊時發生錯誤，請稍後再試",
      );
    });
  });

  describe("checkRateLimitEvent", () => {
    it("status 為 rejected 時應回傳 shouldAbort: true 和正確的使用者訊息", () => {
      const result = checkRateLimitEvent({ status: "rejected" });

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe(SDK_ERROR_MESSAGES.billing_error);
    });

    it("status 為 allowed_warning 時應回傳 shouldAbort: false", () => {
      const result = checkRateLimitEvent({ status: "allowed_warning" });

      expect(result.shouldAbort).toBe(false);
    });

    it("status 為其他值時應回傳 shouldAbort: false", () => {
      const result = checkRateLimitEvent({ status: "allowed" });

      expect(result.shouldAbort).toBe(false);
    });
  });

  describe("checkAuthStatus", () => {
    it("帶有 error 時應回傳 shouldAbort: true 和正確的使用者訊息", () => {
      const result = checkAuthStatus("auth_failed");

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe(SDK_ERROR_MESSAGES.authentication_failed);
    });

    it("無 error（undefined）時應回傳 shouldAbort: false", () => {
      const result = checkAuthStatus(undefined);

      expect(result.shouldAbort).toBe(false);
    });

    it("error 為空字串時應回傳 shouldAbort: false", () => {
      const result = checkAuthStatus("");

      expect(result.shouldAbort).toBe(false);
    });
  });

  describe("formatApiRetryMessage", () => {
    it("有 error_status 時應正確格式化重試訊息", () => {
      const message = formatApiRetryMessage(2, 5, 429);

      expect(message).toBe("⚠️ API 請求失敗（429），正在重試（第 2/5 次）...");
    });

    it("error_status 為 null 時應正確格式化重試訊息（不含狀態碼）", () => {
      const message = formatApiRetryMessage(1, 3, null);

      expect(message).toBe("⚠️ API 請求失敗，正在重試（第 1/3 次）...");
    });
  });

  describe("checkAssistantError", () => {
    it("error 為 rate_limit 時應回傳 shouldAbort: true 和對應訊息", () => {
      const result = checkAssistantError("rate_limit");

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe(SDK_ERROR_MESSAGES.rate_limit);
    });

    it("error 為 authentication_failed 時應回傳 shouldAbort: true 和對應訊息", () => {
      const result = checkAssistantError("authentication_failed");

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe(SDK_ERROR_MESSAGES.authentication_failed);
    });

    it("error 為 billing_error 時應回傳 shouldAbort: true 和對應訊息", () => {
      const result = checkAssistantError("billing_error");

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe(SDK_ERROR_MESSAGES.billing_error);
    });

    it("error 為未知類型時應回傳 shouldAbort: true 和預設訊息", () => {
      const result = checkAssistantError("unknown_error_type");

      expect(result.shouldAbort).toBe(true);
      expect(result.userMessage).toBe("與 Claude 通訊時發生錯誤，請稍後再試");
    });

    it("無 error（undefined）時應回傳 shouldAbort: false", () => {
      const result = checkAssistantError(undefined);

      expect(result.shouldAbort).toBe(false);
    });
  });
});
