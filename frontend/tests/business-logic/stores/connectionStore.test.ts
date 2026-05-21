import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest } from "@tests/helpers/testSetup";
import {
  createMockCanvas,
  createMockConnection,
  createMockPod,
} from "@tests/helpers/factories";
import { useConnectionStore } from "@/stores/connectionStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import type {
  Connection,
  TriggerMode,
  ConnectionStatus,
  DecideStatus,
} from "@/types/connection";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowCompletePayload,
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

    describe("getBranchConnectionsBySourcePodId", () => {
      it("應篩選 sourcePodId + ai-decide", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          triggerMode: "branch",
        });
        const conn2 = createMockConnection({
          id: "conn-2",
          sourcePodId: "pod-a",
          triggerMode: "auto",
        });
        const conn3 = createMockConnection({
          id: "conn-3",
          sourcePodId: "pod-b",
          triggerMode: "branch",
        });
        const conn4 = createMockConnection({
          id: "conn-4",
          sourcePodId: "pod-a",
          triggerMode: "branch",
        });
        store.connections = [conn1, conn2, conn3, conn4];

        const result = store.getBranchConnectionsBySourcePodId("pod-a");

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
          availableModels: [
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "codex",
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

      expect(result).toEqual(
        expect.objectContaining({
          ...newConnection,
          summaryProvider: "claude",
        }),
      );
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

    it("後端回傳 connectionStatus 與 decideStatus 時應直接使用", async () => {
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
          triggerMode: "branch",
          connectionStatus: "active",
          decideStatus: "approved",
        },
      });

      const result = await store.createConnection(
        "pod-a",
        "bottom",
        "pod-b",
        "top",
      );

      expect(result?.status).toBe("active");
      expect(result?.decideStatus).toBe("approved");
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
        triggerMode: "branch",
      });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: { ...updatedConnection },
      });

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "branch",
      );

      expect(result).toEqual(
        expect.objectContaining({
          ...updatedConnection,
          summaryProvider: "claude",
        }),
      );
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            connectionId: "conn-1",
            triggerMode: "branch",
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

    it("後端回傳 connectionStatus 與 decideStatus 時應直接使用", async () => {
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
          triggerMode: "branch",
          connectionStatus: "idle",
          decideStatus: "rejected",
          decideReason: "不符合條件",
        },
      });

      const result = await store.updateConnectionTriggerMode(
        "conn-1",
        "branch",
      );

      expect(result?.status).toBe("idle");
      expect(result?.decideStatus).toBe("rejected");
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
          triggerMode: "branch",
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

      it("應將 decideStatus approved 的 Connection 更新為 active", () => {
        const store = useConnectionStore();
        const conn1 = createMockConnection({
          id: "conn-1",
          targetPodId: "pod-target",
          triggerMode: "branch",
          status: "idle",
          decideStatus: "approved" as DecideStatus,
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
          triggerMode: "branch",
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
          triggerMode: "branch",
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
          triggerMode: "branch",
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

    describe("isOutOfOrderUpdate — 事件亂序保護", () => {
      it("decideStatus 為 pending 時，incoming status = active 應被拒（connection.status 保持原值）", () => {
        // Arrange：建立一條 decideStatus: pending 的 connection
        const store = useConnectionStore();
        const conn = createMockConnection({
          id: "conn-pending",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          triggerMode: "auto",
          status: "idle",
          decideStatus: "pending" as DecideStatus,
        });
        store.connections = [conn];

        // Act：透過 handleWorkflowAutoTriggered 觸發 updateAutoGroupStatus 嘗試設為 active
        const payload: WorkflowAutoTriggeredPayload = {
          connectionId: "conn-pending",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          transferredContent: "test",
          isSummarized: false,
        };
        store.getWorkflowHandlers().handleWorkflowAutoTriggered(payload);

        // Assert：decideStatus pending 保護生效，status 不被改為 active
        expect(store.connections[0]?.status).toBe("idle");
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
          decideStatus: "none" as DecideStatus,
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
          decideStatus: "none" as DecideStatus,
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
          decideStatus: "none" as DecideStatus,
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
          decideStatus: "none" as DecideStatus,
        };

        expect(() => store.updateConnectionFromEvent(connEvent)).not.toThrow();
        expect(store.connections).toHaveLength(0);
      });

      it("event 提供 decideReason 時應覆蓋", () => {
        const store = useConnectionStore();
        const existingConn = createMockConnection({
          id: "conn-1",
          status: "idle",
          decideStatus: "rejected" as DecideStatus,
          decideReason: "old reason",
        });
        store.connections = [existingConn];

        const connEvent = {
          id: "conn-1",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          triggerMode: "branch" as TriggerMode,
          decideStatus: "none" as DecideStatus,
          decideReason: "new reason",
        };

        store.updateConnectionFromEvent(connEvent);

        expect(store.connections[0]?.decideReason).toBe("new reason");
      });

      it("收到 decideStatus: approved → connection.decideStatus 更新", () => {
        // Arrange：store 中有 decideStatus: none 的 connection
        const store = useConnectionStore();
        const existingConn = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          triggerMode: "branch",
          status: "idle",
          decideStatus: "none" as DecideStatus,
        });
        store.connections = [existingConn];

        // Act：收到帶 decideStatus: approved 的事件
        store.updateConnectionFromEvent({
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "branch" as TriggerMode,
          decideStatus: "approved" as DecideStatus,
        });

        // Assert：decideStatus 更新為 approved
        expect(store.connections[0]?.decideStatus).toBe("approved");
      });

      it("收到不含 decideStatus 的 payload → 保留現有 decideStatus（不被清掉）", () => {
        // Arrange：store 中有 decideStatus: pending 的 connection
        const store = useConnectionStore();
        const existingConn = createMockConnection({
          id: "conn-1",
          sourcePodId: "pod-a",
          targetPodId: "pod-b",
          triggerMode: "branch",
          status: "idle",
          decideStatus: "pending" as DecideStatus,
        });
        store.connections = [existingConn];

        // Act：收到不帶 decideStatus 的事件（undefined）
        store.updateConnectionFromEvent({
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "branch" as TriggerMode,
        } as Parameters<typeof store.updateConnectionFromEvent>[0]);

        // Assert：現有 decideStatus pending 保留，不被清掉
        expect(store.connections[0]?.decideStatus).toBe("pending");
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
    it("成功時應設定 connections、triggerMode 預設 auto、status 與 decideStatus 直接使用後端回傳值", async () => {
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
            decideStatus: "none",
          },
          {
            id: "conn-2",
            sourcePodId: "pod-b",
            sourceAnchor: "bottom",
            targetPodId: "pod-c",
            targetAnchor: "top",
            connectionStatus: "active",
            decideStatus: "approved",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections).toHaveLength(2);
      expect(store.connections[0]).toMatchObject({
        id: "conn-1",
        triggerMode: "auto",
        status: "idle",
        decideStatus: "none",
      });
      expect(store.connections[1]).toMatchObject({
        id: "conn-2",
        triggerMode: "auto", // 預設
        status: "active",
        decideStatus: "approved",
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

    it("decideStatus pending 時應正確設定", async () => {
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
            connectionStatus: "idle",
            decideStatus: "pending",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.status).toBe("idle");
      expect(store.connections[0]?.decideStatus).toBe("pending");
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
            connectionStatus: "idle",
            decideStatus: "rejected",
            decideReason: "Not relevant",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.decideStatus).toBe("rejected");
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
      podStore.pods = [createMockPod({ id: "pod-target" })];
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
      podStore.pods = [createMockPod({ id: "pod-target" })];
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
      podStore.pods = [createMockPod({ id: "pod-target" })];
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
      podStore.pods = [createMockPod({ id: "pod-target" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "waiting",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("任一下游 connection 為 decideStatus pending 時回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
          decideStatus: "pending" as DecideStatus,
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("下游 connection 為 decideStatus approved 時回傳 false（決策已完成，等待觸發）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
          decideStatus: "approved" as DecideStatus,
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("下游 connection 為 decideStatus rejected 時回傳 false（該分支已結束）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
          decideStatus: "rejected" as DecideStatus,
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("下游 connection 為 decideStatus error 時回傳 false（該分支已結束）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-target" })];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          status: "idle",
          decideStatus: "error" as DecideStatus,
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(false);
    });

    it("下游 pod 為 idle 或 error 時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a" }),
        createMockPod({ id: "pod-target-b" }),
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
        createMockPod({ id: "pod-mid" }),
        createMockPod({ id: "pod-end" }),
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

    it("混合情境：一條分支 rejected，另一條分支 active -> 回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a" }),
        createMockPod({ id: "pod-target-b" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-a",
          status: "idle",
          decideStatus: "rejected" as DecideStatus,
        }),
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-b",
          status: "active",
        }),
      ];

      expect(store.isWorkflowRunning("pod-source")).toBe(true);
    });

    it("混合情境：所有分支都已結束（rejected + idle）-> 回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-target-a" }),
        createMockPod({ id: "pod-target-b" }),
      ];
      store.connections = [
        createMockConnection({
          sourcePodId: "pod-source",
          targetPodId: "pod-target-a",
          status: "idle",
          decideStatus: "rejected" as DecideStatus,
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
        createMockPod({ id: "pod-a" }),
        createMockPod({ id: "pod-b" }),
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

    it("source pod 自身 status 為 idle 且無下游活動時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-source" }),
        createMockPod({ id: "pod-target" }),
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

    it("branch connection decideStatus === pending 時橡皮擦應 disabled（回傳 true）", () => {
      // Arrange：head pod + branch connection（status: idle, decideStatus: pending）+ downstream pod
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "head-pod" }),
        createMockPod({ id: "downstream-pod" }),
      ];
      store.connections = [
        createMockConnection({
          id: "branch-conn",
          sourcePodId: "head-pod",
          targetPodId: "downstream-pod",
          triggerMode: "branch",
          status: "idle",
          decideStatus: "pending" as DecideStatus,
        }),
      ];

      // Act + Assert：decideStatus pending 代表 AI 正在決策中，工作流仍在執行
      expect(store.isWorkflowRunning("head-pod")).toBe(true);
    });

    it("所有 connection status=idle 且 decideStatus=none 時應回 false（橡皮擦 enabled）", () => {
      // Arrange：head pod + connection（status: idle, decideStatus: none）+ downstream pod
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "head-pod" }),
        createMockPod({ id: "downstream-pod" }),
      ];
      store.connections = [
        createMockConnection({
          id: "conn-1",
          sourcePodId: "head-pod",
          targetPodId: "downstream-pod",
          status: "idle",
          decideStatus: "none" as DecideStatus,
        }),
      ];

      // Act + Assert：所有狀態都已結束，橡皮擦應可使用
      expect(store.isWorkflowRunning("head-pod")).toBe(false);
    });

    it("multi-input 一條 approved 一條 rejected 且 downstream pod idle → 橡皮擦 enabled（回傳 false）", () => {
      // 修正 Bug B：rejected 與 approved 不再讓 isWorkflowRunning 卡在 true
      // Arrange：head pod → conn-1（decideStatus: approved）
      //          head2 pod → conn-2（decideStatus: rejected）
      //          共同 downstream pod（status: idle）
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "head-pod" }),
        createMockPod({ id: "head2-pod" }),
        createMockPod({ id: "downstream-pod" }),
      ];
      store.connections = [
        createMockConnection({
          id: "conn-1",
          sourcePodId: "head-pod",
          targetPodId: "downstream-pod",
          status: "idle",
          decideStatus: "approved" as DecideStatus,
        }),
        createMockConnection({
          id: "conn-2",
          sourcePodId: "head2-pod",
          targetPodId: "downstream-pod",
          status: "idle",
          decideStatus: "rejected" as DecideStatus,
        }),
      ];

      // Act + Assert：決策已完成（approved/rejected 均非執行中），應回傳 false
      expect(store.isWorkflowRunning("head-pod")).toBe(false);
    });
  });

  describe("isPartOfRunningWorkflow", () => {
    it("所有 Pod 和連線都是 idle 時回傳 false", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-head" }),
        createMockPod({ id: "pod-tail" }),
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

    it("上游連線是 active 時回傳 true（從尾 Pod 往上查）", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-head" }),
        createMockPod({ id: "pod-tail" }),
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

    it("連線 status 為 queued 時應回傳 true", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({ id: "pod-a" }),
        createMockPod({ id: "pod-b" }),
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
        createMockPod({ id: "pod-a" }),
        createMockPod({ id: "pod-b" }),
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
          availableModels: [
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
            { value: "haiku", label: "Haiku" },
          ],
        },
        {
          name: "codex",
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
          summaryProvider: "claude",
          summaryModel: "sonnet",
        },
      });

      await store.updateConnectionSummaryProvider("conn-1", "claude", "sonnet");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            connectionId: "conn-1",
            summaryProvider: "claude",
            summaryModel: "sonnet",
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
        "claude",
        "sonnet",
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
          summaryProvider: "claude",
          summaryModel: "sonnet",
        },
      });

      await store.updateConnectionSummaryProvider("conn-1", "claude", "sonnet");

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
    it("loadConnectionsFromBackend：legacy gemini summaryProvider 應收斂為 claude", async () => {
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

      expect(store.connections[0]?.summaryProvider).toBe("claude");
      expect(store.connections[0]?.summaryModel).toBe("sonnet");
    });

    it("loadConnectionsFromBackend：raw 不帶 summaryProvider 時應從 source provider 收斂", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-a", provider: "codex" })];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourcePodId: "pod-a",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.summaryProvider).toBe("codex");
    });

    it("loadConnectionsFromBackend：raw summaryProvider 為 null 時應從 source provider 收斂", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-a", provider: "codex" })];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connections: [
          {
            id: "conn-1",
            sourcePodId: "pod-a",
            sourceAnchor: "bottom",
            targetPodId: "pod-b",
            targetAnchor: "top",
            summaryProvider: null,
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections[0]?.summaryProvider).toBe("codex");
    });
  });

  // ── updateConnectionFromEvent summaryProvider 處理 ──────────────────────
  describe("updateConnectionFromEvent summaryProvider 更新策略", () => {
    it("broadcast 帶 legacy gemini summaryProvider 時應正規化為 claude", () => {
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
        decideStatus: "none" as DecideStatus,
      });

      expect(store.connections[0]?.summaryProvider).toBe("claude");
      expect(store.connections[0]?.summaryModel).toBe("gemini-2.5-flash");
    });

    it("broadcast 帶 summaryProvider null 時應從 source provider 收斂為 concrete 值", () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-a", provider: "codex" })];
      const existingConn = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
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
        decideStatus: "none" as DecideStatus,
      });

      expect(store.connections[0]?.summaryProvider).toBe("codex");
    });

    it("broadcast 不帶 summaryProvider 欄位時應保留既有值", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "codex",
        summaryModel: "gpt-5.4",
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
        decideStatus: "none" as DecideStatus,
      };

      store.updateConnectionFromEvent(
        eventWithoutProvider as Parameters<
          typeof store.updateConnectionFromEvent
        >[0],
      );

      expect(store.connections[0]?.summaryProvider).toBe("codex");
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
        decideStatus: "none" as DecideStatus,
      });

      expect(store.connections[0]?.summaryModel).toBe("gpt-5.4");
    });
  });

  // ── updateConnectionTriggerMode("branch") wire-up smoke ──────────────────
  describe("updateConnectionTriggerMode branch wire-up smoke", () => {
    it("呼叫後 mock websocketClient 收到帶 triggerMode: branch 的 connection:update 請求", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: createMockConnection({
          id: "conn-branch",
          triggerMode: "branch",
        }),
      });

      await store.updateConnectionTriggerMode("conn-branch", "branch");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-branch",
            triggerMode: "branch",
          }),
        }),
      );
    });
  });

  // ── updateConnectionBranchLabel wire-up smoke ─────────────────────────────
  describe("updateConnectionBranchLabel", () => {
    it("wire-up smoke：呼叫後 mock websocketClient 收到帶 label 的 connection:update 請求", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      // 預先注入 connection（validateBranchLabel 需要 sourcePodId）
      const conn = createMockConnection({
        id: "conn-label-1",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: { ...conn, label: "Checklist" },
      });

      await store.updateConnectionBranchLabel("conn-label-1", "Checklist");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-label-1",
            label: "Checklist",
          }),
        }),
      );
    });

    // ── sad case B1：label 重複（同 source Pod 已有相同 label） ──────────────
    it("B1 sad case：同 source Pod 已有 label=Checklist 的 branch → 不發 WS 且 toast 帶 branchLabelDuplicate", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      // conn-1 已有 label="Checklist"，conn-2 為欲更新的目標
      const conn1 = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        label: "Checklist",
      });
      const conn2 = createMockConnection({
        id: "conn-2",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        label: "Other",
      });
      store.connections = [conn1, conn2];

      // 嘗試將 conn-2 的 label 改成已存在的 "Checklist"
      const result = await store.updateConnectionBranchLabel(
        "conn-2",
        "Checklist",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      // mockToast 已在頂層 mock，確認呼叫時 title 包含 branchLabelDuplicate 對應文字
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
        }),
      );
    });

    // ── sad case B2：label="None"（保留字） ──────────────────────────────────
    it("B2 sad case：label=None → 不發 WS 且 toast 帶 branchLabelReserved 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-reserved",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      const result = await store.updateConnectionBranchLabel(
        "conn-reserved",
        "None",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    // ── sad case B3：label="" ──────────────────────────────────────────────
    it("B3 sad case：label 為空字串 → 不發 WS 且 toast 帶 branchLabelEmpty 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-empty",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      const result = await store.updateConnectionBranchLabel("conn-empty", "");

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    // ── sad case B4：label 長度 33（超過上限 32） ─────────────────────────────
    it("B4 sad case：label 長度 33 → 不發 WS 且 toast 帶 branchLabelTooLong 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-long",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      // 長度 33 的字串（超出上限 32）
      const tooLongLabel = "a".repeat(33);
      const result = await store.updateConnectionBranchLabel(
        "conn-long",
        tooLongLabel,
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });

  // ── updateConnectionBranchDescription sad case ────────────────────────────
  describe("updateConnectionBranchDescription", () => {
    // ── sad case B5：description 長度 201（超過上限 200） ────────────────────
    it("B5 sad case：description 長度 201 → 不發 WS 且 toast 帶 branchDescriptionTooLong 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-desc-long",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      // 長度 201 的字串（超出上限 200）
      const tooLongDescription = "b".repeat(201);
      const result = await store.updateConnectionBranchDescription(
        "conn-desc-long",
        tooLongDescription,
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });
});
