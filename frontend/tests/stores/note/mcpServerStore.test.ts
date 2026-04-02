import { describe, it, expect, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
import { useCanvasStore } from "@/stores/canvasStore";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
vi.mock("@/composables/useToast", () => {
  const mockShowSuccessToast = vi.fn();
  const mockShowErrorToast = vi.fn();
  return {
    useToast: () => ({
      showSuccessToast: mockShowSuccessToast,
      showErrorToast: mockShowErrorToast,
    }),
    mockShowSuccessToast,
    mockShowErrorToast,
  };
});

const { mockShowSuccessToast, mockShowErrorToast } =
  (await import("@/composables/useToast")) as any;

const createMockMcpServer = (overrides = {}) => ({
  id: "mcp-1",
  name: "Test MCP",
  config: { command: "npx", args: ["-y", "test-mcp"] },
  ...overrides,
});

const createMockMcpServerNote = (overrides = {}) => ({
  id: "note-1",
  name: "Test MCP",
  x: 100,
  y: 100,
  boundToPodId: null,
  originalPosition: null,
  mcpServerId: "mcp-1",
  ...overrides,
});

describe("mcpServerStore", () => {
  setupStoreTest();

  describe("基本 state", () => {
    it("應能透過 createNoteStore 建立 store 並具備基本 state", () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      expect(store.availableItems).toEqual([]);
      expect(store.notes).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.draggedNoteId).toBeNull();
    });
  });

  describe("loadMcpServers", () => {
    it("應透過 WebSocket 載入 MCP Server 列表", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const mcpServers = [
        createMockMcpServer({ id: "mcp-1", name: "MCP 1" }),
        createMockMcpServer({ id: "mcp-2", name: "MCP 2" }),
      ];

      mockCreateWebSocketRequest.mockResolvedValueOnce({ mcpServers });

      await store.loadMcpServers();

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
        requestEvent: "mcp-server:list",
        responseEvent: "mcp-server:list:result",
        payload: { canvasId: "canvas-1" },
      });
      expect(store.availableItems).toEqual(mcpServers);
    });
  });

  describe("createMcpServer", () => {
    it("應發送 WS 事件並更新 availableItems", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const newMcpServer = { id: "mcp-1", name: "New MCP" };
      const config = { command: "npx", args: ["-y", "my-mcp"] };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        mcpServer: newMcpServer,
      });

      const result = await store.createMcpServer("New MCP", config);

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "mcp-server:create",
          responseEvent: "mcp-server:created",
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            name: "New MCP",
            config,
          }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.mcpServer).toEqual(newMcpServer);
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "McpServer",
        "建立成功",
        "New MCP",
      );
    });

    it("失敗時應回傳 success: false 並顯示錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const config = { command: "npx" };
      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      const result = await store.createMcpServer("New MCP", config);

      expect(result.success).toBe(false);
      expect(result.error).toBe("建立失敗");
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "McpServer",
        "建立失敗",
        "建立失敗",
      );
    });

    it("回應無 mcpServer 時應回傳 success: false", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const config = { command: "npx" };
      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await store.createMcpServer("New MCP", config);

      expect(result.success).toBe(false);
      expect(result.error).toBe("建立失敗");
    });
  });

  describe("updateMcpServer", () => {
    it("應發送 WS 事件並更新 availableItems 中的對應項目", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const originalMcp = createMockMcpServer({
        id: "mcp-1",
        name: "Original",
      });
      store.availableItems = [originalMcp];

      const updatedMcp = { id: "mcp-1", name: "Updated" };
      const config = { command: "npx", args: ["--updated"] };

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        mcpServer: updatedMcp,
      });

      const result = await store.updateMcpServer("mcp-1", "Updated", config);

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "mcp-server:update",
          responseEvent: "mcp-server:updated",
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            mcpServerId: "mcp-1",
            name: "Updated",
            config,
          }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.mcpServer).toEqual(updatedMcp);
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "McpServer",
        "更新成功",
        "Updated",
      );
    });

    it("失敗時應回傳 success: false 並顯示錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const config = { command: "npx" };
      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      const result = await store.updateMcpServer("mcp-1", "Updated", config);

      expect(result.success).toBe(false);
      expect(result.error).toBe("更新失敗");
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "McpServer",
        "更新失敗",
        "更新失敗",
      );
    });
  });

  describe("readMcpServer", () => {
    it("成功時應回傳含 config 的完整資料", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const mcpServer = {
        id: "mcp-1",
        name: "Test MCP",
        config: { command: "npx", args: ["-y", "test-mcp"] },
      };
      mockCreateWebSocketRequest.mockResolvedValueOnce({ mcpServer });

      const result = await store.readMcpServer("mcp-1");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "mcp-server:read",
          responseEvent: "mcp-server:read:result",
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            mcpServerId: "mcp-1",
          }),
        }),
      );
      expect(result).toEqual(mcpServer);
      expect(result?.config).toEqual({
        command: "npx",
        args: ["-y", "test-mcp"],
      });
    });

    it("失敗時（response 為 null）應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      const result = await store.readMcpServer("mcp-1");

      expect(result).toBeNull();
    });

    it("回應無 mcpServer 欄位時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await store.readMcpServer("mcp-1");

      expect(result).toBeNull();
    });
  });

  describe("deleteMcpServer", () => {
    it("應呼叫 deleteItem 並移除 availableItems 與相關 notes", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const mcpServer = createMockMcpServer({ id: "mcp-1", name: "Test MCP" });
      store.availableItems = [mcpServer];

      const deleteItemSpy = vi.spyOn(store, "deleteItem");

      await store.deleteMcpServer("mcp-1");

      expect(deleteItemSpy).toHaveBeenCalledWith("mcp-1");
    });

    it("刪除後 availableItems 應確實移除對應項目", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const mcpServer1 = createMockMcpServer({ id: "mcp-1", name: "MCP 1" });
      const mcpServer2 = createMockMcpServer({ id: "mcp-2", name: "MCP 2" });
      store.availableItems = [mcpServer1, mcpServer2];

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

      await store.deleteMcpServer("mcp-1");

      const items = store.availableItems as Array<{ id: string; name: string }>;
      expect(items.find((item) => item.id === "mcp-1")).toBeUndefined();
      expect(items.find((item) => item.id === "mcp-2")).toBeDefined();
    });
  });

  describe("bindToPod / unbindFromPod", () => {
    it("bindToPod 應正確發送 bind 事件並更新 note 的 boundToPodId", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const note = createMockMcpServerNote({
        id: "note-1",
        boundToPodId: null,
      });
      store.notes = [note];

      mockCreateWebSocketRequest.mockResolvedValue({
        success: true,
        note: { ...note, boundToPodId: "pod-1" },
      });

      await store.bindToPod("note-1", "pod-1");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:bind-mcp-server",
          responseEvent: "pod:mcp-server:bound",
        }),
      );
    });

    it("unbindFromPod 在 one-to-many 關係下不執行操作（由個別 note 刪除處理）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useMcpServerStore();

      const note = createMockMcpServerNote({
        id: "note-1",
        boundToPodId: "pod-1",
      });
      store.notes = [note];

      await store.unbindFromPod("pod-1", { mode: "return-to-original" });

      // one-to-many 關係下 unbindFromPod 不會發送請求
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });
  });
});
