import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToast } from "@/composables/useToast";
import * as utils from "@/services/utils";

// Mock generateUUID
vi.mock("@/services/utils", () => ({
  generateUUID: vi.fn(),
}));

describe("useToast", () => {
  let mockUUIDCounter: number;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUUIDCounter = 0;

    // Mock generateUUID 回傳遞增的 id
    vi.mocked(utils.generateUUID).mockImplementation(() => {
      mockUUIDCounter++;
      return `toast-${mockUUIDCounter}`;
    });

    // 清空 toasts 陣列（避免測試間互相影響）
    const { toasts } = useToast();
    toasts.value = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("toast", () => {
    it("應新增 Toast 到 toasts 陣列", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Test Title", description: "Test Description" });

      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0]).toMatchObject({
        id: "toast-1",
        title: "Test Title",
        description: "Test Description",
        duration: 3000,
        variant: "default",
      });
    });

    it("應回傳唯一的 id", () => {
      const { toast } = useToast();

      const id1 = toast({ title: "Title 1" });
      const id2 = toast({ title: "Title 2" });

      expect(id1).toBe("toast-1");
      expect(id2).toBe("toast-2");
      expect(id1).not.toBe(id2);
    });

    it("預設 variant 應為 default", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Test" });

      expect(toasts.value[0]?.variant).toBe("default");
    });

    it("應接受自訂 variant", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Success", variant: "success" });
      toast({ title: "Error", variant: "destructive" });

      expect(toasts.value[0]?.variant).toBe("success");
      expect(toasts.value[1]?.variant).toBe("destructive");
    });

    it("應接受自訂 duration", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Test", duration: 5000 });

      expect(toasts.value[0]?.duration).toBe(5000);
    });

    it("description 為 undefined 時應保持 undefined", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Test" });

      expect(toasts.value[0]?.description).toBeUndefined();
    });

    it("description 超過 200 字元時應截斷並加上 ...", () => {
      const { toast, toasts } = useToast();
      const longDescription = "a".repeat(250);

      toast({ title: "Test", description: longDescription });

      expect(toasts.value[0]?.description).toBe("a".repeat(200) + "...");
      expect(toasts.value[0]?.description?.length).toBe(203); // 200 + '...'
    });

    it("description 剛好 200 字元時不應截斷", () => {
      const { toast, toasts } = useToast();
      const exactDescription = "a".repeat(200);

      toast({ title: "Test", description: exactDescription });

      expect(toasts.value[0]?.description).toBe(exactDescription);
      expect(toasts.value[0]?.description?.length).toBe(200);
    });

    it("description 小於 200 字元時應保持原樣", () => {
      const { toast, toasts } = useToast();
      const shortDescription = "Short description";

      toast({ title: "Test", description: shortDescription });

      expect(toasts.value[0]?.description).toBe(shortDescription);
    });

    it("應在 duration 後自動移除 Toast", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Test", duration: 3000 });

      expect(toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(3000);

      expect(toasts.value).toHaveLength(0);
    });

    it("多個 Toast 應依序自動移除", () => {
      const { toast, toasts } = useToast();

      toast({ title: "Toast 1", duration: 1000 });
      toast({ title: "Toast 2", duration: 2000 });
      toast({ title: "Toast 3", duration: 3000 });

      expect(toasts.value).toHaveLength(3);

      vi.advanceTimersByTime(1000);
      expect(toasts.value).toHaveLength(2);
      expect(toasts.value[0]?.title).toBe("Toast 2");
      expect(toasts.value[1]?.title).toBe("Toast 3");

      vi.advanceTimersByTime(1000);
      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0]?.title).toBe("Toast 3");

      vi.advanceTimersByTime(1000);
      expect(toasts.value).toHaveLength(0);
    });
  });

  describe("dismiss", () => {
    it("應依 id 移除指定 Toast", () => {
      const { toast, dismiss, toasts } = useToast();

      const id1 = toast({ title: "Toast 1" });
      const id2 = toast({ title: "Toast 2" });
      const id3 = toast({ title: "Toast 3" });

      expect(toasts.value).toHaveLength(3);

      dismiss(id2);

      expect(toasts.value).toHaveLength(2);
      expect(toasts.value[0]?.id).toBe(id1);
      expect(toasts.value[1]?.id).toBe(id3);
    });

    it("id 不存在時不應報錯", () => {
      const { toast, dismiss, toasts } = useToast();

      toast({ title: "Toast 1" });

      expect(() => dismiss("non-existent-id")).not.toThrow();
      expect(toasts.value).toHaveLength(1);
    });

    it("應能移除第一個 Toast", () => {
      const { toast, dismiss, toasts } = useToast();

      const id1 = toast({ title: "Toast 1" });
      toast({ title: "Toast 2" });

      dismiss(id1);

      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0]?.title).toBe("Toast 2");
    });

    it("應能移除最後一個 Toast", () => {
      const { toast, dismiss, toasts } = useToast();

      toast({ title: "Toast 1" });
      const id2 = toast({ title: "Toast 2" });

      dismiss(id2);

      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0]?.title).toBe("Toast 1");
    });

    it("空陣列時 dismiss 不應報錯", () => {
      const { dismiss, toasts } = useToast();

      expect(() => dismiss("any-id")).not.toThrow();
      expect(toasts.value).toHaveLength(0);
    });
  });

  describe("showSuccessToast", () => {
    it("title 應為 category", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Pod", "建立成功", "Test Pod");

      expect(toasts.value[0]?.title).toBe("Pod");
    });

    it("有 target 時 description 應為 action - target", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Pod", "建立成功", "Test Pod");

      expect(toasts.value[0]?.description).toBe("建立成功 - Test Pod");
    });

    it("無 target 時 description 應僅為 action", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Canvas", "載入完成");

      expect(toasts.value[0]?.description).toBe("載入完成");
    });

    it("target 為 undefined 時 description 應僅為 action", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Workflow", "執行成功", undefined);

      expect(toasts.value[0]?.description).toBe("執行成功");
    });

    it("variant 應為 default", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Repository", "同步成功");

      expect(toasts.value[0]?.variant).toBe("default");
    });

    it("應使用預設 duration", () => {
      const { showSuccessToast, toasts } = useToast();

      showSuccessToast("Note", "新增成功");

      expect(toasts.value[0]?.duration).toBe(3000);
    });

    it("應回傳 Toast id", () => {
      const { showSuccessToast } = useToast();

      const id = showSuccessToast("Git", "提交成功");

      expect(id).toBe("toast-1");
    });

    it("應支援所有 ToastCategory", () => {
      const { showSuccessToast, toasts } = useToast();

      const categories: Array<Parameters<typeof showSuccessToast>[0]> = [
        "Pod",
        "Repository",
        "Canvas",
        "Workspace",
        "Workflow",
        "Git",
        "Command",
        "Note",
        "Schedule",
        "Paste",
        "WebSocket",
      ];

      for (const category of categories) {
        showSuccessToast(category, "Test Action");
      }

      expect(toasts.value).toHaveLength(categories.length);
      expect(toasts.value.map((t) => t.title)).toEqual(categories);
    });
  });

  describe("showErrorToast", () => {
    it("title 應為 category", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Pod", "建立失敗", "Network error");

      expect(toasts.value[0]?.title).toBe("Pod");
    });

    it("有 reason 時 description 應為 action - reason", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Pod", "建立失敗", "Network error");

      expect(toasts.value[0]?.description).toBe("建立失敗 - Network error");
    });

    it("無 reason 時 description 應僅為 action", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Canvas", "載入失敗");

      expect(toasts.value[0]?.description).toBe("載入失敗");
    });

    it("reason 為 undefined 時 description 應僅為 action", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Workflow", "執行失敗", undefined);

      expect(toasts.value[0]?.description).toBe("執行失敗");
    });

    it("variant 應為 destructive", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Repository", "同步失敗");

      expect(toasts.value[0]?.variant).toBe("destructive");
    });

    it("應使用預設 duration", () => {
      const { showErrorToast, toasts } = useToast();

      showErrorToast("Note", "刪除失敗");

      expect(toasts.value[0]?.duration).toBe(3000);
    });

    it("應回傳 Toast id", () => {
      const { showErrorToast } = useToast();

      const id = showErrorToast("Git", "提交失敗");

      expect(id).toBe("toast-1");
    });

    it("應支援所有 ToastCategory", () => {
      const { showErrorToast, toasts } = useToast();

      const categories: Array<Parameters<typeof showErrorToast>[0]> = [
        "Pod",
        "Repository",
        "Canvas",
        "Workspace",
        "Workflow",
        "Git",
        "Command",
        "Note",
        "Schedule",
        "Paste",
        "WebSocket",
      ];

      for (const category of categories) {
        showErrorToast(category, "Test Action");
      }

      expect(toasts.value).toHaveLength(categories.length);
      expect(toasts.value.map((t) => t.title)).toEqual(categories);
    });
  });

  describe("toasts ref", () => {
    it("應為 reactive ref", () => {
      const { toast, toasts } = useToast();
      const initialLength = toasts.value.length;

      toast({ title: "Test" });

      expect(toasts.value.length).toBe(initialLength + 1);
    });

    it("多次呼叫 useToast 應共用同一個 toasts ref", () => {
      const instance1 = useToast();
      const instance2 = useToast();

      instance1.toast({ title: "Toast 1" });

      expect(instance1.toasts.value).toHaveLength(1);
      expect(instance2.toasts.value).toHaveLength(1);
      expect(instance1.toasts.value[0]).toBe(instance2.toasts.value[0]);
    });
  });
});
