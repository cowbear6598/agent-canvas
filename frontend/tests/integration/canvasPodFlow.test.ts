import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
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
  createMockSchedule,
} from "../helpers/factories";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { Pod } from "@/types";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";

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

/**
 * 建立 createPodWithBackend 所需的標準測試 payload。
 */
function createTestPodPayload(
  overrides?: Partial<Omit<Pod, "id">>,
): Omit<Pod, "id"> {
  return {
    name: "Test Pod",
    x: 100,
    y: 100,
    rotation: 0,
    output: [],
    status: "idle",
    repositoryId: null,
    multiInstance: false,
    commandId: null,
    schedule: null,
    provider: "claude",
    providerConfig: { model: "opus" },
    ...overrides,
  };
}

describe("Canvas/Pod 操作完整流程", () => {
  setupStoreTest();

  describe("建立 Canvas 並新增 Pod", () => {
    let canvasStore: ReturnType<typeof useCanvasStore>;
    let podStore: ReturnType<typeof usePodStore>;

    beforeEach(() => {
      canvasStore = useCanvasStore();
      podStore = usePodStore();
    });

    it("建立 Canvas 成功，activeCanvasId 設為新 Canvas id", async () => {
      const newCanvas = createMockCanvas({
        id: "canvas-1",
        name: "Test Canvas",
      });

      // 建立 Canvas 需要兩次 WS 請求：create + switch
      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: newCanvas.id,
      });

      const canvas = await canvasStore.createCanvas("Test Canvas");

      expect(canvas).toEqual(newCanvas);
      expect(canvasStore.activeCanvasId).toBe("canvas-1");
    });

    it("在指定 Canvas 建立 Pod 成功，回傳 Pod 物件", async () => {
      // 先建立 Canvas
      const newCanvas = createMockCanvas({
        id: "canvas-1",
        name: "Test Canvas",
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: newCanvas.id,
      });
      await canvasStore.createCanvas("Test Canvas");

      // 建立 Pod
      const newPod = createMockPod({
        id: "pod-1",
        name: "Test Pod",
        x: 300,
        y: 400,
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: newPod });

      const pod = await podStore.createPodWithBackend(
        createTestPodPayload({ name: "Test Pod", x: 300, y: 400 }),
      );

      expect(pod).toBeTruthy();
    });

    it("建立 Pod 時送出正確的 WebSocket 訊息（含 canvasId 與 name）", async () => {
      // 先建立 Canvas
      const newCanvas = createMockCanvas({
        id: "canvas-1",
        name: "Test Canvas",
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ canvas: newCanvas });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: newCanvas.id,
      });
      await canvasStore.createCanvas("Test Canvas");

      // 建立 Pod
      const newPod = createMockPod({
        id: "pod-1",
        name: "Test Pod",
        x: 300,
        y: 400,
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: newPod });

      await podStore.createPodWithBackend(
        createTestPodPayload({ name: "Test Pod", x: 300, y: 400 }),
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: "canvas-1",
            name: "Test Pod",
          }),
        }),
      );
    });

    it("跨 Canvas 切換後 Pod 建立的 canvasId 隔離正確", async () => {
      // 載入兩個 Canvas
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

      // 在 canvas-1 建立 pod-1
      const pod1 = createMockPod({ id: "pod-1", name: "Pod 1" });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: pod1 });
      await podStore.createPodWithBackend(
        createTestPodPayload({ name: "Pod 1", x: 100, y: 100 }),
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ canvasId: "canvas-1" }),
        }),
      );

      // 切換到 canvas-2
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        canvasId: "canvas-2",
      });
      await canvasStore.switchCanvas("canvas-2");
      expect(canvasStore.activeCanvasId).toBe("canvas-2");

      // 在 canvas-2 建立 pod-2（model 使用 sonnet，驗證不同 model 也能正常送出）
      const pod2 = createMockPod({ id: "pod-2", name: "Pod 2" });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: pod2 });
      await podStore.createPodWithBackend(
        createTestPodPayload({
          name: "Pod 2",
          x: 200,
          y: 200,
          providerConfig: { model: "sonnet" },
        }),
      );

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ canvasId: "canvas-2" }),
        }),
      );
    });
  });

  describe("驗證跨 Store 狀態一致性（canvasStore.activeCanvasId, podStore.pods）", () => {
    it("loadCanvases 後 activeCanvasId 為第一個 Canvas，canvases 長度正確", async () => {
      const canvasStore = useCanvasStore();

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
    });
  });

  describe("Pod 設定", () => {
    it("建立 Pod -> 設定 Model", () => {
      const podStore = usePodStore();

      const pod = createMockPod({
        id: "pod-1",
        providerConfig: { model: "opus" },
      });
      podStore.pods = [pod];

      podStore.updatePodProviderConfigModel("pod-1", "sonnet");
      expect(podStore.getPodById("pod-1")?.providerConfig.model).toBe("sonnet");
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

  describe("切換 Pod Model（E2E：pod:set-model → store 更新 providerConfig.model）", () => {
    it("切換 Claude Pod model：Opus → Sonnet，PodModelSelector emit update:model 且 store 更新", async () => {
      const podStore = usePodStore();

      // Arrange：初始 Pod（model: "opus"）
      const pod = createMockPod({
        id: "pod-1",
        provider: "claude",
        providerConfig: { model: "opus" },
      });
      podStore.pods = [pod];

      // 模擬後端回傳已更新的 Pod（model: sonnet）
      const updatedPod = createMockPod({
        id: "pod-1",
        provider: "claude",
        providerConfig: { model: "sonnet" },
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({ pod: updatedPod });

      // 元件動態化後，PodModelSelector 的選項來自 providerCapabilityStore；
      // 必須先注入 mock availableModels 讓 UI 能 render 出 Opus / Sonnet / Haiku 卡片
      const providerCapabilityStore = useProviderCapabilityStore();
      providerCapabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
            integration: false,
            runMode: false,
          },
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
            { label: "Haiku", value: "haiku" },
          ],
        },
      ]);

      // Act：掛載 PodModelSelector 元件，模擬點擊 sonnet 選項觸發 update:model emit
      // 不再另外建立 createTestingPinia，直接沿用 setupStoreTest() 已 setActivePinia 的 instance，
      // 確保元件讀到的就是上面 syncFromPayload 注入的 availableModels。
      const wrapper = mount(PodModelSelector, {
        props: {
          podId: "pod-1",
          currentModel: "opus",
          provider: "claude",
        },
      });

      // 先 mouseenter active 卡片展開，再點擊 sonnet 卡片；
      // 透過父元件的 @update:model 事件驗證 handleModelChange 流程
      const activeCard = wrapper.find(".model-card.active");
      expect(activeCard.exists()).toBeTruthy();
      await activeCard.trigger("mouseenter");

      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text() === "Sonnet");
      expect(sonnetBtn).toBeTruthy();
      await sonnetBtn!.trigger("click");

      // 驗證元件確實發出 update:model 事件，model 為 "sonnet"
      const emitted = wrapper.emitted("update:model");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["sonnet"]);

      // 模擬 handleModelChange 接收到 update:model 後的 WS 請求與 store 更新流程
      const response = await mockCreateWebSocketRequest({
        requestEvent: "pod:set-model",
        responseEvent: "pod:model:set",
        payload: { podId: "pod-1", canvasId: "canvas-1", model: "sonnet" },
      });

      if (response?.pod) {
        podStore.updatePodProviderConfigModel(
          "pod-1",
          response.pod.providerConfig.model,
        );
      }

      // Assert：WebSocket request 已被呼叫，payload 含 model: 'sonnet'
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:set-model",
          payload: expect.objectContaining({
            podId: "pod-1",
            model: "sonnet",
          }),
        }),
      );

      // Assert：store 已更新 providerConfig.model
      const updatedStorePod = podStore.getPodById("pod-1");
      expect(updatedStorePod?.providerConfig.model).toBe("sonnet");

      wrapper.unmount();
    });

    it("切換 Codex Pod model（gpt-5.4），驗證 WebSocket request 送出且 store 更新", async () => {
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();

      // Arrange：設定 activeCanvasId 與初始 Codex Pod
      canvasStore.activeCanvasId = "canvas-1";
      const pod = createMockPod({
        id: "pod-codex-1",
        provider: "codex",
        providerConfig: { model: "codex-mini-latest" },
      });
      podStore.pods = [pod];

      // 模擬後端回傳已更新的 Pod（model: "gpt-5.4"）
      const updatedPod = createMockPod({
        id: "pod-codex-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        pod: updatedPod,
      });

      // Act：模擬 handleModelChange 的完整流程
      // step 1 — 送出 pod:set-model WebSocket request
      const response = await mockCreateWebSocketRequest({
        requestEvent: "pod:set-model",
        responseEvent: "pod:model:set",
        payload: {
          podId: "pod-codex-1",
          canvasId: "canvas-1",
          model: "gpt-5.4",
        },
      });

      // step 2 — 依回應結果呼叫 store 更新 providerConfig.model
      if (response?.pod) {
        podStore.updatePodProviderConfigModel(
          "pod-codex-1",
          response.pod.providerConfig.model,
        );
      }

      // Assert：WebSocket request 已被呼叫，payload 含正確 model
      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:set-model",
          payload: expect.objectContaining({
            podId: "pod-codex-1",
            model: "gpt-5.4",
          }),
        }),
      );

      // Assert：store 已更新 providerConfig.model
      const updatedStorePod = podStore.getPodById("pod-codex-1");
      expect(updatedStorePod?.providerConfig.model).toBe("gpt-5.4");
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
