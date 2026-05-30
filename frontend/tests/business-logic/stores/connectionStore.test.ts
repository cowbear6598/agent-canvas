import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
  mockWebSocketClient,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { allowConsoleOutput } from "@tests/setup";
import { createMockConnection, createMockPod } from "@tests/helpers/factories";
import { useConnectionStore } from "@/stores/connectionStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import type { Connection, TriggerMode, DecideStatus } from "@/types/connection";
import {
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_LABEL_MAX_LENGTH,
} from "@/types/connection";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowCompletePayload,
  WorkflowDirectTriggeredPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "@/types/websocket";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const mockToast = vi.fn();
const mockShowErrorToast = vi.fn();
const mockShowSuccessToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showErrorToast: mockShowErrorToast,
    showSuccessToast: mockShowSuccessToast,
  }),
}));

describe("connectionStore", () => {
  setupStoreTest();

  describe("workflow listener lifecycle", () => {
    it("setup/cleanup listener 清單不含 direct waiting 且 cleanup 使用同一個 handler", () => {
      const store = useConnectionStore();

      store.setupWorkflowListeners();
      store.cleanupWorkflowListeners();

      const onCalls = mockWebSocketClient.on.mock.calls;
      const offCalls = mockWebSocketClient.off.mock.calls;
      const onEvents = onCalls.map(([event]) => event);
      const offEvents = offCalls.map(([event]) => event);

      expect(onEvents).toEqual([
        "workflow:auto-triggered",
        "workflow:complete",
        "workflow:branch:triggered",
        "workflow:direct-triggered",
        "workflow:queued",
        "workflow:queue-processed",
      ]);
      expect(onEvents).not.toContain("workflow:direct-waiting");
      expect(offEvents).toEqual(onEvents);
      onCalls.forEach(([, handler], index) => {
        expect(offCalls[index]?.[1]).toBe(handler);
      });
    });

    it("重複 setupWorkflowListeners 不應累加重複 handler", () => {
      const store = useConnectionStore();

      store.setupWorkflowListeners();
      store.setupWorkflowListeners();
      store.cleanupWorkflowListeners();

      expect(mockWebSocketClient.on).toHaveBeenCalledTimes(6);
      expect(mockWebSocketClient.off).toHaveBeenCalledTimes(6);
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
            {
              value: "sonnet",
              label: "Sonnet",
              thinkingLevels: ["low", "medium", "high"],
              defaultThinkingLevel: "medium",
            },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "codex",
          availableModels: [
            {
              value: "gpt-5.4",
              label: "GPT-5.4",
              thinkingLevels: ["minimal", "medium", "high"],
              defaultThinkingLevel: "medium",
            },
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
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Connection",
        "建立成功",
      );
      expect(mockShowSuccessToast).toHaveBeenCalledTimes(1);
    });

    it("自我連接時應回傳 null", async () => {
      allowConsoleOutput({
        method: "warn",
        messageIncludes: "[ConnectionStore] 無法將 Pod 連接到自身",
      });
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
        duration: DEFAULT_TOAST_DURATION_MS,
      });
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("無 activeCanvasId 時應回傳 null", async () => {
      const store = useConnectionStore();

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
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryProvider: "claude",
            summaryModel: "sonnet",
          }),
        }),
      );
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
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryProvider: "codex",
            summaryModel: "gpt-5.4",
          }),
        }),
      );
    });

    it("建立 connection 時會帶入 source Pod 的 thinking level 作為 summary 與 branch 預設值", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-codex",
          provider: "codex",
          providerConfig: {
            model: "gpt-5.4",
            thinkingLevel: "high",
          },
        }),
      ];
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

      await store.createConnection("pod-codex", "bottom", "pod-target", "top");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryThinkingLevel: "high",
            branchThinkingLevel: "high",
          }),
        }),
      );
    });

    it("source Pod 未指定 thinking level 時，建立 connection 會帶入模型預設值", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-codex",
          provider: "codex",
          providerConfig: {
            model: "gpt-5.4",
          },
        }),
      ];
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

      await store.createConnection("pod-codex", "bottom", "pod-target", "top");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryThinkingLevel: "medium",
            branchThinkingLevel: "medium",
          }),
        }),
      );
    });

    it("上游為 OpenCode Pod 時，建立連線 payload 應直接使用 Pod 目前的 provider/model", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-opencode",
          provider: "opencode",
          providerConfig: { model: "opencode/deepseek-v4-flash-free" },
        }),
      ];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-opencode",
          sourcePodId: "pod-opencode",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const result = await store.createConnection(
        "pod-opencode",
        "bottom",
        "pod-target",
        "top",
      );

      expect(result?.summaryProvider).toBe("opencode");
      expect(result?.summaryModel).toBe("opencode/deepseek-v4-flash-free");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryProvider: "opencode",
            summaryModel: "opencode/deepseek-v4-flash-free",
          }),
        }),
      );
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
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Connection",
        "刪除成功",
      );
      expect(mockShowSuccessToast).toHaveBeenCalledTimes(1);
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

  describe("removeConnectionFromEvent", () => {
    it("刪除目前 selectedConnectionId 時應清除選取", () => {
      const store = useConnectionStore();
      const conn1 = createMockConnection({ id: "conn-1" });
      const conn2 = createMockConnection({ id: "conn-2" });
      store.connections = [conn1, conn2];
      store.selectedConnectionId = "conn-1";

      store.removeConnectionFromEvent("conn-1");

      expect(store.connections).toEqual([conn2]);
      expect(store.selectedConnectionId).toBeNull();
    });

    it("刪除非 selectedConnectionId 時應保留選取", () => {
      const store = useConnectionStore();
      const conn1 = createMockConnection({ id: "conn-1" });
      const conn2 = createMockConnection({ id: "conn-2" });
      store.connections = [conn1, conn2];
      store.selectedConnectionId = "conn-2";

      store.removeConnectionFromEvent("conn-1");

      expect(store.connections).toEqual([conn2]);
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

  describe("工作流處理", () => {
    describe("handleWorkflowAutoTriggered", () => {
      it("auto/branch Connection 應設為 active", () => {
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
      it("auto/branch triggerMode 時所有 Connection 應回 idle", () => {
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

    describe("handleWorkflowQueued", () => {
      it("auto/branch triggerMode 時應設為 queued", () => {
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
      it("auto/branch triggerMode 時應設為 active", () => {
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

        const payload: WorkflowAutoTriggeredPayload = {
          connectionId: "conn-pending",
          sourcePodId: "pod-source",
          targetPodId: "pod-target",
          transferredContent: "test",
          isSummarized: false,
        };
        store.getWorkflowHandlers().handleWorkflowAutoTriggered(payload);

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

      it("summaryProvider 為 null 時應依 source pod provider 收斂", () => {
        const store = useConnectionStore();
        const podStore = usePodStore();
        podStore.pods = [createMockPod({ id: "pod-a", provider: "opencode" })];

        const connEvent = {
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom" as const,
          targetPodId: "pod-b",
          targetAnchor: "top" as const,
          summaryProvider: null,
        };

        store.addConnectionFromEvent(connEvent as any);

        expect(store.connections[0]?.summaryProvider).toBe("opencode");
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

        store.updateConnectionFromEvent({
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "branch" as TriggerMode,
          decideStatus: "approved" as DecideStatus,
        });

        expect(store.connections[0]?.decideStatus).toBe("approved");
      });

      it("收到不含 decideStatus 的 payload → 保留現有 decideStatus（不被清掉）", () => {
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

        store.updateConnectionFromEvent({
          id: "conn-1",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          triggerMode: "branch" as TriggerMode,
        } as Parameters<typeof store.updateConnectionFromEvent>[0]);

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
      allowConsoleOutput({
        method: "warn",
        messageIncludes: "[ConnectionStore] 沒有啟用的畫布",
      });
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

    it("Summary Provider 切換到 OpenCode 時送出的 provider/model payload 使用第一筆 alias", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const capabilityStore = useProviderCapabilityStore();
      const aliasStore = useOpencodeAliasStore();

      aliasStore.setAliases([
        {
          id: "alias-2",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          alias: "Sonnet",
          orderIdx: 1,
        },
        {
          id: "alias-1",
          providerID: "openai",
          modelID: "gpt-4o",
          alias: "GPT-4o",
          orderIdx: 0,
        },
      ]);

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          id: "conn-opencode-summary",
          sourcePodId: "pod-a",
          sourceAnchor: "bottom",
          targetPodId: "pod-b",
          targetAnchor: "top",
          summaryProvider: "opencode",
          summaryModel: "openai/gpt-4o",
        },
      });

      await store.updateConnectionSummaryProvider(
        "conn-opencode-summary",
        "opencode",
        capabilityStore.getDefaultModel("opencode")!,
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            connectionId: "conn-opencode-summary",
            summaryProvider: "opencode",
            summaryModel: "openai/gpt-4o",
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
      expect(store.connections[0]?.summaryModel).toBe(DEFAULT_SUMMARY_MODEL);
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

  describe("updateConnectionBranchSettings", () => {
    it("Codex source Pod 切換 branch 時 payload 應自動補 Codex provider/model", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      const capabilityStore = useProviderCapabilityStore();

      capabilityStore.syncFromPayload([
        {
          name: "codex",
          availableModels: [{ value: "gpt-5.4", label: "GPT-5.4" }],
        },
      ]);

      podStore.pods = [
        createMockPod({
          id: "pod-codex-source",
          provider: "codex",
          providerConfig: { model: "gpt-5.4" },
        }),
      ];
      const conn = createMockConnection({
        id: "conn-codex-branch-settings",
        sourcePodId: "pod-codex-source",
        triggerMode: "auto",
      });
      store.connections = [conn];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          triggerMode: "branch",
          label: "CodexPath",
          description: "走 Codex",
          branchProvider: "codex",
          branchModel: "gpt-5.4",
        },
      });

      const result = await store.updateConnectionBranchSettings(
        "conn-codex-branch-settings",
        "pod-codex-source",
        {
          switchToBranch: true,
          label: "CodexPath",
          description: "走 Codex",
        },
      );

      expect(result?.branchProvider).toBe("codex");
      expect(result?.branchModel).toBe("gpt-5.4");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-codex-branch-settings",
            triggerMode: "branch",
            label: "CodexPath",
            description: "走 Codex",
            branchProvider: "codex",
            branchModel: "gpt-5.4",
          }),
        }),
      );
    });

    it("OpenCode source Pod 切換 branch 時 payload 應沿用 Pod 目前 model", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-opencode-source",
          provider: "opencode",
          providerConfig: { model: "openai/gpt-4o" },
        }),
      ];
      const conn = createMockConnection({
        id: "conn-opencode-branch-settings",
        sourcePodId: "pod-opencode-source",
        triggerMode: "auto",
      });
      store.connections = [conn];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          triggerMode: "branch",
          label: "OpenCodePath",
          description: "走 OpenCode",
          branchProvider: "opencode",
          branchModel: "openai/gpt-4o",
        },
      });

      const result = await store.updateConnectionBranchSettings(
        "conn-opencode-branch-settings",
        "pod-opencode-source",
        {
          switchToBranch: true,
          label: "OpenCodePath",
          description: "走 OpenCode",
        },
      );

      expect(result?.branchProvider).toBe("opencode");
      expect(result?.branchModel).toBe("openai/gpt-4o");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-opencode-branch-settings",
            triggerMode: "branch",
            branchProvider: "opencode",
            branchModel: "openai/gpt-4o",
          }),
        }),
      );
    });

    it("OpenCode source Pod 沒有可用 model 時應回傳 null 且不送 websocket request", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      const aliasStore = useOpencodeAliasStore();
      aliasStore.setAliases([]);

      podStore.pods = [
        createMockPod({
          id: "pod-opencode-no-model",
          provider: "opencode",
          providerConfig: { model: "" },
        }),
      ];
      const conn = createMockConnection({
        id: "conn-opencode-no-model",
        sourcePodId: "pod-opencode-no-model",
        triggerMode: "auto",
      });
      store.connections = [conn];

      const result = await store.updateConnectionBranchSettings(
        "conn-opencode-no-model",
        "pod-opencode-no-model",
        {
          switchToBranch: true,
          label: "NoModelPath",
          description: "",
        },
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
        }),
      );
    });

    it("Codex capability 缺 default model 時不應 fallback 成 sonnet 並送出更新", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();
      const capabilityStore = useProviderCapabilityStore();

      capabilityStore.syncFromPayload([
        {
          name: "codex",
          availableModels: [],
        },
      ]);
      podStore.pods = [
        createMockPod({
          id: "pod-codex-no-default",
          provider: "codex",
          providerConfig: { model: "" },
        }),
      ];
      const conn = createMockConnection({
        id: "conn-codex-no-default",
        sourcePodId: "pod-codex-no-default",
        triggerMode: "auto",
      });
      store.connections = [conn];

      const result = await store.updateConnectionBranchSettings(
        "conn-codex-no-default",
        "pod-codex-no-default",
        {
          switchToBranch: true,
          label: "CodexNoDefault",
          description: "",
        },
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });
  });

  describe("Branch OpenCode provider/model wire-up", () => {
    function seedOpencodeAliases(): void {
      const aliasStore = useOpencodeAliasStore();
      aliasStore.setAliases([
        {
          id: "alias-1",
          providerID: "openai",
          modelID: "gpt-4o",
          alias: "GPT-4o",
          orderIdx: 0,
        },
        {
          id: "alias-2",
          providerID: "anthropic",
          modelID: "claude-opus-4-5",
          alias: "Claude Opus",
          orderIdx: 1,
        },
      ]);
    }

    it("Branch Provider 切換到 OpenCode 時送出的 provider/model payload 使用第一筆 alias", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const capabilityStore = useProviderCapabilityStore();
      seedOpencodeAliases();

      const conn = createMockConnection({
        id: "conn-opencode-provider",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "claude",
        branchModel: "sonnet",
      });
      store.connections = [conn];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          branchProvider: "opencode",
          branchModel: "openai/gpt-4o",
        },
      });

      await store.updateConnectionBranchProvider(
        "conn-opencode-provider",
        "opencode",
        capabilityStore.getDefaultModel("opencode")!,
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-opencode-provider",
            branchProvider: "opencode",
            branchModel: "openai/gpt-4o",
          }),
        }),
      );
    });

    it("Branch Provider 更新時應只送一次請求並套用後端原子同步的 siblings", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      seedOpencodeAliases();

      const conn1 = createMockConnection({
        id: "conn-provider-target",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "claude",
        branchModel: "sonnet",
      });
      const conn2 = createMockConnection({
        id: "conn-provider-sibling",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "claude",
        branchModel: "sonnet",
      });
      store.connections = [conn1, conn2];
      const updatedConn1 = {
        ...conn1,
        branchProvider: "opencode" as const,
        branchModel: "openai/gpt-4o",
      };
      const updatedConn2 = {
        ...conn2,
        branchProvider: "opencode" as const,
        branchModel: "openai/gpt-4o",
      };
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: updatedConn1,
        connections: [updatedConn1, updatedConn2],
      });

      const result = await store.updateConnectionBranchProvider(
        "conn-provider-target",
        "opencode",
        "openai/gpt-4o",
      );

      expect(result?.branchProvider).toBe("opencode");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1);
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
        }),
      );
      expect(store.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "conn-provider-target",
            branchProvider: "opencode",
            branchModel: "openai/gpt-4o",
          }),
          expect.objectContaining({
            id: "conn-provider-sibling",
            branchProvider: "opencode",
            branchModel: "openai/gpt-4o",
          }),
        ]),
      );
    });

    it("Branch Model 選擇 OpenCode alias 時送出的 model value 維持 providerID/modelID 格式", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      seedOpencodeAliases();

      const conn = createMockConnection({
        id: "conn-opencode-model",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "opencode",
        branchModel: "openai/gpt-4o",
      });
      store.connections = [conn];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          branchModel: "anthropic/claude-opus-4-5",
        },
      });

      await store.updateConnectionBranchModel(
        "conn-opencode-model",
        "anthropic/claude-opus-4-5",
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-opencode-model",
            branchModel: "anthropic/claude-opus-4-5",
          }),
        }),
      );
    });

    it("Branch Model 更新時應只送一次請求並套用後端原子同步的 siblings", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn1 = createMockConnection({
        id: "conn-model-target",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "opencode",
        branchModel: "openai/gpt-4o",
      });
      const conn2 = createMockConnection({
        id: "conn-model-sibling",
        sourcePodId: "pod-src",
        triggerMode: "branch",
        branchProvider: "opencode",
        branchModel: "openai/gpt-4o",
      });
      store.connections = [conn1, conn2];
      const updatedConn1 = {
        ...conn1,
        branchModel: "anthropic/claude-opus-4-5",
      };
      const updatedConn2 = {
        ...conn2,
        branchModel: "anthropic/claude-opus-4-5",
      };
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: updatedConn1,
        connections: [updatedConn1, updatedConn2],
      });

      const result = await store.updateConnectionBranchModel(
        "conn-model-target",
        "anthropic/claude-opus-4-5",
      );

      expect(result?.branchModel).toBe("anthropic/claude-opus-4-5");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1);
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
        }),
      );
      expect(store.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "conn-model-target",
            branchModel: "anthropic/claude-opus-4-5",
          }),
          expect.objectContaining({
            id: "conn-model-sibling",
            branchModel: "anthropic/claude-opus-4-5",
          }),
        ]),
      );
    });
  });

  describe("updateConnectionBranchLabel", () => {
    it("wire-up smoke：呼叫後 mock websocketClient 收到帶 label 的 connection:update 請求", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

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

    it("同 source Pod 已有 label=Checklist 的 branch → 不發 WS 且 toast 帶 branchLabelDuplicate", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

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

      const result = await store.updateConnectionBranchLabel(
        "conn-2",
        "Checklist",
      );

      expect(result).toBeNull();
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
        }),
      );
    });

    it("label=None → 不發 WS 且 toast 帶 branchLabelReserved 錯誤", async () => {
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

    it("label 為空字串 → 不發 WS 且 toast 帶 branchLabelEmpty 錯誤", async () => {
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

    it("label 長度超過上限 → 不發 WS 且 toast 帶 branchLabelTooLong 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-long",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      const tooLongLabel = "a".repeat(BRANCH_LABEL_MAX_LENGTH + 1);
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

  describe("updateConnectionBranchDescription", () => {
    it("description 長度超過上限 → 不發 WS 且 toast 帶 branchDescriptionTooLong 錯誤", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-desc-long",
        sourcePodId: "pod-src",
        triggerMode: "branch",
      });
      store.connections = [conn];

      const tooLongDescription = "b".repeat(BRANCH_DESCRIPTION_MAX_LENGTH + 1);
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
