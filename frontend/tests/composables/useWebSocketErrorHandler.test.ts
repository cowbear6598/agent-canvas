import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";

// Mock functions
const { mockToast, mockSanitizeErrorForUser } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockSanitizeErrorForUser: vi.fn(),
}));

// Mock useToast
const mockShowErrorToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

// Mock sanitizeErrorForUser
vi.mock("@/utils/errorSanitizer", () => ({
  sanitizeErrorForUser: mockSanitizeErrorForUser,
}));

describe("useWebSocketErrorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSanitizeErrorForUser.mockImplementation((error: unknown) => {
      if (error instanceof Error) return error.message;
      if (typeof error === "string") return error;
      return "未知錯誤";
    });
  });

  // Mock 型別協助
  type ToastCategory = "Pod" | "Canvas" | "Slack";

  describe("handleWebSocketError", () => {
    it("應呼叫 toast 顯示錯誤訊息（variant: destructive）", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();
      const error = new Error("測試錯誤");

      handleWebSocketError(error);

      expect(mockToast).toHaveBeenCalledWith({
        title: "操作失敗",
        description: "測試錯誤",
        variant: "destructive",
      });
    });

    it("應使用 sanitizeErrorForUser 處理 error", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();
      const error = new Error("原始錯誤訊息");

      handleWebSocketError(error);

      expect(mockSanitizeErrorForUser).toHaveBeenCalledWith(error);
    });

    it("應使用預設 title「操作失敗」", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();

      handleWebSocketError(new Error("錯誤"));

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "操作失敗",
        }),
      );
    });

    it("應允許自訂 title", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();

      handleWebSocketError(new Error("錯誤"), "自訂標題");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "自訂標題",
        }),
      );
    });

    it("應處理字串類型的 error", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();
      mockSanitizeErrorForUser.mockReturnValueOnce("字串錯誤訊息");

      handleWebSocketError("字串錯誤");

      expect(mockSanitizeErrorForUser).toHaveBeenCalledWith("字串錯誤");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "字串錯誤訊息",
        }),
      );
    });

    it("應處理 unknown 類型的 error", () => {
      const { handleWebSocketError } = useWebSocketErrorHandler();
      const unknownError = { some: "object" };
      mockSanitizeErrorForUser.mockReturnValueOnce("未知錯誤");

      handleWebSocketError(unknownError);

      expect(mockSanitizeErrorForUser).toHaveBeenCalledWith(unknownError);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "未知錯誤",
        }),
      );
    });
  });

  describe("wrapWebSocketRequest", () => {
    it("成功時應回傳 Promise 結果", async () => {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler();
      const successData = { id: "123", name: "Test" };
      const promise = Promise.resolve(successData);

      const result = await wrapWebSocketRequest(promise);

      expect(result).toEqual(successData);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("失敗時不顯示 toast，僅回傳 null", async () => {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler();
      const error = new Error("Request failed");
      const promise = Promise.reject(error);

      const result = await wrapWebSocketRequest(promise);

      expect(result).toBeNull();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("失敗後不應 throw error（應回傳 null）", async () => {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler();
      const promise = Promise.reject(new Error("Test error"));

      await expect(wrapWebSocketRequest(promise)).resolves.toBeNull();
    });

    it("應正確處理 async function 作為輸入", async () => {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler();
      const asyncFunc = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { result: "async success" };
      };

      const result = await wrapWebSocketRequest(asyncFunc());

      expect(result).toEqual({ result: "async success" });
    });

    it("應正確處理 async function 拋出的錯誤（回傳 null，不顯示 toast）", async () => {
      const { wrapWebSocketRequest } = useWebSocketErrorHandler();
      const asyncFunc = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("Async error");
      };

      const result = await wrapWebSocketRequest(asyncFunc());

      expect(result).toBeNull();
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("withErrorToast", () => {
    it("成功時應回傳 promise 結果", async () => {
      const { withErrorToast } = useWebSocketErrorHandler();
      const successData = { id: "123", name: "Test" };

      const result = await withErrorToast(
        Promise.resolve(successData),
        "Canvas" as ToastCategory,
        "建立失敗",
      );

      expect(result).toEqual(successData);
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it("失敗時應顯示 error toast 並回傳 null", async () => {
      const { withErrorToast } = useWebSocketErrorHandler();
      const error = new Error("操作失敗");

      const result = await withErrorToast(
        Promise.reject(error),
        "Canvas" as ToastCategory,
        "建立失敗",
      );

      expect(result).toBeNull();
      expect(mockShowErrorToast).toHaveBeenCalledOnce();
    });

    it("失敗時 toast 包含正確的 category 和 action", async () => {
      const { withErrorToast } = useWebSocketErrorHandler();
      const error = new Error("網路錯誤");

      await withErrorToast(
        Promise.reject(error),
        "Pod" as ToastCategory,
        "刪除失敗",
      );

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "Pod",
        "刪除失敗",
        "網路錯誤",
      );
    });

    it("rethrow: true 時失敗後顯示 toast 並重新拋出錯誤", async () => {
      const { withErrorToast } = useWebSocketErrorHandler();
      const error = new Error("嚴重錯誤");

      await expect(
        withErrorToast(
          Promise.reject(error),
          "Pod" as ToastCategory,
          "建立失敗",
          { rethrow: true },
        ),
      ).rejects.toThrow("嚴重錯誤");

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "Pod",
        "建立失敗",
        "嚴重錯誤",
      );
    });

    it("rethrow 未設定（預設）時失敗後不拋出錯誤", async () => {
      const { withErrorToast } = useWebSocketErrorHandler();
      const error = new Error("錯誤");

      await expect(
        withErrorToast(
          Promise.reject(error),
          "Slack" as ToastCategory,
          "綁定失敗",
        ),
      ).resolves.toBeNull();
    });
  });
});
