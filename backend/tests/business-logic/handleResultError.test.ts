import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: vi.fn(),
  },
}));

import { emitError } from "../../src/utils/websocketResponse.js";
import { handleResultError } from "../../src/utils/handlerHelpers.js";
import type { Result } from "../../src/types/index.js";

const mockEmitError = emitError as ReturnType<typeof vi.fn>;

const CONNECTION_ID = "conn-1";
const EVENT = "chat:send" as const;
const REQUEST_ID = "req-1";
const FALLBACK_ERROR = "發生未知錯誤";
const CANVAS_ID = "canvas-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleResultError", () => {
  describe("success: false 時", () => {
    it("應呼叫 emitError 並回傳 true", () => {
      const result: Result<string> = { success: false, error: "操作失敗" };

      const isError = handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        CANVAS_ID,
      );

      expect(isError).toBe(true);
      expect(mockEmitError).toHaveBeenCalledOnce();
    });

    it("有傳入 errorCode 時應使用該 errorCode", () => {
      const result: Result<string> = { success: false, error: "資源不存在" };

      handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        CANVAS_ID,
        "NOT_FOUND",
      );

      expect(mockEmitError).toHaveBeenCalledWith(
        CONNECTION_ID,
        EVENT,
        "資源不存在",
        CANVAS_ID,
        REQUEST_ID,
        undefined,
        "NOT_FOUND",
      );
    });

    it("未傳入 errorCode 時應 fallback 至 INTERNAL_ERROR", () => {
      const result: Result<string> = { success: false, error: "系統錯誤" };

      handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        CANVAS_ID,
      );

      expect(mockEmitError).toHaveBeenCalledWith(
        CONNECTION_ID,
        EVENT,
        "系統錯誤",
        CANVAS_ID,
        REQUEST_ID,
        undefined,
        "INTERNAL_ERROR",
      );
    });

    it("result.error 為 undefined 時應使用 fallbackError", () => {
      const result = {
        success: false,
        error: undefined,
      } as unknown as Result<string>;

      handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        CANVAS_ID,
      );

      expect(mockEmitError).toHaveBeenCalledWith(
        CONNECTION_ID,
        EVENT,
        FALLBACK_ERROR,
        CANVAS_ID,
        REQUEST_ID,
        undefined,
        "INTERNAL_ERROR",
      );
    });

    it("canvasId 為 null 時（app 層級操作）應傳遞 null", () => {
      const result: Result<string> = { success: false, error: "系統錯誤" };

      handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        null,
      );

      expect(mockEmitError).toHaveBeenCalledWith(
        CONNECTION_ID,
        EVENT,
        "系統錯誤",
        null,
        REQUEST_ID,
        undefined,
        "INTERNAL_ERROR",
      );
    });
  });

  describe("success: true 時", () => {
    it("不應呼叫 emitError 並回傳 false", () => {
      const result: Result<string> = { success: true, data: "成功結果" };

      const isError = handleResultError(
        result,
        CONNECTION_ID,
        EVENT,
        REQUEST_ID,
        FALLBACK_ERROR,
        CANVAS_ID,
      );

      expect(isError).toBe(false);
      expect(mockEmitError).not.toHaveBeenCalled();
    });
  });
});
