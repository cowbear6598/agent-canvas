import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import {
  setupStoreTest,
  mockErrorSanitizerFactory,
} from "../../helpers/testSetup";
import {
  createResourceCRUDActions,
  defaultReplaceItemInList,
  defaultMergeItemInList,
} from "@/stores/note/createResourceCRUDActions";
import { useCanvasStore } from "@/stores/canvasStore";
import type {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket";
import type { ToastCategory } from "@/composables/useToast";

// 定義測試用的 config 類型（因為源碼沒有 export）
interface CRUDEventsConfig {
  create: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
  update: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
  read: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
}

interface CRUDPayloadConfig<TItem> {
  getUpdatePayload: (
    itemId: string,
    content: string,
  ) => Record<string, unknown>;
  getReadPayload: (itemId: string) => Record<string, unknown>;
  extractItemFromResponse: {
    create: (response: unknown) => { id: string; name: string } | undefined;
    update: (response: unknown) => { id: string; name: string } | undefined;
    read: (
      response: unknown,
    ) => { id: string; name: string; content: string } | undefined;
  };
  updateItemsList: (
    items: TItem[],
    itemId: string,
    newItem: { id: string; name: string },
  ) => void;
}

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const mockShowSuccessToast = vi.fn();
const mockShowErrorToast = vi.fn();
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
    toast: mockToast,
  }),
}));

// Mock sanitizeErrorForUser
vi.mock("@/utils/errorSanitizer", () => mockErrorSanitizerFactory());

interface TestItem {
  id: string;
  name: string;
  content?: string;
}

describe("defaultReplaceItemInList", () => {
  interface TestItem {
    id: string;
    name: string;
    extra?: string;
  }

  it("找到匹配項目時正確替換整個 item", () => {
    const items: TestItem[] = [
      { id: "item-1", name: "Old Name", extra: "old" },
      { id: "item-2", name: "Other" },
    ];
    const newItem = { id: "item-1", name: "New Name" };

    defaultReplaceItemInList(items, "item-1", newItem);

    expect(items[0]).toEqual(newItem);
    expect(items[0]).not.toHaveProperty("extra");
  });

  it("找不到匹配項目時不做任何修改", () => {
    const items: TestItem[] = [{ id: "item-1", name: "Old Name" }];
    const original = [...items];

    defaultReplaceItemInList(items, "non-existent", {
      id: "non-existent",
      name: "New",
    });

    expect(items).toEqual(original);
  });
});

describe("defaultMergeItemInList", () => {
  interface TestItem {
    id: string;
    name: string;
    extra?: string;
  }

  it("找到匹配項目時正確 spread 合併", () => {
    const items: TestItem[] = [
      { id: "item-1", name: "Old Name", extra: "preserved" },
    ];
    const newItem = { id: "item-1", name: "New Name" };

    defaultMergeItemInList(items, "item-1", newItem);

    expect(items[0]).toEqual({
      id: "item-1",
      name: "New Name",
      extra: "preserved",
    });
  });

  it("找不到匹配項目時不做任何修改", () => {
    const items: TestItem[] = [{ id: "item-1", name: "Old Name" }];
    const original = [...items];

    defaultMergeItemInList(items, "non-existent", {
      id: "non-existent",
      name: "New",
    });

    expect(items).toEqual(original);
  });
});

describe("createResourceCRUDActions", () => {
  let eventsConfig: CRUDEventsConfig;
  let payloadConfig: CRUDPayloadConfig<TestItem>;

  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  beforeEach(() => {
    eventsConfig = {
      create: {
        request: "test:create" as any,
        response: "test:created" as any,
      },
      update: {
        request: "test:update" as any,
        response: "test:updated" as any,
      },
      read: {
        request: "test:read" as any,
        response: "test:read-result" as any,
      },
    };

    payloadConfig = {
      getUpdatePayload: (itemId: string, content: string) => ({
        itemId,
        content,
      }),
      getReadPayload: (itemId: string) => ({
        itemId,
      }),
      extractItemFromResponse: {
        create: (response: unknown) => {
          const res = response as { item?: TestItem };
          return res.item;
        },
        update: (response: unknown) => {
          const res = response as { item?: TestItem };
          return res.item;
        },
        read: (response: unknown) => {
          const res = response as { item?: TestItem & { content: string } };
          return res.item;
        },
      },
      updateItemsList: (
        items: TestItem[],
        itemId: string,
        newItem: { id: string; name: string },
      ) => {
        const index = items.findIndex((item) => item.id === itemId);
        if (index !== -1) {
          items[index] = { ...items[index], ...newItem };
        }
      },
    };
  });

  describe("activeCanvasId 為 null 時", () => {
    it("create 應拋出錯誤（沒有啟用的畫布）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      await expect(
        actions.create(items, "Test Item", "Test Content"),
      ).rejects.toThrow("沒有啟用的畫布");
      expect(items).toHaveLength(0);
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("update 應拋出錯誤（沒有啟用的畫布）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const items: TestItem[] = [{ id: "item-1", name: "Old Name" }];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      await expect(
        actions.update(items, "item-1", "New Content"),
      ).rejects.toThrow("沒有啟用的畫布");
      expect(items[0]?.name).toBe("Old Name");
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("read 應拋出錯誤（沒有啟用的畫布）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      await expect(actions.read("item-1")).rejects.toThrow("沒有啟用的畫布");
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("成功時應新增 item 到陣列、顯示成功 Toast", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const newItem = { id: "item-1", name: "Test Item" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: newItem,
      });

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: "test:create",
        responseEvent: "test:created",
        payload: {
          canvasId: "canvas-1",
          name: "Test Item",
          content: "Test Content",
        },
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(newItem);
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "TestCategory",
        "建立成功",
        "Test Item",
      );
      expect(result).toEqual({
        success: true,
        item: newItem,
      });
    });

    it("無 toastCategory 時不應顯示 Toast", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      const newItem = { id: "item-1", name: "Test Item" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: newItem,
      });

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(items).toHaveLength(1);
      expect(mockShowSuccessToast).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("WebSocket 錯誤時應顯示錯誤 Toast、回傳 error", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const error = new Error("Network error");
      mockCreateWebSocketRequest.mockRejectedValueOnce(error);

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(items).toHaveLength(0);
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "建立失敗",
        "建立失敗",
      );
      expect(result).toEqual({
        success: false,
        error: "建立失敗",
      });
    });

    it("WebSocket 錯誤且無 toastCategory 時不應顯示 Toast", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      const error = new Error("Network error");
      mockCreateWebSocketRequest.mockRejectedValueOnce(error);

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(items).toHaveLength(0);
      expect(mockShowErrorToast).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "建立失敗",
      });
    });

    it("response 無 item 時應回傳 error、顯示錯誤 Toast", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(items).toHaveLength(0);
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "建立失敗",
        "建立失敗",
      );
      expect(result).toEqual({
        success: false,
        error: "建立失敗",
      });
    });

    it("response 含 error 欄位時應使用該錯誤訊息", async () => {
      const items: TestItem[] = [];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: "名稱重複",
      });

      const result = await actions.create(items, "Test Item", "Test Content");

      expect(items).toHaveLength(0);
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "建立失敗",
        "名稱重複",
      );
      expect(result).toEqual({
        success: false,
        error: "名稱重複",
      });
    });
  });

  describe("update", () => {
    it("成功時應更新 items 陣列中的 item、顯示成功 Toast", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const updatedItem = { id: "item-1", name: "New Name" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: updatedItem,
      });

      const result = await actions.update(items, "item-1", "New Content");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: "test:update",
        responseEvent: "test:updated",
        payload: {
          canvasId: "canvas-1",
          itemId: "item-1",
          content: "New Content",
        },
      });
      expect(items[0]?.name).toBe("New Name");
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "TestCategory",
        "更新成功",
        "New Name",
      );
      expect(result).toEqual({
        success: true,
        item: updatedItem,
      });
    });

    it("無 toastCategory 時不應顯示 Toast", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      const updatedItem = { id: "item-1", name: "New Name" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: updatedItem,
      });

      const result = await actions.update(items, "item-1", "New Content");

      expect(items[0]?.name).toBe("New Name");
      expect(mockShowSuccessToast).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("WebSocket 錯誤時應顯示錯誤 Toast、回傳 error", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const error = new Error("Update failed");
      mockCreateWebSocketRequest.mockRejectedValueOnce(error);

      const result = await actions.update(items, "item-1", "New Content");

      expect(items[0]?.name).toBe("Old Name"); // 保持不變
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "更新失敗",
        "更新失敗",
      );
      expect(result).toEqual({
        success: false,
        error: "更新失敗",
      });
    });

    it("response 無 item 時應回傳 error", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await actions.update(items, "item-1", "New Content");

      expect(items[0]?.name).toBe("Old Name"); // 保持不變
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "更新失敗",
        "更新失敗",
      );
      expect(result).toEqual({
        success: false,
        error: "更新失敗",
      });
    });

    it("response 含 error 欄位時應使用該錯誤訊息", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        error: "權限不足",
      });

      const result = await actions.update(items, "item-1", "New Content");

      expect(items[0]?.name).toBe("Old Name"); // 保持不變
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "TestCategory",
        "更新失敗",
        "權限不足",
      );
      expect(result).toEqual({
        success: false,
        error: "權限不足",
      });
    });

    it("未提供 updateItemsList 時使用預設 defaultReplaceItemInList", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Old Content" },
      ];
      const configWithoutUpdateFn = {
        ...payloadConfig,
        updateItemsList: undefined,
      };
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        configWithoutUpdateFn as unknown as Parameters<
          typeof createResourceCRUDActions
        >[2],
      );

      const updatedItem = { id: "item-1", name: "New Name" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: updatedItem,
      });

      await actions.update(items, "item-1", "New Content");

      expect(items[0]).toEqual(updatedItem);
      expect(items[0]).not.toHaveProperty("content");
    });

    it("提供自訂 updateItemsList 時使用自訂邏輯", async () => {
      const items: TestItem[] = [
        { id: "item-1", name: "Old Name", content: "Preserved Content" },
      ];
      const customUpdateFn = vi.fn(
        (
          arr: TestItem[],
          id: string,
          newItem: { id: string; name: string },
        ) => {
          const index = arr.findIndex((item) => item.id === id);
          if (index !== -1) {
            arr[index] = { ...arr[index], ...newItem };
          }
        },
      );
      const configWithCustomFn = {
        ...payloadConfig,
        updateItemsList: customUpdateFn,
      };
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        configWithCustomFn,
      );

      const updatedItem = { id: "item-1", name: "New Name" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item: updatedItem,
      });

      await actions.update(items, "item-1", "New Content");

      expect(customUpdateFn).toHaveBeenCalledWith(items, "item-1", updatedItem);
      expect(items[0]?.content).toBe("Preserved Content");
    });
  });

  describe("read", () => {
    it("成功時應回傳 item", async () => {
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      const item = { id: "item-1", name: "Test Item", content: "Test Content" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item,
      });

      const result = await actions.read("item-1");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: "test:read",
        responseEvent: "test:read-result",
        payload: {
          canvasId: "canvas-1",
          itemId: "item-1",
        },
      });
      expect(result).toEqual(item);
    });

    it("WebSocket 錯誤時應回傳 null", async () => {
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      const error = new Error("Read failed");
      mockCreateWebSocketRequest.mockRejectedValueOnce(error);

      const result = await actions.read("item-1");

      expect(result).toBeNull();
    });

    it("response 無 item 時應回傳 null", async () => {
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await actions.read("item-1");

      expect(result).toBeNull();
    });

    it("read 操作不應顯示任何 Toast", async () => {
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const item = { id: "item-1", name: "Test Item", content: "Test Content" };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        item,
      });

      await actions.read("item-1");

      expect(mockShowSuccessToast).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it("read 失敗時也不應顯示 Toast", async () => {
      const actions = createResourceCRUDActions(
        "測試資源",
        eventsConfig,
        payloadConfig,
        "TestCategory" as ToastCategory,
      );

      const error = new Error("Read failed");
      mockCreateWebSocketRequest.mockRejectedValueOnce(error);

      await actions.read("item-1");

      expect(mockShowSuccessToast).not.toHaveBeenCalled();
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });
  });
});
