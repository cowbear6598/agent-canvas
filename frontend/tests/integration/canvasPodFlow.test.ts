import { describe, it, expect, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../helpers/mockWebSocket";
import {
  setupStoreTest,
  mockErrorSanitizerFactory,
} from "../helpers/testSetup";
import {
  createMockCanvas,
  createMockPod,
  createMockConnection,
  createMockNote,
  createMockSchedule,
} from "../helpers/factories";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Canvas, Pod, Connection } from "@/types";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const mockShowSuccessToast = vi.fn();
const mockShowErrorToast = vi.fn();
const mockToast = vi.fn();

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

// Mock sanitizeErrorForUser
vi.mock("@/utils/errorSanitizer", () => mockErrorSanitizerFactory());

describe("Canvas/Pod 操作完整流程", () => {
  setupStoreTest();

  describe("建立 Canvas 並新增 Pod", () => {
    it("建立 Canvas -> 建立 Pod -> Pod 加入到正確的 Canvas", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();

      const newCanvas = createMockCanvas({
        id: "canvas-1",
        name: "Test Canvas",
      });
      const newPod = createMockPod({
        id: "pod-1",
        name: "Test Pod",
        x: 300,
        y: 400,
      });

      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: newCanvas.id,
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: newPod });

      const canvas = await canvasStore.createCanvas("Test Canvas");

      expect(canvas).toEqual(newCanvas);
      expect(canvasStore.activeCanvasId).toBe("canvas-1");

      const pod = await podStore.createPodWithBackend({
        name: "Test Pod",
        x: 300,
        y: 400,
        rotation: 0,
        output: [],
        status: "idle",
        model: "opus",
        outputStyleId: null,
        skillIds: [],
        subAgentIds: [],
        repositoryId: null,
        multiInstance: false,
        commandId: null,
        schedule: null,
      });

      expect(pod).toBeTruthy();
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            name: "Test Pod",
          }),
        }),
      );
    });

    it("驗證跨 Store 狀態一致性（canvasStore.activeCanvasId, podStore.pods）", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();

      // Arrange
      const canvas1 = createMockCanvas({ id: "canvas-1", name: "Canvas 1" });
      const canvas2 = createMockCanvas({ id: "canvas-2", name: "Canvas 2" });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        canvases: [canvas1, canvas2],
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: canvas1.id,
      });

      await canvasStore.loadCanvases();

      expect(canvasStore.activeCanvasId).toBe("canvas-1");
      expect(canvasStore.canvases).toHaveLength(2);

      const pod1 = createMockPod({ id: "pod-1", name: "Pod 1" });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: pod1 });

      await podStore.createPodWithBackend({
        name: "Pod 1",
        x: 100,
        y: 100,
        rotation: 0,
        output: [],
        status: "idle",
        model: "opus",
        outputStyleId: null,
        skillIds: [],
        subAgentIds: [],
        repositoryId: null,
        multiInstance: false,
        commandId: null,
        schedule: null,
      });

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: "canvas-1",
          }),
        }),
      );

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: "canvas-2",
      });
      await canvasStore.switchCanvas("canvas-2");

      expect(canvasStore.activeCanvasId).toBe("canvas-2");

      const pod2 = createMockPod({ id: "pod-2", name: "Pod 2" });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: pod2 });

      await podStore.createPodWithBackend({
        name: "Pod 2",
        x: 200,
        y: 200,
        rotation: 0,
        output: [],
        status: "idle",
        model: "sonnet",
        outputStyleId: null,
        skillIds: [],
        subAgentIds: [],
        repositoryId: null,
        multiInstance: false,
        commandId: null,
        schedule: null,
      });

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: "canvas-2",
          }),
        }),
      );
    });
  });

  describe("Pod 設定與 Note 綁定", () => {
    it("建立 Pod -> 設定 Model -> 綁定 OutputStyle Note", () => {
      const podStore = usePodStore();

      const pod = createMockPod({
        id: "pod-1",
        model: "opus",
        outputStyleId: null,
      });
      podStore.pods = [pod];

      podStore.updatePodModel("pod-1", "sonnet");
      expect(podStore.getPodById("pod-1")?.model).toBe("sonnet");

      podStore.updatePodOutputStyle("pod-1", "output-style-1");
      expect(podStore.getPodById("pod-1")?.outputStyleId).toBe(
        "output-style-1",
      );
    });

    it("驗證 Pod 的 outputStyleId 更新", () => {
      const podStore = usePodStore();

      const pod = createMockPod({ id: "pod-1", outputStyleId: null });
      podStore.pods = [pod];

      podStore.updatePodOutputStyle("pod-1", "style-123");

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.outputStyleId).toBe("style-123");
    });

    it("驗證清除 outputStyleId", () => {
      const podStore = usePodStore();

      const pod = createMockPod({ id: "pod-1", outputStyleId: "style-123" });
      podStore.pods = [pod];

      podStore.updatePodOutputStyle("pod-1", null);

      expect(podStore.getPodById("pod-1")?.outputStyleId).toBeNull();
    });
  });

  describe("建立連接並觸發工作流", () => {
    it("建立 2 個 Pod -> 建立 Connection -> 模擬 Auto Trigger", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();
      const connectionStore = useConnectionStore();

      canvasStore.activeCanvasId = "canvas-1";

      const pod1 = createMockPod({ id: "pod-1", name: "Pod 1" });
      const pod2 = createMockPod({ id: "pod-2", name: "Pod 2" });
      podStore.pods = [pod1, pod2];

      const newConnection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
        triggerMode: "auto",
        status: "idle",
      });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        connection: {
          ...newConnection,
        },
      });

      const connection = await connectionStore.createConnection(
        "pod-1",
        "bottom",
        "pod-2",
        "top",
      );

      expect(connection).toBeTruthy();
      expect(connection?.sourcePodId).toBe("pod-1");
      expect(connection?.targetPodId).toBe("pod-2");
      expect(connection?.triggerMode).toBe("auto");
      expect(connection?.status).toBe("idle");

      connectionStore.addConnectionFromEvent({
        ...newConnection,
      });
      connectionStore.getWorkflowHandlers().handleWorkflowAutoTriggered({
        connectionId: "conn-1",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
        transferredContent: "test content",
        isSummarized: false,
      });

      const activeConnection = connectionStore.connections.find(
        (c) => c.id === "conn-1",
      );
      expect(activeConnection?.status).toBe("active");

      connectionStore.getWorkflowHandlers().handleWorkflowComplete({
        requestId: "req-1",
        connectionId: "conn-1",
        targetPodId: "pod-2",
        success: true,
        triggerMode: "auto",
      });

      // Assert - Connection 狀態從 active -> idle
      const idleConnection = connectionStore.connections.find(
        (c) => c.id === "conn-1",
      );
      expect(idleConnection?.status).toBe("idle");
    });

    it("驗證 Connection 狀態從 idle -> active -> idle", () => {
      const connectionStore = useConnectionStore();

      // Arrange
      const conn = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "auto",
        status: "idle",
      });
      connectionStore.connections = [conn];

      expect(connectionStore.connections[0]?.status).toBe("idle");

      connectionStore.getWorkflowHandlers().handleWorkflowAutoTriggered({
        connectionId: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        transferredContent: "content",
        isSummarized: false,
      });

      expect(connectionStore.connections[0]?.status).toBe("active");

      connectionStore.getWorkflowHandlers().handleWorkflowComplete({
        requestId: "req-1",
        connectionId: "conn-1",
        targetPodId: "pod-b",
        success: true,
        triggerMode: "auto",
      });

      expect(connectionStore.connections[0]?.status).toBe("idle");
    });

    it("驗證 AI Decide 流程：idle -> ai-deciding -> ai-approved", () => {
      const connectionStore = useConnectionStore();

      const conn = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "ai-decide",
        status: "idle",
      });
      connectionStore.connections = [conn];

      expect(connectionStore.connections[0]?.status).toBe("idle");

      connectionStore.getWorkflowHandlers().handleAiDecidePending({
        canvasId: "canvas-1",
        connectionIds: ["conn-1"],
        sourcePodId: "pod-a",
      });

      expect(connectionStore.connections[0]?.status).toBe("ai-deciding");
      expect(connectionStore.connections[0]?.decideReason).toBeUndefined();

      connectionStore.getWorkflowHandlers().handleAiDecideResult({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        shouldTrigger: true,
        reason: "approved",
      });

      expect(connectionStore.connections[0]?.status).toBe("ai-approved");
      expect(connectionStore.connections[0]?.decideReason).toBeUndefined();
    });

    it("驗證 AI Decide 流程：idle -> ai-deciding -> ai-rejected", () => {
      const connectionStore = useConnectionStore();

      // Arrange
      const conn = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        triggerMode: "ai-decide",
        status: "idle",
      });
      connectionStore.connections = [conn];

      connectionStore.getWorkflowHandlers().handleAiDecidePending({
        canvasId: "canvas-1",
        connectionIds: ["conn-1"],
        sourcePodId: "pod-a",
      });

      expect(connectionStore.connections[0]?.status).toBe("ai-deciding");

      connectionStore.getWorkflowHandlers().handleAiDecideResult({
        canvasId: "canvas-1",
        connectionId: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        shouldTrigger: false,
        reason: "not relevant",
      });

      expect(connectionStore.connections[0]?.status).toBe("ai-rejected");
      expect(connectionStore.connections[0]?.decideReason).toBe("not relevant");

      connectionStore.getWorkflowHandlers().handleAiDecideClear({
        canvasId: "canvas-1",
        connectionIds: ["conn-1"],
      });

      expect(connectionStore.connections[0]?.status).toBe("idle");
      expect(connectionStore.connections[0]?.decideReason).toBeUndefined();
    });
  });

  describe("排程觸發", () => {
    it("設定排程 -> 模擬 SCHEDULE_FIRED 事件 -> 驗證動畫狀態", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();

      canvasStore.activeCanvasId = "canvas-1";

      const pod = createMockPod({ id: "pod-1", schedule: null });
      podStore.pods = [pod];

      const schedule = createMockSchedule({ enabled: true });
      const updatedPod = createMockPod({ id: "pod-1", schedule });

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        pod: updatedPod,
      });

      const result = await podStore.setScheduleWithBackend("pod-1", schedule);

      expect(result).toBeTruthy();
      expect(result?.schedule).toEqual(schedule);
      expect(mockShowSuccessToast).toHaveBeenCalledWith("Schedule", "更新成功");

      podStore.triggerScheduleFiredAnimation("pod-1");

      expect(podStore.isScheduleFiredAnimating("pod-1")).toBe(true);

      podStore.clearScheduleFiredAnimation("pod-1");

      expect(podStore.isScheduleFiredAnimating("pod-1")).toBe(false);
    });

    it("驗證多個 Pod 的排程動畫狀態互不影響", () => {
      const podStore = usePodStore();

      const pod1 = createMockPod({ id: "pod-1" });
      const pod2 = createMockPod({ id: "pod-2" });
      podStore.pods = [pod1, pod2];

      podStore.triggerScheduleFiredAnimation("pod-1");

      expect(podStore.isScheduleFiredAnimating("pod-1")).toBe(true);
      expect(podStore.isScheduleFiredAnimating("pod-2")).toBe(false);

      podStore.triggerScheduleFiredAnimation("pod-2");

      expect(podStore.isScheduleFiredAnimating("pod-1")).toBe(true);
      expect(podStore.isScheduleFiredAnimating("pod-2")).toBe(true);

      podStore.clearScheduleFiredAnimation("pod-1");

      expect(podStore.isScheduleFiredAnimating("pod-1")).toBe(false);
      expect(podStore.isScheduleFiredAnimating("pod-2")).toBe(true);
    });

    it("清除排程時應顯示清除成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();

      // Arrange
      canvasStore.activeCanvasId = "canvas-1";

      const schedule = createMockSchedule();
      const pod = createMockPod({ id: "pod-1", schedule });
      podStore.pods = [pod];

      const updatedPod = createMockPod({ id: "pod-1", schedule: null });

      // Mock POD_SET_SCHEDULE (清除)
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        pod: updatedPod,
      });

      // Act - 清除排程
      const result = await podStore.setScheduleWithBackend("pod-1", null);

      // Assert
      expect(result).toBeTruthy();
      expect(result?.schedule).toBeNull();
      expect(mockShowSuccessToast).toHaveBeenCalledWith("Schedule", "刪除成功");
    });
  });
});
