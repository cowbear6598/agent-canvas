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
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import type { Connection, TriggerMode } from "@/types/connection";
import {
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_LABEL_MAX_LENGTH,
} from "@/types/connection";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";

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
              value: "gpt-5.5",
              label: "GPT-5.5",
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
        providerConfig: { model: "gpt-5.5" },
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

      expect(result?.summaryModel).toBe("gpt-5.5");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            summaryProvider: "codex",
            summaryModel: "gpt-5.5",
          }),
        }),
      );
    });

    it("建立 connection 時會帶入 source Pod 的 thinking level 作為 summary 預設值", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-codex",
          provider: "codex",
          providerConfig: {
            model: "gpt-5.5",
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
            model: "gpt-5.5",
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

  });

  describe("updateConnectionRouting", () => {
    it("應以單一 connection:update 保存線型與位移量", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-routing";
      const store = useConnectionStore();
      const existing = createMockConnection({ id: "conn-routing" });
      store.connections = [existing];
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...existing,
          routingMode: "orthogonal",
          routingOffset: -140,
          routingPoints: [{ x: 240, y: -80 }],
        },
      });

      const result = await store.updateConnectionRouting("conn-routing", {
        routingMode: "orthogonal",
        routingOffset: -140,
        routingPoints: [{ x: 240, y: -80 }],
      });

      expect(result).toMatchObject({
        routingMode: "orthogonal",
        routingOffset: -140,
        routingPoints: [{ x: 240, y: -80 }],
      });
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          responseEvent: "connection:updated",
          payload: expect.objectContaining({
            canvasId: "canvas-routing",
            connectionId: "conn-routing",
            routingMode: "orthogonal",
            routingOffset: -140,
            routingPoints: [{ x: 240, y: -80 }],
          }),
        }),
      );
    });
  });

  describe("loadConnectionsFromBackend", () => {
    it("成功時應設定 connections 與 triggerMode 預設值", async () => {
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
          },
          {
            id: "conn-2",
            sourcePodId: "pod-b",
            sourceAnchor: "bottom",
            targetPodId: "pod-c",
            targetAnchor: "top",
          },
        ],
      });

      await store.loadConnectionsFromBackend();

      expect(store.connections).toHaveLength(2);
      expect(store.connections[0]).toMatchObject({
        id: "conn-1",
        triggerMode: "auto",
      });
      expect(store.connections[1]).toMatchObject({
        id: "conn-2",
        triggerMode: "auto", // 預設
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
            { value: "gpt-5.5", label: "GPT-5.5" },
            { value: "gpt-5.5", label: "GPT-5.5" },
          ],
        },
      ]);
    }

    it("Claude → Codex 切換時，原本是 sonnet 的 connection 應被更新為 gpt-5.5", async () => {
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
          summaryModel: "gpt-5.5",
        },
      });

      await store.reconcileSummaryModelsForPod("pod-src");

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            connectionId: "conn-1",
            summaryModel: "gpt-5.5",
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

    it("follow-source 的 connection 收斂 summaryModel 時不應把 summaryProvider 寫死", async () => {
      const store = useConnectionStore();
      const podStore = usePodStore();
      setupCapabilities();

      const pod = createMockPod({ id: "pod-src", provider: "codex" });
      podStore.pods = [pod];

      const conn = createMockConnection({
        id: "conn-follow-source",
        sourcePodId: "pod-src",
        targetPodId: "pod-dst",
        summaryProvider: undefined,
        summaryModel: "sonnet",
      });
      store.connections = [conn];

      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-follow-source",
          sourcePodId: "pod-src",
          sourceAnchor: "bottom",
          targetPodId: "pod-dst",
          targetAnchor: "top",
          summaryModel: "gpt-5.5",
        },
      });

      await store.reconcileSummaryModelsForPod("pod-src");

      const payload = mockCreateWebSocketRequest.mock.calls[0]?.[0]?.payload;
      expect(payload).toMatchObject({
        connectionId: "conn-follow-source",
        summaryModel: "gpt-5.5",
        canvasId: "canvas-1",
      });
      expect(payload).not.toHaveProperty("summaryProvider");
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
          summaryModel: "gpt-5.5",
        },
      });

      const result = await store.updateConnectionSummaryProvider(
        "conn-1",
        "codex",
        "gpt-5.5",
      );

      expect(result?.summaryProvider).toBe("codex");
      expect(result?.summaryModel).toBe("gpt-5.5");
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
        summaryModel: "gpt-5.5",
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

      expect(store.connections[0]?.summaryProvider).toBe("codex");
    });

    it("broadcast 不帶 summaryProvider 欄位時應保留既有值", () => {
      const store = useConnectionStore();
      const existingConn = createMockConnection({
        id: "conn-1",
        summaryProvider: "codex",
        summaryModel: "gpt-5.5",
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
        summaryModel: "gpt-5.5",
      });

      expect(store.connections[0]?.summaryModel).toBe("gpt-5.5");
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
    it("Codex source Pod 切換 branch 時 payload 只送 branch 基本設定", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useConnectionStore();
      const podStore = usePodStore();

      podStore.pods = [
        createMockPod({
          id: "pod-codex-source",
          provider: "codex",
          providerConfig: { model: "gpt-5.5" },
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

      expect(result?.triggerMode).toBe("branch");
      expect(result?.label).toBe("CodexPath");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-codex-branch-settings",
            triggerMode: "branch",
            label: "CodexPath",
            description: "走 Codex",
          }),
        }),
      );
    });

    it("OpenCode source Pod 切換 branch 時 payload 不再送 branch provider/model", async () => {
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

      expect(result?.triggerMode).toBe("branch");
      expect(result?.label).toBe("OpenCodePath");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "connection:update",
          payload: expect.objectContaining({
            connectionId: "conn-opencode-branch-settings",
            triggerMode: "branch",
          }),
        }),
      );
    });

    it("OpenCode source Pod 沒有可用 model 時仍可切換 branch，因為不再依賴 branch model", async () => {
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
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          triggerMode: "branch",
          label: "NoModelPath",
          description: "",
        },
      });

      const result = await store.updateConnectionBranchSettings(
        "conn-opencode-no-model",
        "pod-opencode-no-model",
        {
          switchToBranch: true,
          label: "NoModelPath",
          description: "",
        },
      );

      expect(result?.triggerMode).toBe("branch");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1);
    });

    it("Codex capability 缺 default model 時仍可切換 branch，因為 branch settings 不再依賴 provider/model", async () => {
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
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...conn,
          triggerMode: "branch",
          label: "CodexNoDefault",
          description: "",
        },
      });

      const result = await store.updateConnectionBranchSettings(
        "conn-codex-no-default",
        "pod-codex-no-default",
        {
          switchToBranch: true,
          label: "CodexNoDefault",
          description: "",
        },
      );

      expect(result?.triggerMode).toBe("branch");
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(1);
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
