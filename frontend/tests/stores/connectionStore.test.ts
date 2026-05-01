import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import {
  createMockCanvas,
  createMockConnection,
  createMockPod,
} from "../helpers/factories";
import { useConnectionStore } from "@/stores/connectionStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import type {
  Connection,
  TriggerMode,
  ConnectionStatus,
} from "@/types/connection";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowCompletePayload,
  WorkflowAiDecidePendingPayload,
  WorkflowAiDecideResultPayload,
  WorkflowAiDecideErrorPayload,
  WorkflowAiDecideClearPayload,
  WorkflowDirectTriggeredPayload,
  WorkflowDirectWaitingPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "@/types/websocket";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const mockToast = vi.fn();
const mockShowErrorToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

describe("connectionStore", () => {
  setupStoreTest();

  describe("初始狀態", () => {
    it("各欄位應有正確預設值", () => {
      const store = useConnectionStore();

      expect(store.connections).toEqual([]);
      expect(store.selectedConnectionId).toBeNull();
      expect(store.draggingConnection).toBeNull();
    });
  });

  describe("getters", () => {
    describe("getConnectionsByPodId", () => {
      it("應回傳包含該 Pod 的所有 Connection（source 或 target）", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          sourcePodId: "pod-b",
          targetPodId: "pod-c",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          sourcePodId: "pod-c",
          targetPodId: "pod-d",
        });
        store.connections = [conn1, conn2, conn3];

        const result = store.getConnectionsByPodId("pod-b");

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(conn1);
        expect(result).toContainEqual(conn2);
      });

      it("Pod 不在任何 Connection 中時應回傳空陣列", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        store.connections = [conn];

        const result = store.getConnectionsByPodId("pod-z");

        expect(result).toEqual([]);
      });
    });

    describe("getOutgoingConnections", () => {
      it("應僅回傳 sourcePodId 匹配的 Connection", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          sourcePodId: "pod-a",
          targetPodId: "pod-c",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          sourcePodId: "pod-b",
          targetPodId: "pod-a",
        });
        store.connections = [conn1, conn2, conn3];

        const result = store.getOutgoingConnections("pod-a");

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(conn1);
        expect(result).toContainEqual(conn2);
      });
    });

    describe("getConnectionsByTargetPodId", () => {
      it("應僅回傳 targetPodId 匹配的 Connection", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-c",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          sourcePodId: "pod-b",
          targetPodId: "pod-c",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          sourcePodId: "pod-c",
          targetPodId: "pod-d",
        });
        store.connections = [conn1, conn2, conn3];

        const result = store.getConnectionsByTargetPodId("pod-c");

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(conn1);
        expect(result).toContainEqual(conn2);
      });
    });

    describe("selectedConnection", () => {
      it("有 selectedConnectionId 時應回傳對應 Connection", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1" });
        const conn2 = createMockConnection({ id: "conn-2" });
        store.connections = [conn1, conn2];
        store.selectedConnectionId = "conn-2";

        const result = store.selectedConnection;

        expect(result).toEqual(conn2);
      });

      // 參數化：getter 找不到時應回傳 null
      it.each([
        { desc: "無 selectedConnectionId（null）", selectedId: null as null },
        {
          desc: "selectedConnectionId 不存在於 connections 中",
          selectedId: "non-existent",
        },
      ])("$desc 時應回傳 null", ({ selectedId }) => {
        const store = useConnectionStore();
        const conn = createMockConnection({ id: "conn-1" });
        store.connections = [conn];
        store.selectedConnectionId = selectedId;

        const result = store.selectedConnection;

        expect(result).toBeNull();
      });
    });

    describe("isSourcePod", () => {
      it("無 incoming Connection 時應為 true", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        store.connections = [conn];

        const result = store.isSourcePod("pod-a");

        expect(result).toBe(true);
      });

      it("有 incoming Connection 時應為 false", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        store.connections = [conn];

        const result = store.isSourcePod("pod-b");

        expect(result).toBe(false);
      });
    });

    describe("hasUpstreamConnections", () => {
      it("有 incoming Connection 時應為 true", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        store.connections = [conn];

        const result = store.hasUpstreamConnections("pod-b");

        expect(result).toBe(true);
      });

      it("無 incoming Connection 時應為 false", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        });
        store.connections = [conn];

        const result = store.hasUpstreamConnections("pod-a");

        expect(result).toBe(false);
      });
    });

    describe("getAiDecideConnectionsBySourcePodId", () => {
      it("應篩選 sourcePodId + ai-decide", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          triggerMode: "ai-decide",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          sourcePodId: "pod-a",
          triggerMode: "auto",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          sourcePodId: "pod-b",
          triggerMode: "ai-decide",
        });
        const conn4 = createMockConnection({
          id: "conn-4",
          sourcePodId: "pod-a",
          triggerMode: "ai-decide",
        });
        store.connections = [conn1, conn2, conn3, conn4];

        const result = store.getAiDecideConnectionsBySourcePodId("pod-a");

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(conn1);
        expect(result).toContainEqual(conn4);
      });
    });
  });

  describe("createConnection", () => {
    /**
     * 統一設定 Claude 與 Codex 兩個 provider 的 capability（availableModels）。
     * Claude case 與 Codex case 都使用此 helper，確保 mock 設定方式一致。
     */
    function setupConnectionCapabilities() {
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
            command: true,
            mcp: true,
          },
          availableModels: [
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "codex",
          capabilities: {
            chat: true,
            plugin: true,
            repository: false,
            command: true,
            mcp: false,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);
    }

    it("成功時應回傳 Connection、預設 triggerMode 為 auto", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const newConnection = createMockConnection({
        id: "new-conn",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
      });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: { ...newConnection },
      });

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result).toEqual(newConnection);
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:create",
          responseEvent: "connection:created",
          payload: expect.objectContaining({
            sourcePodId: "pod-a",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("自我連接時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-a",
        "top",
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        "[ConnectionStore] 無法將 Pod 連接到自身",
      );
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("重複連接時應回傳 null 並顯示 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const existingConn = createMockConnection({
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
      });
      store.connections = [existingConn];

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result).toBeNull();
      expect(mockToast).toHaveBeenCalledWith({
        title: "連線已存在",
        description: "這兩個 Pod 之間已經有連線了",
        duration: 3000,
      });
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("無 activeCanvasId 時應回傳 null", async () => {
      const store = useConnectionStore();
      // activeCanvasId 未設定，useCanvasWebSocketAction 會直接回傳 failure

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("WebSocket 回應無 connection 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      // 回傳沒有 connection 欄位的物件
      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result).toBeNull();
    });

    it("後端回傳 connectionStatus 時應直接使用", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "ai-decide",
          connectionStatus: "ai-approved",
        },
      });

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result?.status).toBe("ai-approved");
    });

    it("後端未回傳 connectionStatus 時應 fallback 為 idle", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
        },
      });

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result?.status).toBe("idle");
    });

    it("sourcePodId 為 null 時不應設定在 payload 中", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          targetPodId: "pod-b",
          targetAnchor: "top",
          sourceAnchor: "bottom",
        },
      });

      await store.createConnection(null, "bottom", "pod-b", "top");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            canvasId: "canvas-1",
            // 注意：sourcePodId 不存在
          }),
        }),
      );
      // 確認 payload 中確實沒有 sourcePodId
      const callPayload =
        mockCreateWebSocketRequest.mock.calls[0]?.[0]?.payload;
      expect(callPayload).not.toHaveProperty("sourcePodId");
    });

    it("上游為 Claude Pod 時，summaryModel 應為 Claude 的預設模型", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      // 建立 Claude Pod 並放入 podStore
      const claudePod = createMockPod({
        id: "pod-claude",
        provider: "claude",
      });
      podStore.pods = [claudePod];

      // 使用共用 helper 統一設定 capability（與 Codex case 相同方式）
      setupConnectionCapabilities();

      // 後端回傳不帶 summaryModel，應由前端以 provider 預設填入
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-claude",
          sourcePodId: "pod-claude",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const result = await store.createConnection(
        "pod-claude",
        "bottom",
        "pod-target",
        "top",
      );

      expect(result?.summaryModel).toBe("sonnet");
    });

    it("上游為 Codex Pod 時，summaryModel 應為 Codex 的預設模型", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      // 建立 Codex Pod 並放入 podStore
      const codexPod = createMockPod({
        id: "pod-codex",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      podStore.pods = [codexPod];

      // 使用共用 helper 統一設定 capability（與 Claude case 相同方式）
      setupConnectionCapabilities();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-codex",
          sourcePodId: "pod-codex",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const result = await store.createConnection(
        "pod-codex",
        "bottom",
        "pod-target",
        "top",
      );

      expect(result?.summaryModel).toBe("gpt-5.4");
    });

    it("capability 查無資料時，summaryModel 應 fallback 為 DEFAULT_SUMMARY_MODEL", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      // providerCapabilityStore 維持空白（capability 尚未推送）

      const unknownPod = createMockPod({
        id: "pod-unknown",
        provider: "unknown-provider",
      });
      podStore.pods = [unknownPod];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-unknown",
          sourcePodId: "pod-unknown",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const result = await store.createConnection(
        "pod-unknown",
        "bottom",
        "pod-target",
        "top",
      );

      // capability 未載入，應 fallback 為 DEFAULT_SUMMARY_MODEL（"sonnet"）
      expect(result?.summaryModel).toBe("sonnet");
    });
  });

  describe("deleteConnection", () => {
    it("應發送 WebSocket 刪除請求", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

      await store.deleteConnection("conn-1");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:delete",
          responseEvent: "connection:deleted",
          payload: expect.objectContaining({
            connectionId: "conn-1",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("刪除失敗但 connection 已不在 store 時不應顯示 error toast", async () => {
      const store = useConnectionStore();
      // store 中不含 conn-1，模擬後端廣播已先到達將其移除
      store.connections = [];
      // mockCreateWebSocketRequest 預設回傳 null，模擬請求失敗

      await store.deleteConnection("conn-1");

      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it("刪除失敗且 connection 仍在 store 時應顯示 error toast", async () => {
      const store = useConnectionStore();
      const conn = createMockConnection({ id: "conn-1" });
      store.connections = [conn];
      // mockCreateWebSocketRequest 預設回傳 null，模擬請求失敗

      await store.deleteConnection("conn-1");

      expect(mockShowErrorToast).toHaveBeenCalledWith("Connection", "刪除失敗");
    });
  });

  describe("selectConnection", () => {
    it("connectionId 不為 null 時應呼叫 selectionStore.clearSelection()", () => {
      const store = useConnectionStore();
      const selectionStore = useSelectionStore();
      const clearSelectionSpy = vi.spyOn(selectionStore, "clearSelection");

      store.selectConnection("conn-1");

      expect(clearSelectionSpy).toHaveBeenCalledTimes(1);
    });

    it("connectionId 為 null 時不應呼叫 selectionStore.clearSelection()", () => {
      const store = useConnectionStore();
      const selectionStore = useSelectionStore();
      const clearSelectionSpy = vi.spyOn(selectionStore, "clearSelection");

      store.selectConnection(null);

      expect(clearSelectionSpy).not.toHaveBeenCalled();
    });
  });

  describe("deleteConnectionsByPodId", () => {
    it("應移除所有含該 podId 的 Connection", () => {
      const store = useConnectionStore();
      const conn1 = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
      });
      const conn2 = createMockConnection({
        id: "conn-2",
        sourcePodId: "pod-b",
        targetPodId: "pod-c",
      });
      const conn3 = createMockConnection({
        id: "conn-3",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
      });
      store.connections = [conn1, conn2, conn3];

      store.deleteConnectionsByPodId("pod-b");

      expect(store.connections).toHaveLength(1);
      expect(store.connections).toContainEqual(conn3);
    });

    it("刪除包含 selectedConnectionId 的 Connection 時應清除選取", () => {
      const store = useConnectionStore();
      const conn1 = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
      });
      const conn2 = createMockConnection({
        id: "conn-2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
      });
      store.connections = [conn1, conn2];
      store.selectedConnectionId = "conn-1";

      store.deleteConnectionsByPodId("pod-a");

      expect(store.selectedConnectionId).toBeNull();
    });

    it("未刪除 selectedConnection 時應保留選取", () => {
      const store = useConnectionStore();
      const conn1 = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
      });
      const conn2 = createMockConnection({
        id: "conn-2",
        sourcePodId: "pod-c",
        targetPodId: "pod-d",
      });
      store.connections = [conn1, conn2];
      store.selectedConnectionId = "conn-2";

      store.deleteConnectionsByPodId("pod-a");

      expect(store.selectedConnectionId).toBe("conn-2");
    });
  });

  describe("updateConnectionTriggerMode", () => {
    it("成功時應回傳更新後的 Connection", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const updatedConnection = createMockConnection({
        id: "conn-1",
        triggerMode: "ai-decide",
      });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: { ...updatedConnection },
      });

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "ai-decide",
      );

      expect(result).toEqual(updatedConnection);
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            connectionId: "conn-1",
            triggerMode: "ai-decide",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("無 activeCanvasId 時應回傳 null", async () => {
      const store = useConnectionStore();
      // activeCanvasId 未設定，useCanvasWebSocketAction 會直接回傳 failure

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "direct",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("WebSocket 回應無 connection 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      // 回傳沒有 connection 欄位的物件
      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "direct",
      );

      expect(result).toBeNull();
    });

    it("後端回傳 connectionStatus 時應直接使用", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "ai-decide",
          connectionStatus: "ai-rejected",
          decideReason: "不符合條件",
        },
      });

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "ai-decide",
      );

      expect(result?.status).toBe("ai-rejected");
    });

    it("後端未回傳 connectionStatus 時應 fallback 為 idle", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "direct",
        },
      });

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "direct",
      );

      expect(result?.status).toBe("idle");
    });
  });

  describe("拖曳連線", () => {
    describe("startDragging", () => {
      it("應設定 draggingConnection", () => {
        const store = useConnectionStore();

        store.startDragging("pod-a", "bottom", { x: 100, y: 200 });

        expect(store.draggingConnection).toEqual({
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          startPoint: { x: 100, y: 200 },
          currentPoint: { x: 100, y: 200 },
        });
      });

      it("sourcePodId 為 null 時應設為 undefined", () => {
        const store = useConnectionStore();

        store.startDragging(null, "top", { x: 50, y: 50 });

        expect(store.draggingConnection).toEqual({
          sourcePodId: undefined,
          sourceAnchor: "top",
          startPoint: { x: 50, y: 50 },
          currentPoint: { x: 50, y: 50 },
        });
      });
    });

    describe("updateDraggingPosition", () => {
      it("應更新 currentPoint", () => {
        const store = useConnectionStore();
        store.draggingConnection = {
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          startPoint: { x: 100, y: 200 },
          currentPoint: { x: 100, y: 200 },
        };

        store.updateDraggingPosition({ x: 150, y: 250 });

        expect(store.draggingConnection.currentPoint).toEqual({
          x: 150,
          y: 250,
        });
      });

      it("draggingConnection 為 null 時不應報錯", () => {
        const store = useConnectionStore();
        store.draggingConnection = null;

        expect(() =>
          store.updateDraggingPosition({ x: 150, y: 250 }),
        ).not.toThrow();
      });
    });

    describe("endDragging", () => {
      it("應清除 draggingConnection", () => {
        const store = useConnectionStore();
        store.draggingConnection = {
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          startPoint: { x: 100, y: 200 },
          currentPoint: { x: 150, y: 250 },
        };

        store.endDragging();

        expect(store.draggingConnection).toBeNull();
      });
    });
  });

  describe("工作流處理", () => {
    describe("handleWorkflowAutoTriggered", () => {
      it("auto/ai-decide Connection 應設為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "idle",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "ai-decide",
          status: "idle",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          targetPodId: "pod-target",
          triggerMode: "direct",
          status: "idle",
        });
        store.connections = [conn1, conn2, conn3];

        const payload: WorkflowAutoTriggeredPayload = {
          connectionId: "conn-1",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          transferredContent: "test",
          isSummarized: false,
        };

        store.getWorkflowHandlers().handleWorkflowAutoTriggered(payload);

        expect(conn1.status).toBe("active");
        expect(conn2.status).toBe("active");
        expect(conn3.status).toBe("idle"); // direct 不受影響
      });

      it("應將 ai-approved 的 Connection 更新為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "ai-decide",
          status: "ai-approved",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "idle",
        });
        store.connections = [conn1, conn2];

        const payload: WorkflowAutoTriggeredPayload = {
          connectionId: "conn-1",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          transferredContent: "test",
          isSummarized: false,
        };

        store.getWorkflowHandlers().handleWorkflowAutoTriggered(payload);

        expect(conn1.status).toBe("active");
        expect(conn2.status).toBe("active");
      });
    });

    describe("handleWorkflowComplete", () => {
      it("auto/ai-decide triggerMode 時所有 Connection 應回 idle", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "active",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "ai-decide",
          status: "active",
        });
        store.connections = [conn1, conn2];

        const payload: WorkflowCompletePayload = {
          requestId: "req-1",
          connectionId: "conn-1",
          targetPodId: "pod-target",
          success: true,
          triggerMode: "auto",
        };

        store.getWorkflowHandlers().handleWorkflowComplete(payload);

        expect(conn1.status).toBe("idle");
        expect(conn2.status).toBe("idle");
      });

      it("direct triggerMode 時僅指定 connectionId 應回 idle", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "direct",
          status: "active",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "direct",
          status: "active",
        });
        store.connections = [conn1, conn2];

        const payload: WorkflowCompletePayload = {
          requestId: "req-1",
          connectionId: "conn-1",
          targetPodId: "pod-target",
          success: true,
          triggerMode: "direct",
        };

        store.getWorkflowHandlers().handleWorkflowComplete(payload);

        expect(conn1.status).toBe("idle");
        expect(conn2.status).toBe("active");
      });
    });

    describe("handleWorkflowDirectTriggered", () => {
      it("指定 connectionId 應設為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1", status: "idle" });
        const conn2 = createMockConnection({ id: "conn-2", status: "idle" });
        store.connections = [conn1, conn2];

        const payload: WorkflowDirectTriggeredPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          transferredContent: "test",
          isSummarized: false,
        };

        store.getWorkflowHandlers().handleWorkflowDirectTriggered(payload);

        expect(conn1.status).toBe("active");
        expect(conn2.status).toBe("idle");
      });
    });

    describe("handleWorkflowDirectWaiting", () => {
      it("指定 connectionId 應設為 waiting", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1", status: "idle" });
        const conn2 = createMockConnection({ id: "conn-2", status: "idle" });
        store.connections = [conn1, conn2];

        const payload: WorkflowDirectWaitingPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
        };

        store.getWorkflowHandlers().handleWorkflowDirectWaiting(payload);

        expect(conn1.status).toBe("waiting");
        expect(conn2.status).toBe("idle");
      });
    });

    describe("handleAiDecidePending", () => {
      it("批量 connectionIds 應設為 ai-deciding、清除 decideReason", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          status: "idle",
          decideReason: "old reason",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          status: "idle",
          decideReason: "old reason",
        });
        const conn3 = createMockConnection({ id: "conn-3", status: "idle" });
        store.connections = [conn1, conn2, conn3];

        const payload: WorkflowAiDecidePendingPayload = {
          canvasId: "canvas-1",
          connectionIds: ["conn-1", "conn-2"],
          sourcePodId: "pod-a",
        };

        store.getWorkflowHandlers().handleAiDecidePending(payload);

        expect(conn1.status).toBe("ai-deciding");
        expect(conn1.decideReason).toBeUndefined();
        expect(conn2.status).toBe("ai-deciding");
        expect(conn2.decideReason).toBeUndefined();
        expect(conn3.status).toBe("idle");
      });
    });

    describe("handleAiDecideResult", () => {
      it("shouldTrigger true 時應設為 ai-approved、清除 decideReason", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          id: "conn-1",
          status: "ai-deciding",
        });
        store.connections = [conn];

        const payload: WorkflowAiDecideResultPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          shouldTrigger: true,
          reason: "approved",
        };

        store.getWorkflowHandlers().handleAiDecideResult(payload);

        expect(conn.status).toBe("ai-approved");
        expect(conn.decideReason).toBeUndefined();
      });

      it("shouldTrigger false 時應設為 ai-rejected + decideReason", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          id: "conn-1",
          status: "ai-deciding",
        });
        store.connections = [conn];

        const payload: WorkflowAiDecideResultPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          shouldTrigger: false,
          reason: "not relevant",
        };

        store.getWorkflowHandlers().handleAiDecideResult(payload);

        expect(conn.status).toBe("ai-rejected");
        expect(conn.decideReason).toBe("not relevant");
      });
    });

    describe("handleAiDecideError", () => {
      it("應設為 ai-error + decideReason", () => {
        const store = useConnectionStore();
        const conn = createMockConnection({
          id: "conn-1",
          status: "ai-deciding",
        });
        store.connections = [conn];

        const payload: WorkflowAiDecideErrorPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          error: "AI service error",
        };

        store.getWorkflowHandlers().handleAiDecideError(payload);

        expect(conn.status).toBe("ai-error");
        expect(conn.decideReason).toBe("AI service error");
      });
    });

    describe("handleAiDecideClear", () => {
      it("批量設為 idle + 清除 decideReason", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          status: "ai-rejected",
          decideReason: "rejected reason",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          status: "ai-approved",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          status: "ai-error",
          decideReason: "error reason",
        });
        store.connections = [conn1, conn2, conn3];

        const payload: WorkflowAiDecideClearPayload = {
          canvasId: "canvas-1",
          connectionIds: ["conn-1", "conn-2"],
        };

        store.getWorkflowHandlers().handleAiDecideClear(payload);

        expect(conn1.status).toBe("idle");
        expect(conn1.decideReason).toBeUndefined();
        expect(conn2.status).toBe("idle");
        expect(conn2.decideReason).toBeUndefined();
        expect(conn3.status).toBe("ai-error");
      });
    });

    describe("handleWorkflowQueued", () => {
      it("auto/ai-decide triggerMode 時應設為 queued", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "idle",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "ai-decide",
          status: "idle",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          targetPodId: "pod-target",
          triggerMode: "direct",
          status: "idle",
        });
        store.connections = [conn1, conn2, conn3];

        const payload: WorkflowQueuedPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          position: 1,
          queueSize: 2,
          triggerMode: "auto",
        };

        store.getWorkflowHandlers().handleWorkflowQueued(payload);

        expect(conn1.status).toBe("queued");
        expect(conn2.status).toBe("queued");
        expect(conn3.status).toBe("idle");
      });

      it("direct triggerMode 時僅指定 connectionId 應設為 queued", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1", status: "idle" });
        const conn2 = createMockConnection({ id: "conn-2", status: "idle" });
        store.connections = [conn1, conn2];

        const payload: WorkflowQueuedPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          position: 1,
          queueSize: 1,
          triggerMode: "direct",
        };

        store.getWorkflowHandlers().handleWorkflowQueued(payload);

        expect(conn1.status).toBe("queued");
        expect(conn2.status).toBe("idle");
      });
    });

    describe("handleWorkflowQueueProcessed", () => {
      it("auto/ai-decide triggerMode 時應設為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "queued",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          targetPodId: "pod-target",
          triggerMode: "ai-decide",
          status: "queued",
        });
        store.connections = [conn1, conn2];

        const payload: WorkflowQueueProcessedPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          remainingQueueSize: 0,
          triggerMode: "auto",
        };

        store.getWorkflowHandlers().handleWorkflowQueueProcessed(payload);

        expect(conn1.status).toBe("active");
        expect(conn2.status).toBe("active");
      });

      it("direct triggerMode 時僅指定 connectionId 應設為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1", status: "queued" });
        const conn2 = createMockConnection({ id: "conn-2", status: "queued" });
        store.connections = [conn1, conn2];

        const payload: WorkflowQueueProcessedPayload = {
          canvasId: "canvas-1",
          connectionId: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          remainingQueueSize: 0,
          triggerMode: "direct",
        };

        store.getWorkflowHandlers().handleWorkflowQueueProcessed(payload);

        expect(conn1.status).toBe("active");
        expect(conn2.status).toBe("queued");
      });
    });
  });

  describe("事件處理", () => {
    describe("addConnectionFromEvent", () => {
      it("應新增不重複的 Connection，status 預設 idle", () => {
        const store = useConnectionStore();

        const connEvent = {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          triggerMode: "auto" as TriggerMode,
        };

        store.addConnectionFromEvent(connEvent);

        expect(store.connections).toHaveLength(1);
        expect(store.connections[0]).toMatchObject({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          triggerMode: "auto",
          status: "idle",
        });
      });

      it("已存在的 Connection 不應重複新增", () => {
        const store = useConnectionStore();
        const existingConn = createMockConnection({ id: "conn-1" });
        store.connections = [existingConn];

        const connEvent = {
          id: "conn-1",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          triggerMode: "auto" as TriggerMode,
        };

        store.addConnectionFromEvent(connEvent);

        expect(store.connections).toHaveLength(1);
      });

      it("triggerMode 未提供時應預設 auto", () => {
        const store = useConnectionStore();

        const connEvent = {
          id: "conn-1",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
        };

        store.addConnectionFromEvent(connEvent as any);

        expect(store.connections[0]?.triggerMode).toBe("auto");
      });
    });

    describe("updateConnectionFromEvent", () => {
      it("應更新指定 Connection、保留現有 status 和 decideReason", () => {
        const store = useConnectionStore();
        const existingConn = createMockConnection({
          id: "conn-1",
          triggerMode: "auto",
          status: "active",
          decideReason: "existing reason",
        });
        store.connections = [existingConn];

        const connEvent = {
          id: "conn-1",
          sourcePodId: "pod-new",
          sourceAnchor: "left" as const,
          targetPodId: "pod-b",
          targetAnchor: "right" as const,
          triggerMode: "direct" as TriggerMode,
        };

        store.updateConnectionFromEvent(connEvent);

        expect(store.connections[0]).toMatchObject({
          id: "conn-1",
          sourcePodId: "pod-new",
          sourceAnchor: "left",
          triggerMode: "direct",
          status: "active", // 保留
          decideReason: "existing reason", // 保留
        });
      });

      it("Connection 不存在時不應報錯", () => {
        const store = useConnectionStore();

        const connEvent = {
          id: "non-existent",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          triggerMode: "auto" as TriggerMode,
        };

        expect(() => store.updateConnectionFromEvent(connEvent)).not.toThrow();
        expect(store.connections).toHaveLength(0);
      });

      it("event 提供 decideReason 時應覆蓋", () => {
        const store = useConnectionStore();
        const existingConn = createMockConnection({
          id: "conn-1",
          status: "ai-rejected",
          decideReason: "old reason",
        });
        store.connections = [existingConn];

        const connEvent = {
          id: "conn-1",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          triggerMode: "ai-decide" as TriggerMode,
          decideReason: "new reason",
        };

        store.updateConnectionFromEvent(connEvent);

        expect(store.connections[0]?.decideReason).toBe("new reason");
      });
    });

    describe("removeConnectionFromEvent", () => {
      it("應移除指定 Connection", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({ id: "conn-1" });
        const conn2 = createMockConnection({ id: "conn-2" });
        store.connections = [conn1, conn2];

        store.removeConnectionFromEvent("conn-1");

        expect(store.connections).toHaveLength(1);
        expect(store.connections[0]?.id).toBe("conn-2");
      });
    });
  });

  describe("loadConnectionsFromBackend", () => {
    it("成功時應設定 connections、triggerMode 預設 auto、status 直接使用 connectionStatus", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourcePodId: "pod-a",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            triggerMode: "auto",
            connectionStatus: "idle",
          },
          {
            id: "conn-2",
            sourcePodId: "pod-b",
            sourceAnchor: "bottom",
            targetPodId: "pod-c",
            targetAnchor: "top",
            connectionStatus: "ai-approved",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections).toHaveLength(2);
      expect(store.connections[0]).toMatchObject({
        id: "conn-1",
        triggerMode: "auto",
        status: "idle",
      });
      expect(store.connections[1]).toMatchObject({
        id: "conn-2",
        triggerMode: "auto", // 預設
        status: "ai-approved", // 直接使用後端回傳的 connectionStatus
      });
    });

    it("無 activeCanvasId 時不應載入", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      const store = useConnectionStore();

      await store.loadConnectionsFromBackend();

      expect(console.warn).toHaveBeenCalledWith(
        "[ConnectionStore] 沒有啟用的畫布",
      );
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("後端未回傳 connectionStatus 時應 fallback 為 idle", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.status).toBe("idle");
    });

    it("connectionStatus 為 ai-deciding 時應正確設定", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            connectionStatus: "ai-deciding",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.status).toBe("ai-deciding");
    });

    it("decideReason 應正確設定", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            connectionStatus: "ai-rejected",
            decideReason: "Not relevant",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.status).toBe("ai-rejected");
      expect(store.connections[0]?.decideReason).toBe("Not relevant");
    });
  });

  describe("selectConnection", () => {
    it("應設定 selectedConnectionId", () => {
      const store = useConnectionStore();

      store.selectConnection("conn-123");

      expect(store.selectedConnectionId).toBe("conn-123");
    });

    it("可以清除選取", () => {
      const store = useConnectionStore();
      store.selectedConnectionId = "conn-123";

      store.selectConnection(null);

      expect(store.selectedConnectionId).toBeNull();
    });
  });

  describe("isWorkflowRunning", () => {
    it("無下游 connection 時回傳 false", () => {
      const store = useConnectionStore();

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("所有下游 connection 皆為 idle 時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("任一下游 connection 為 active 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "active",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 connection 為 queued 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "queued",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 connection 為 waiting 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "waiting",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 connection 為 ai-deciding 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "ai-deciding",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 connection 為 ai-approved 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "ai-approved",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("下游 connection 為 ai-rejected 時回傳 false（該分支已結束）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "ai-rejected",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("下游 connection 為 ai-error 時回傳 false（該分支已結束）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "idle" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "ai-error",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("任一下游 pod 為 chatting 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target", status: "chatting" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 pod 為 summarizing 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target", status: "summarizing" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("下游 pod 為 idle 或 error 時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a", status: "idle" }),
        createMockPod({ id: "pod-target-b", status: "error" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-a",
          status: "idle",
        }),
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-b",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("BFS 多層遍歷：第二層 connection 為 active 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-mid", status: "idle" }),
        createMockPod({ id: "pod-end", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-mid",
          status: "idle",
        }),
        createMockConnection({
          sourcePodId: "pod-mid",
          targetPodId: "pod-end",
          status: "active",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("BFS 多層遍歷：第二層 pod 為 chatting 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-mid", status: "idle" }),
        createMockPod({ id: "pod-end", status: "chatting" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-mid",
          status: "idle",
        }),
        createMockConnection({
          sourcePodId: "pod-mid",
          targetPodId: "pod-end",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("混合情境：一條分支 ai-rejected，另一條分支 active -> 回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a", status: "idle" }),
        createMockPod({ id: "pod-target-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-a",
          status: "ai-rejected",
        }),
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-b",
          status: "active",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("混合情境：所有分支都已結束（ai-rejected + idle）-> 回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a", status: "idle" }),
        createMockPod({ id: "pod-target-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-a",
          status: "ai-rejected",
        }),
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-b",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("環形 connection 不造成無限迴圈", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "idle" }),
        createMockPod({ id: "pod-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
        createMockConnection({
          sourcePodId: "pod-b",
          targetPodId: "pod-a",
          status: "idle",
        }),
      ];

      expect(() => store.isWorkflowRunning("pod-a")).not.toThrow();
      expect(store.isWorkflowRunning("pod-a")).toBe(false);
    });

    it("source pod 自身 status 為 chatting 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-source", status: "chatting" })];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("source pod 自身 status 為 summarizing 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-source", status: "summarizing" }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("source pod 自身 status 為 idle 且無下游活動時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-source", status: "idle" }),
        createMockPod({ id: "pod-target", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });
  });

  describe("isPartOfRunningWorkflow", () => {
    it("所有 Pod 和連線都是 idle 時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-head", status: "idle" }),
        createMockPod({ id: "pod-tail", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-head",
          targetPodId: "pod-tail",
          status: "idle",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-head")).toBe(false);
    });

    it("下游 Pod 在 chatting 時回傳 true（從頭 Pod 往下查）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-head", status: "idle" }),
        createMockPod({ id: "pod-tail", status: "chatting" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-head",
          targetPodId: "pod-tail",
          status: "idle",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-head")).toBe(true);
    });

    it("上游連線是 active 時回傳 true（從尾 Pod 往上查）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-head", status: "idle" }),
        createMockPod({ id: "pod-tail", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-head",
          targetPodId: "pod-tail",
          status: "active",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-tail")).toBe(true);
    });

    it("自己 Pod 在 chatting 時應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "chatting" }),
        createMockPod({ id: "pod-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-a")).toBe(true);
    });

    it("自己 Pod 在 summarizing 時應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "summarizing" }),
        createMockPod({ id: "pod-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-a")).toBe(true);
    });

    it("連線 status 為 queued 時應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "idle" }),
        createMockPod({ id: "pod-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "queued",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-a")).toBe(true);
    });

    it("連線 status 為 waiting 時應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "idle" }),
        createMockPod({ id: "pod-b", status: "idle" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "waiting",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-a")).toBe(true);
    });

    it("三層 BFS（A->B->C）從 A 查到 C 在 chatting 應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a", status: "idle" }),
        createMockPod({ id: "pod-b", status: "idle" }),
        createMockPod({ id: "pod-c", status: "chatting" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          status: "idle",
        }),
        createMockConnection({
          sourcePodId: "pod-b",
          targetPodId: "pod-c",
          status: "idle",
        }),
      ];

      expect(store.isPartOfRunningWorkflow("pod-a")).toBe(true);
    });
  });

  describe("getPodWorkflowRole", () => {
    it("獨立 Pod（無連線）回傳 independent", () => {
      const store = useConnectionStore();
      store.connections = [];

      expect(store.getPodWorkflowRole("pod-a")).toBe("independent");
    });

    it("頭 Pod（該 Pod 為 source，無上游）回傳 head", () => {
      const store = useConnectionStore();
      store.connections = [
        createMockConnection({ sourcePodId: "pod-a", targetPodId: "pod-b" }),
      ];

      expect(store.getPodWorkflowRole("pod-a")).toBe("head");
    });

    it("尾 Pod（該 Pod 為 target，無下游）回傳 tail", () => {
      const store = useConnectionStore();
      store.connections = [
        createMockConnection({ sourcePodId: "pod-a", targetPodId: "pod-b" }),
      ];

      expect(store.getPodWorkflowRole("pod-b")).toBe("tail");
    });

    it("中間 Pod（同時為 target 和 source）回傳 middle", () => {
      const store = useConnectionStore();
      store.connections = [
        createMockConnection({ sourcePodId: "pod-a", targetPodId: "pod-b" }),
        createMockConnection({ sourcePodId: "pod-b", targetPodId: "pod-c" }),
      ];

      expect(store.getPodWorkflowRole("pod-b")).toBe("middle");
    });

    it("分支 Workflow（A->B, A->C, C->D）：A=head, B=tail, C=middle, D=tail", () => {
      const store = useConnectionStore();
      store.connections = [
        createMockConnection({ sourcePodId: "pod-a", targetPodId: "pod-b" }),
        createMockConnection({ sourcePodId: "pod-a", targetPodId: "pod-c" }),
        createMockConnection({ sourcePodId: "pod-c", targetPodId: "pod-d" }),
      ];

      expect(store.getPodWorkflowRole("pod-a")).toBe("head");
      expect(store.getPodWorkflowRole("pod-b")).toBe("tail");
      expect(store.getPodWorkflowRole("pod-c")).toBe("middle");
      expect(store.getPodWorkflowRole("pod-d")).toBe("tail");
    });

    it("動態刪除連線後角色更新：A->B->C 刪除 B->C 後 B 變成 tail", () => {
      const store = useConnectionStore();
      const connAB = createMockConnection({
        id: "conn-ab",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
      });
      const connBC = createMockConnection({
        id: "conn-bc",
        sourcePodId: "pod-b",
        targetPodId: "pod-c",
      });
      store.connections = [connAB, connBC];

      expect(store.getPodWorkflowRole("pod-b")).toBe("middle");

      store.connections = store.connections.filter(
        (conn) => conn.id !== "conn-bc",
      );

      expect(store.getPodWorkflowRole("pod-b")).toBe("tail");
    });
  });

  describe("reconcileSummaryModelsForPod", () => {
    function setupCapabilities() {
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
            command: true,
            mcp: true,
          },
          availableModels: [
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
            { value: "haiku", label: "Haiku" },
          ],
        },
        {
          name: "codex",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-5.5", label: "GPT-5.5" },
          ],
        },
      ]);
    }

    it("Claude → Codex 切換時，原本是 sonnet 的 connection 應被更新為 gpt-5.4", async () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      setupCapabilities();

      const pod = createMockPod({ id: "pod-src", provider: "codex" });
      podStore.pods = [pod];

      const conn = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-src",
        targetPodId: "pod-dst",
        summaryModel: "sonnet",
      });
      store.connections = [conn];

      // reconcileSummaryModelsForPod 需要有 activeCanvasId 才能透過 executeAction 發送請求
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-src",
          sourceAnchor: "bottom",
          targetPodId: "pod-dst",
          targetAnchor: "top",
          summaryModel: "gpt-5.4",
        },
      });

      await store.reconcileSummaryModelsForPod("pod-src");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            connectionId: "conn-1",
            summaryModel: "gpt-5.4",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("Codex → Claude 切換時，原本是 gpt-5.5 的 connection 應被更新為 sonnet", async () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      setupCapabilities();

      const pod = createMockPod({ id: "pod-src", provider: "claude" });
      podStore.pods = [pod];

      const conn = createMockConnection({
        id: "conn-2",
        sourcePodId: "pod-src",
        targetPodId: "pod-dst",
        summaryModel: "gpt-5.5" as never,
      });
      store.connections = [conn];

      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-2",
          sourcePodId: "pod-src",
          sourceAnchor: "bottom",
          targetPodId: "pod-dst",
          targetAnchor: "top",
          summaryModel: "sonnet",
        },
      });

      await store.reconcileSummaryModelsForPod("pod-src");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            connectionId: "conn-2",
            summaryModel: "sonnet",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("同 provider 內 model 仍合法時不觸發更新", async () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      setupCapabilities();

      const pod = createMockPod({ id: "pod-src", provider: "claude" });
      podStore.pods = [pod];

      const conn = createMockConnection({
        id: "conn-3",
        sourcePodId: "pod-src",
        targetPodId: "pod-dst",
        summaryModel: "sonnet",
      });
      store.connections = [conn];

      await store.reconcileSummaryModelsForPod("pod-src");

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("podId 不存在時直接返回，不執行任何操作", async () => {
      const store = useConnectionStore();
      const conn = createMockConnection({
        id: "conn-4",
        sourcePodId: "pod-src",
        targetPodId: "pod-dst",
        summaryModel: "sonnet",
      });
      store.connections = [conn];

      await store.reconcileSummaryModelsForPod("non-existent");

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("無以該 Pod 為 source 的 connection 時不執行任何操作", async () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      setupCapabilities();

      const pod = createMockPod({ id: "pod-src", provider: "codex" });
      podStore.pods = [pod];

      // 這條 connection 是 pod-other 為 source，不應受影響
      const conn = createMockConnection({
        id: "conn-5",
        sourcePodId: "pod-other",
        targetPodId: "pod-dst",
        summaryModel: "sonnet",
      });
      store.connections = [conn];

      await store.reconcileSummaryModelsForPod("pod-src");

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });
  });

  // ── updateConnectionSummaryProvider ──────────────────────────────────────
  describe("updateConnectionSummaryProvider", () => {
    it("WS payload 應同時包含 summaryProvider 與 summaryModel", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryProvider: "gemini",
          summaryModel: "gemini-2.5-flash",
        },
      });

      await store.updateConnectionSummaryProvider(
        "conn-1",
        "gemini",
        "gemini-2.5-flash",
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            connectionId: "conn-1",
            summaryProvider: "gemini",
            summaryModel: "gemini-2.5-flash",
            canvasId: "canvas-1",
          }),
        }),
      );
    });

    it("成功時應回傳正規化後的 Connection，含 summaryProvider 欄位", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryProvider: "codex",
          summaryModel: "gpt-5.4",
        },
      });

      const result = await store.updateConnectionSummaryProvider(
        "conn-1",
        "codex",
        "gpt-5.4",
      );

      expect(result?.summaryProvider).toBe("codex");
      expect(result?.summaryModel).toBe("gpt-5.4");
    });

    it("WS 回應無 connection 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({});

      const result = await store.updateConnectionSummaryProvider(
        "conn-1",
        "gemini",
        "gemini-2.5-flash",
      );

      expect(result).toBeNull();
    });

    it("無 activeCanvasId 時應回傳 null，不送 WS 請求", async () => {
      const store = useConnectionStore();

      const result = await store.updateConnectionSummaryProvider(
        "conn-1",
        "claude",
        "sonnet",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("payload 不應包含 triggerMode 或 aiDecideModel 欄位", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryProvider: "gemini",
          summaryModel: "gemini-2.5-flash",
        },
      });

      await store.updateConnectionSummaryProvider(
        "conn-1",
        "gemini",
        "gemini-2.5-flash",
      );

      const sentPayload =
        mockCreateWebSocketRequest.mock.calls[0]?.[0]?.payload;
      expect(sentPayload).not.toHaveProperty("triggerMode");
      expect(sentPayload).not.toHaveProperty("aiDecideModel");
    });
  });

  // ── updateConnectionSummaryModel（確認不帶 summaryProvider）──────────────
  describe("updateConnectionSummaryModel 不帶 summaryProvider", () => {
    it("WS payload 應只含 summaryModel，不含 summaryProvider", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-1",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryModel: "haiku",
        },
      });

      await store.updateConnectionSummaryModel("conn-1", "haiku");

      const sentPayload =
        mockCreateWebSocketRequest.mock.calls[0]?.[0]?.payload;
      expect(sentPayload).toHaveProperty("summaryModel", "haiku");
      expect(sentPayload).not.toHaveProperty("summaryProvider");
    });
  });

  // ── normalizeConnection summaryProvider 處理 ─────────────────────────────
  describe("normalizeConnection summaryProvider 正規化", () => {
    it("loadConnectionsFromBackend：raw 帶 summaryProvider 時應直接保留", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            summaryProvider: "gemini",
            summaryModel: "gemini-2.5-flash",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.summaryProvider).toBe("gemini");
    });

    it("loadConnectionsFromBackend：raw 不帶 summaryProvider 時欄位應為 undefined", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      // summaryProvider 未帶入時應為 undefined（非 null、非其他值）
      expect(store.connections[0]?.summaryProvider).toBeUndefined();
    });

    it("loadConnectionsFromBackend：raw summaryProvider 為 null 時應保留 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            summaryProvider: null,
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.summaryProvider).toBeNull();
    });
  });

  // ── updateConnectionFromEvent summaryProvider 處理 ──────────────────────
  describe("updateConnectionFromEvent summaryProvider 更新策略", () => {
    it("broadcast 帶 summaryProvider 具體值時應覆蓋現有值", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "sonnet",
      });
      store.connections = [existingConn];

      store.updateConnectionFromEvent({
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
        summaryProvider: "gemini",
        summaryModel: "gemini-2.5-flash",
      });

      expect(store.connections[0]?.summaryProvider).toBe("gemini");
    });

    it("broadcast 帶 summaryProvider null 時應寫入 null（而非保留既有值）", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "codex",
        summaryModel: "gpt-5.4",
      });
      store.connections = [existingConn];

      store.updateConnectionFromEvent({
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
        summaryProvider: null,
      });

      // null 應直接寫入，不視為「未帶欄位」
      expect(store.connections[0]?.summaryProvider).toBeNull();
    });

    it("broadcast 不帶 summaryProvider 欄位時應保留既有值", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "gemini",
        summaryModel: "gemini-2.5-flash",
      });
      store.connections = [existingConn];

      // 不帶 summaryProvider 屬性（undefined）
      const eventWithoutProvider: Omit<
        Parameters<typeof store.updateConnectionFromEvent>[0],
        "summaryProvider"
      > = {
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
      };

      store.updateConnectionFromEvent(
        eventWithoutProvider as Parameters<
          typeof store.updateConnectionFromEvent
        >[0],
      );

      // 未帶入 summaryProvider 時保留既有的 gemini
      expect(store.connections[0]?.summaryProvider).toBe("gemini");
    });

    it("broadcast 帶 summaryProvider 具體值時 summaryModel 應一併更新", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "sonnet",
      });
      store.connections = [existingConn];

      store.updateConnectionFromEvent({
        id: "conn-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "auto",
        summaryProvider: "codex",
        summaryModel: "gpt-5.4",
      });

      expect(store.connections[0]?.summaryModel).toBe("gpt-5.4");
    });
  });
});
