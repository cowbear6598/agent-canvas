import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia } from "pinia";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
  mockWebSocketClient,
} from "../helpers/mockWebSocket";
import {
  setupStoreTest,
  mockErrorSanitizerFactory,
} from "../helpers/testSetup";
import { setupTestPinia } from "../helpers/mockStoreFactory";
import {
  createMockCanvas,
  createMockPod,
  createMockSchedule,
} from "../helpers/factories";
import { usePodStore } from "@/stores/pod/podStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Pod, Schedule } from "@/types";
import { MAX_POD_NAME_LENGTH } from "@/lib/constants";
// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
const mockShowSuccessToast = vi.fn();
const mockShowErrorToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

// Mock sanitizeErrorForUser
vi.mock("@/utils/errorSanitizer", () => mockErrorSanitizerFactory());

// Mock useCanvasWebSocketAction
const mockExecuteAction = vi.fn();
vi.mock("@/composables/useCanvasWebSocketAction", () => ({
  useCanvasWebSocketAction: () => ({
    executeAction: mockExecuteAction,
  }),
}));

describe("podStore", () => {
  setupStoreTest(() => {
    mockExecuteAction.mockResolvedValue({ success: false, error: "未知錯誤" });
  });

  describe("初始狀態", () => {
    it("pods 應為空陣列", () => {
      const store = usePodStore();

      expect(store.pods).toEqual([]);
    });

    it("selectedPodId 應為 null", () => {
      const store = usePodStore();

      expect(store.selectedPodId).toBeNull();
    });

    it("activePodId 應為 null", () => {
      const store = usePodStore();

      expect(store.activePodId).toBeNull();
    });

    it("typeMenu.visible 應為 false", () => {
      const store = usePodStore();

      expect(store.typeMenu.visible).toBe(false);
    });

    it("typeMenu.position 應為 null", () => {
      const store = usePodStore();

      expect(store.typeMenu.position).toBeNull();
    });

    it("scheduleFiredPodIds 應為空 Set", () => {
      const store = usePodStore();

      expect(store.scheduleFiredPodIds).toBeInstanceOf(Set);
      expect(store.scheduleFiredPodIds.size).toBe(0);
    });
  });

  describe("getters", () => {
    describe("selectedPod", () => {
      it("有 selectedPodId 時應回傳對應 Pod", () => {
        const store = usePodStore();
        const pod1 = createMockPod({ id: "pod-1", name: "Pod 1" });
        const pod2 = createMockPod({ id: "pod-2", name: "Pod 2" });
        store.pods = [pod1, pod2];
        store.selectedPodId = "pod-2";

        const result = store.selectedPod;

        expect(result).toEqual(pod2);
      });

      it("無 selectedPodId 時應回傳 null", () => {
        const store = usePodStore();
        const pod = createMockPod();
        store.pods = [pod];
        store.selectedPodId = null;

        const result = store.selectedPod;

        expect(result).toBeNull();
      });

      it("selectedPodId 不存在於 pods 中時應回傳 null", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1" });
        store.pods = [pod];
        store.selectedPodId = "non-existent-id";

        const result = store.selectedPod;

        expect(result).toBeNull();
      });
    });

    describe("podCount", () => {
      it("應回傳 pods 陣列長度", () => {
        const store = usePodStore();
        store.pods = [createMockPod(), createMockPod(), createMockPod()];

        expect(store.podCount).toBe(3);
      });

      it("空陣列時應回傳 0", () => {
        const store = usePodStore();
        store.pods = [];

        expect(store.podCount).toBe(0);
      });
    });

    describe("getPodById", () => {
      it("找到時應回傳對應 Pod", () => {
        const store = usePodStore();
        const pod1 = createMockPod({ id: "pod-1" });
        const pod2 = createMockPod({ id: "pod-2" });
        store.pods = [pod1, pod2];

        const result = store.getPodById("pod-2");

        expect(result).toEqual(pod2);
      });

      it("找不到時應回傳 undefined", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1" });
        store.pods = [pod];

        const result = store.getPodById("non-existent");

        expect(result).toBeUndefined();
      });
    });

    describe("getNextPodName", () => {
      it('沒有 pods 時應回傳 "Pod 1"', () => {
        const store = usePodStore();
        store.pods = [];

        expect(store.getNextPodName()).toBe("Pod 1");
      });

      it('有 "Pod 1" 時應回傳 "Pod 2"', () => {
        const store = usePodStore();
        store.pods = [createMockPod({ name: "Pod 1" })];

        expect(store.getNextPodName()).toBe("Pod 2");
      });

      it('有 "Pod 1" 和 "Pod 2" 時應回傳 "Pod 3"', () => {
        const store = usePodStore();
        store.pods = [
          createMockPod({ name: "Pod 1" }),
          createMockPod({ name: "Pod 2" }),
        ];

        expect(store.getNextPodName()).toBe("Pod 3");
      });

      it('有 "Pod 1" 和 "Pod 3"（缺 Pod 2）時，應回傳最小可用數字 "Pod 2"', () => {
        const store = usePodStore();
        store.pods = [
          createMockPod({ name: "Pod 1" }),
          createMockPod({ name: "Pod 3" }),
        ];

        expect(store.getNextPodName()).toBe("Pod 2");
      });

      it('有 "Pod 2" 但沒有 "Pod 1" 時應回傳 "Pod 1"', () => {
        const store = usePodStore();
        store.pods = [createMockPod({ name: "Pod 2" })];

        expect(store.getNextPodName()).toBe("Pod 1");
      });
    });

    describe("isScheduleFiredAnimating", () => {
      it("podId 在 scheduleFiredPodIds 中時應回傳 true", () => {
        const store = usePodStore();
        store.scheduleFiredPodIds = new Set(["pod-1", "pod-2"]);

        expect(store.isScheduleFiredAnimating("pod-1")).toBe(true);
      });

      it("podId 不在 scheduleFiredPodIds 中時應回傳 false", () => {
        const store = usePodStore();
        store.scheduleFiredPodIds = new Set(["pod-1"]);

        expect(store.isScheduleFiredAnimating("pod-2")).toBe(false);
      });
    });
  });

  describe("isValidPod", () => {
    it("所有欄位合法時應回傳 true", () => {
      const store = usePodStore();
      const pod = createMockPod({
        id: "pod-1",
        name: "Valid Pod",
        x: 100,
        y: 200,
        rotation: 0.5,
        output: ["line1", "line2"],
      });

      expect(store.isValidPod(pod)).toBe(true);
    });

    it("名稱為空字串時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ name: "" });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("名稱僅包含空白時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ name: "   " });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("名稱超長時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ name: "a".repeat(MAX_POD_NAME_LENGTH + 1) });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("id 為空字串時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "" });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("id 僅包含空白時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "   " });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("x 為 NaN 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ x: NaN });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("y 為 Infinity 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ y: Infinity });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("rotation 為 -Infinity 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ rotation: -Infinity });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("output 非陣列時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: "not-an-array" as any });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("output 含非字串元素時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: ["valid", 123, "valid"] as any });

      expect(store.isValidPod(pod)).toBe(false);
    });
  });

  describe("isValidPod 邊界案例", () => {
    it("x 為 Infinity 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ x: Infinity });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("y 為 NaN 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ y: NaN });

      expect(store.isValidPod(pod)).toBe(false);
    });

    it("output 為 null 時應回傳 false", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: null as any });

      expect(store.isValidPod(pod)).toBe(false);
    });
  });

  describe("enrichPod", () => {
    it("缺少的欄位應填入預設值", () => {
      const store = usePodStore();
      const pod = {
        id: "pod-1",
        name: "Test Pod",
      } as Pod;

      const result = store.enrichPod(pod);

      expect(result.x).toBe(100);
      expect(result.y).toBe(150);
      expect(result.output).toEqual([]);
      // store 未載入 defaultOptions 時，enrichPod 回傳 placeholder { model: "" }
      expect(result.providerConfig?.model).toBe("");
      expect(result.multiInstance).toBe(false);
      expect(result.commandId).toBeNull();
      expect(result.schedule).toBeNull();
    });

    it("已有的欄位應保留原值", () => {
      const store = usePodStore();
      const schedule = createMockSchedule();
      const pod = createMockPod({
        x: 500,
        y: 600,
        rotation: 1.5,
        output: ["existing"],
        providerConfig: { model: "sonnet" },
        multiInstance: true,
        commandId: "cmd-1",
        schedule,
      });

      const result = store.enrichPod(pod);

      expect(result.x).toBe(500);
      expect(result.y).toBe(600);
      expect(result.rotation).toBe(1.5);
      expect(result.output).toEqual(["existing"]);
      expect(result.providerConfig.model).toBe("sonnet");
      expect(result.multiInstance).toBe(true);
      expect(result.commandId).toBe("cmd-1");
      expect(result.schedule).toEqual(schedule);
    });

    it("rotation 缺少時應生成隨機值（範圍 -1 到 1）", () => {
      const store = usePodStore();
      const results: number[] = [];

      // 測試多次確認範圍
      for (let i = 0; i < 10; i++) {
        const pod = { id: "pod-1", name: "Test" } as Pod;
        const result = store.enrichPod(pod);
        results.push(result.rotation);
      }

      // 所有值都應在 -1 到 1 範圍內
      for (const rotation of results) {
        expect(rotation).toBeGreaterThanOrEqual(-1);
        expect(rotation).toBeLessThanOrEqual(1);
      }
    });

    it("有 existingOutput 時應使用 existingOutput", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: ["will-be-replaced"] });

      const result = store.enrichPod(pod, [
        "preserved-line-1",
        "preserved-line-2",
      ]);

      expect(result.output).toEqual(["preserved-line-1", "preserved-line-2"]);
    });

    it("existingOutput 為空陣列時應使用空陣列", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: ["will-be-replaced"] });

      const result = store.enrichPod(pod, []);

      expect(result.output).toEqual([]);
    });

    it("existingOutput 非陣列時應回退到 pod.output", () => {
      const store = usePodStore();
      const pod = createMockPod({ output: ["original"] });

      const result = store.enrichPod(pod, "invalid" as any);

      expect(result.output).toEqual(["original"]);
    });
  });

  describe("addPod", () => {
    it("合法 Pod 應新增到 pods 陣列", () => {
      const store = usePodStore();
      store.pods = []; // 清空初始 pods
      const pod = createMockPod({ id: "pod-1", name: "Valid Pod" });

      store.addPod(pod);

      expect(store.pods).toHaveLength(1);
      expect(store.pods[0]).toEqual(pod);
    });

    it("不合法 Pod 不應新增", () => {
      const store = usePodStore();
      store.pods = []; // 清空初始 pods
      const invalidPod = createMockPod({ name: "" }); // 無效名稱

      store.addPod(invalidPod);

      expect(store.pods).toHaveLength(0);
    });

    it("多個合法 Pod 應依序新增", () => {
      const store = usePodStore();
      store.pods = []; // 清空初始 pods
      const pod1 = createMockPod({ id: "pod-1" });
      const pod2 = createMockPod({ id: "pod-2" });

      store.addPod(pod1);
      store.addPod(pod2);

      expect(store.pods).toHaveLength(2);
      expect(store.pods[0]).toEqual(pod1);
      expect(store.pods[1]).toEqual(pod2);
    });
  });

  describe("updatePod", () => {
    it("合法 Pod 應更新到 pods 陣列", () => {
      const store = usePodStore();
      const originalPod = createMockPod({
        id: "pod-1",
        name: "Original",
        x: 100,
      });
      store.pods = [originalPod];

      const updatedPod = createMockPod({
        id: "pod-1",
        name: "Updated",
        x: 200,
      });
      store.updatePod(updatedPod);

      expect(store.pods[0]?.name).toBe("Updated");
      expect(store.pods[0]?.x).toBe(200);
    });

    it("Pod 不存在時不應報錯", () => {
      const store = usePodStore();
      store.pods = []; // 清空初始 pods
      const pod = createMockPod({ id: "non-existent" });

      expect(() => store.updatePod(pod)).not.toThrow();
      expect(store.pods).toHaveLength(0);
    });

    it("不合法 Pod 不應更新，應顯示 warning", () => {
      const store = usePodStore();
      const originalPod = createMockPod({
        id: "pod-1",
        name: "Original",
        x: 100,
      });
      store.pods = [originalPod];

      const invalidPod = createMockPod({ id: "pod-1", name: "", x: 200 }); // 無效名稱
      store.updatePod(invalidPod);

      expect(store.pods[0]?.name).toBe("Original"); // 保持不變
      expect(store.pods[0]?.x).toBe(100);
      expect(console.warn).toHaveBeenCalledWith(
        "[PodStore] updatePod 驗證失敗，已忽略更新",
      );
    });

    it("updatePod 應保留 existing output", () => {
      const store = usePodStore();
      const originalPod = createMockPod({
        id: "pod-1",
        output: ["line1", "line2"],
      });
      store.pods = [originalPod];

      const updatedPod = {
        ...createMockPod({ id: "pod-1", name: "Updated" }),
        output: undefined,
      } as any;
      store.updatePod(updatedPod);

      expect(store.pods[0]?.output).toEqual(["line1", "line2"]);
    });

    it("updatePod 明確提供 output 時應覆蓋", () => {
      const store = usePodStore();
      const originalPod = createMockPod({
        id: "pod-1",
        output: ["line1", "line2"],
      });
      store.pods = [originalPod];

      const updatedPod = createMockPod({ id: "pod-1", output: ["new-line"] });
      store.updatePod(updatedPod);

      expect(store.pods[0]?.output).toEqual(["new-line"]);
    });
  });

  describe("createPodWithBackend", () => {
    /** 建立 createPodWithBackend 所需的預設 payload，可透過 overrides 覆寫任意欄位 */
    function buildCreatePodPayload(
      overrides?: Partial<Omit<Pod, "id">>,
    ): Omit<Pod, "id"> {
      return {
        name: "Pod",
        x: 100,
        y: 100,
        rotation: 0,
        output: [],
        status: "idle",
        skillIds: [],
        subAgentIds: [],
        repositoryId: null,
        multiInstance: false,
        commandId: null,
        schedule: null,
        provider: "claude",
        providerConfig: { model: "opus" },
        ...overrides,
      };
    }

    it("成功時應回傳 Pod、顯示成功 Toast、使用本地座標", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      const newPod = createMockPod({ id: "pod-backend-1", name: "New Pod" });

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { pod: newPod },
      });

      const result = await store.createPodWithBackend(
        buildCreatePodPayload({
          name: "New Pod",
          x: 300,
          y: 400,
          rotation: 0.5,
        }),
      );

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:create",
          responseEvent: "pod:created",
          // 使用 objectContaining 允許 payload 包含額外欄位（provider、providerConfig 等）
          payload: expect.objectContaining({
            name: "New Pod",
            x: 300,
            y: 400,
            rotation: 0.5,
            provider: "claude",
            providerConfig: { model: "opus" },
          }),
        }),
        expect.objectContaining({
          errorCategory: "Pod",
          errorAction: "建立失敗",
          errorMessage: "Pod 建立失敗",
        }),
      );
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Pod",
        "建立成功",
        "New Pod",
      );
      expect(result).toMatchObject({
        ...newPod,
        x: 300, // 使用本地座標
        y: 400,
        rotation: 0.5,
      });
    });

    it("無 activeCanvasId 時應回傳 null", async () => {
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "沒有啟用的畫布",
      });

      const result = await store.createPodWithBackend(buildCreatePodPayload());

      expect(result).toBeNull();
    });

    it("WebSocket 回應無 pod 時應回傳 null 並顯示錯誤 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      const result = await store.createPodWithBackend(buildCreatePodPayload());

      expect(result).toBeNull();
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "Pod",
        "建立失敗",
        "Pod 建立失敗：後端未回傳 Pod 資料",
      );
    });

    it("失敗時應顯示錯誤 Toast 並回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "Pod 建立失敗",
      });

      const result = await store.createPodWithBackend(buildCreatePodPayload());

      expect(result).toBeNull();
    });
  });

  describe("deletePodWithBackend", () => {
    it("成功時應顯示成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", name: "Test Pod" });
      store.pods = [pod];

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      await store.deletePodWithBackend("pod-1");

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:delete",
          responseEvent: "pod:deleted",
          payload: { podId: "pod-1" },
        }),
        expect.objectContaining({
          errorCategory: "Pod",
          errorAction: "刪除失敗",
        }),
      );
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Pod",
        "刪除成功",
        "Test Pod",
      );
    });

    it("Pod 不存在時 Toast 應使用預設名稱", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      await store.deletePodWithBackend("non-existent");

      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Pod",
        "刪除成功",
        "Pod",
      );
    });

    it("失敗時應不顯示成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "Pod 刪除失敗",
      });

      await store.deletePodWithBackend("pod-1");

      expect(mockShowSuccessToast).not.toHaveBeenCalled();
    });
  });

  describe("movePod", () => {
    it("應更新座標", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 200 });
      store.pods = [pod];

      store.movePod("pod-1", 300, 400);

      expect(store.pods[0]?.x).toBe(300);
      expect(store.pods[0]?.y).toBe(400);
    });

    it("Pod 不存在時不應報錯", () => {
      const store = usePodStore();

      expect(() => store.movePod("non-existent", 100, 200)).not.toThrow();
    });

    it("x 為 NaN 時不應更新座標", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 200 });
      store.pods = [pod];

      store.movePod("pod-1", NaN, 300);

      expect(store.pods[0]?.x).toBe(100); // 保持不變
      expect(store.pods[0]?.y).toBe(300);
    });

    it("y 為 Infinity 時不應更新座標", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 200 });
      store.pods = [pod];

      store.movePod("pod-1", 300, Infinity);

      expect(store.pods[0]?.x).toBe(300);
      expect(store.pods[0]?.y).toBe(200); // 保持不變
    });

    it("應限制座標在 MAX_COORD 範圍內（正數）", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 0, y: 0 });
      store.pods = [pod];

      store.movePod("pod-1", 200000, 200000); // 超過 100000

      expect(store.pods[0]?.x).toBe(100000);
      expect(store.pods[0]?.y).toBe(100000);
    });

    it("應限制座標在 MAX_COORD 範圍內（負數）", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 0, y: 0 });
      store.pods = [pod];

      store.movePod("pod-1", -200000, -200000); // 低於 -100000

      expect(store.pods[0]?.x).toBe(-100000);
      expect(store.pods[0]?.y).toBe(-100000);
    });

    it("範圍內的正常值應正確設定", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 0, y: 0 });
      store.pods = [pod];

      store.movePod("pod-1", 50000, -50000);

      expect(store.pods[0]?.x).toBe(50000);
      expect(store.pods[0]?.y).toBe(-50000);
    });
  });

  describe("syncPodPosition", () => {
    it("應 emit WebSocket 訊息", () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 300, y: 400 });
      store.pods = [pod];

      store.syncPodPosition("pod-1");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:move", {
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        x: 300,
        y: 400,
      });
    });

    it("Pod 不存在時不應 emit", () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      store.syncPodPosition("non-existent");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
    });

    it("無 activeCanvasId 時不應 emit", () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      store.pods = [pod];

      store.syncPodPosition("pod-1");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
    });
  });

  describe("renamePodWithBackend", () => {
    it("成功時應顯示成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      await store.renamePodWithBackend("pod-1", "New Name");

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:rename",
          responseEvent: "pod:renamed",
          payload: { podId: "pod-1", name: "New Name" },
        }),
        expect.objectContaining({
          errorCategory: "Pod",
          errorAction: "Pod 重新命名失敗",
        }),
      );
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Pod",
        "重新命名成功",
        "New Name",
      );
    });

    it("無 activeCanvasId 時應不顯示成功 Toast", async () => {
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "沒有啟用的畫布",
      });

      await store.renamePodWithBackend("pod-1", "New Name");

      expect(mockShowSuccessToast).not.toHaveBeenCalled();
    });

    it("失敗時應不顯示成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "Pod 重新命名失敗",
      });

      await store.renamePodWithBackend("pod-1", "New Name");

      expect(mockShowSuccessToast).not.toHaveBeenCalled();
    });
  });

  describe("handleUpdatePod 回滾邏輯", () => {
    /**
     * 此 describe 模擬 CanvasContainer.vue 中 handleUpdatePod 的邏輯：
     * 1. 先樂觀更新本地狀態
     * 2. 若名稱有變更，呼叫 renamePodWithBackend
     * 3. 若後端失敗（result.success === false），回滾本地名稱
     */
    const simulateHandleUpdatePod = async (
      store: ReturnType<typeof usePodStore>,
      pod: import("@/types").Pod,
    ): Promise<void> => {
      const oldPod = store.getPodById(pod.id);
      if (!oldPod) return;

      const oldName = oldPod.name;
      store.updatePod(pod);

      if (oldName !== pod.name) {
        await store.renamePodWithBackend(pod.id, pod.name);
      }
    };

    it("重命名成功時本地狀態應更新為新名稱", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", name: "舊名稱" });
      store.pods = [pod];

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      await simulateHandleUpdatePod(store, { ...pod, name: "新名稱" });

      expect(store.getPodById("pod-1")?.name).toBe("新名稱");
    });

    it("重命名失敗時本地狀態保留為新名稱（樂觀更新）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", name: "舊名稱" });
      store.pods = [pod];

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "後端錯誤",
      });

      await simulateHandleUpdatePod(store, { ...pod, name: "新名稱" });

      expect(store.getPodById("pod-1")?.name).toBe("新名稱");
    });

    it("名稱沒有改變時不應呼叫 renamePodWithBackend", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", name: "相同名稱" });
      store.pods = [pod];

      await simulateHandleUpdatePod(store, { ...pod, x: 999 });

      expect(mockExecuteAction).not.toHaveBeenCalled();
      expect(store.getPodById("pod-1")?.x).toBe(999);
    });
  });

  describe("selectPod", () => {
    it("應設定 selectedPodId", () => {
      const store = usePodStore();

      store.selectPod("pod-123");

      expect(store.selectedPodId).toBe("pod-123");
    });

    it("可以清除選取", () => {
      const store = usePodStore();
      store.selectedPodId = "pod-123";

      store.selectPod(null);

      expect(store.selectedPodId).toBeNull();
    });
  });

  describe("setActivePod", () => {
    it("應設定 activePodId", () => {
      const store = usePodStore();

      store.setActivePod("pod-456");

      expect(store.activePodId).toBe("pod-456");
    });

    it("可以清除活躍 Pod", () => {
      const store = usePodStore();
      store.activePodId = "pod-456";

      store.setActivePod(null);

      expect(store.activePodId).toBeNull();
    });
  });

  describe("setScheduleWithBackend", () => {
    it("成功時應回傳更新的 Pod、顯示成功 Toast（更新）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      const schedule = createMockSchedule();
      const updatedPod = createMockPod({ id: "pod-1", schedule });

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true, pod: updatedPod },
      });

      const result = await store.setScheduleWithBackend("pod-1", schedule);

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:set-schedule",
          responseEvent: "pod:schedule:set",
          payload: { podId: "pod-1", schedule },
        }),
        expect.objectContaining({
          errorCategory: "Schedule",
          errorAction: "操作失敗",
        }),
      );
      expect(mockShowSuccessToast).toHaveBeenCalledWith("Schedule", "更新成功");
      expect(result).toEqual(updatedPod);
    });

    it("schedule 為 null 時應顯示清除成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      const updatedPod = createMockPod({ id: "pod-1", schedule: null });

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true, pod: updatedPod },
      });

      const result = await store.setScheduleWithBackend("pod-1", null);

      expect(mockShowSuccessToast).toHaveBeenCalledWith("Schedule", "刪除成功");
      expect(result).toEqual(updatedPod);
    });

    it("無 activeCanvasId 時應回傳 null", async () => {
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "沒有啟用的畫布",
      });

      const schedule = createMockSchedule();
      const result = await store.setScheduleWithBackend("pod-1", schedule);

      expect(result).toBeNull();
    });

    it("executeAction 失敗時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "Schedule 設定失敗",
      });

      const result = await store.setScheduleWithBackend("pod-1", null);

      expect(result).toBeNull();
    });

    it("回應 success: false 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: false },
      });

      const result = await store.setScheduleWithBackend("pod-1", null);

      expect(result).toBeNull();
    });

    it("回應無 pod 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      const result = await store.setScheduleWithBackend("pod-1", null);

      expect(result).toBeNull();
    });
  });

  describe("triggerScheduleFiredAnimation", () => {
    it("應新增 podId 到 scheduleFiredPodIds", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set();

      store.triggerScheduleFiredAnimation("pod-1");

      expect(store.scheduleFiredPodIds.has("pod-1")).toBe(true);
    });

    it("已存在的 podId 應先刪除再重新加入（觸發 reactivity）", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set(["pod-1"]);

      const originalSet = store.scheduleFiredPodIds;
      store.triggerScheduleFiredAnimation("pod-1");

      // 應該是新的 Set 實例（觸發 reactivity）
      expect(store.scheduleFiredPodIds).not.toBe(originalSet);
      expect(store.scheduleFiredPodIds.has("pod-1")).toBe(true);
    });

    it("多個 podId 可以同時存在", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set();

      store.triggerScheduleFiredAnimation("pod-1");
      store.triggerScheduleFiredAnimation("pod-2");

      expect(store.scheduleFiredPodIds.has("pod-1")).toBe(true);
      expect(store.scheduleFiredPodIds.has("pod-2")).toBe(true);
      expect(store.scheduleFiredPodIds.size).toBe(2);
    });
  });

  describe("clearScheduleFiredAnimation", () => {
    it("應從 scheduleFiredPodIds 中刪除 podId", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set(["pod-1", "pod-2"]);

      store.clearScheduleFiredAnimation("pod-1");

      expect(store.scheduleFiredPodIds.has("pod-1")).toBe(false);
      expect(store.scheduleFiredPodIds.has("pod-2")).toBe(true);
    });

    it("不存在的 podId 應不報錯", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set(["pod-1"]);

      expect(() => store.clearScheduleFiredAnimation("pod-2")).not.toThrow();
    });

    it("應建立新的 Set（觸發 reactivity）", () => {
      const store = usePodStore();
      store.scheduleFiredPodIds = new Set(["pod-1"]);

      const originalSet = store.scheduleFiredPodIds;
      store.clearScheduleFiredAnimation("pod-1");

      expect(store.scheduleFiredPodIds).not.toBe(originalSet);
    });
  });

  describe("事件處理", () => {
    describe("addPodFromEvent", () => {
      it("應新增合法的 enriched Pod", () => {
        const store = usePodStore();
        store.pods = []; // 清空初始 pods
        const pod = createMockPod({ id: "pod-1", name: "Event Pod" });

        store.addPodFromEvent(pod);

        expect(store.pods).toHaveLength(1);
        expect(store.pods[0]).toMatchObject({
          id: "pod-1",
          name: "Event Pod",
        });
      });

      it("不合法 Pod 不應新增", () => {
        const store = usePodStore();
        store.pods = []; // 清空初始 pods
        const invalidPod = createMockPod({ name: "" });

        store.addPodFromEvent(invalidPod);

        expect(store.pods).toHaveLength(0);
      });

      it("應使用 enrichPod 補全欠缺的欄位", () => {
        const store = usePodStore();
        store.pods = []; // 清空初始 pods
        const incompletePod = {
          id: "pod-1",
          name: "Incomplete",
        } as Pod;

        store.addPodFromEvent(incompletePod);

        expect(store.pods[0]?.x).toBe(100);
        // store 未載入 defaultOptions 時，enrichPod 回傳 placeholder { model: "" }
        expect(store.pods[0]?.providerConfig?.model).toBe("");
      });
    });

    describe("removePod", () => {
      it("應移除指定 Pod", () => {
        const store = usePodStore();
        const pod1 = createMockPod({ id: "pod-1" });
        const pod2 = createMockPod({ id: "pod-2" });
        store.pods = [pod1, pod2];

        store.removePod("pod-1");

        expect(store.pods).toHaveLength(1);
        expect(store.pods[0]?.id).toBe("pod-2");
      });

      it("刪除 selectedPodId 時應清除選取", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1" });
        store.pods = [pod];
        store.selectedPodId = "pod-1";

        store.removePod("pod-1");

        expect(store.selectedPodId).toBeNull();
      });

      it("刪除 activePodId 時應清除活躍狀態", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1" });
        store.pods = [pod];
        store.activePodId = "pod-1";

        store.removePod("pod-1");

        expect(store.activePodId).toBeNull();
      });

      it("應呼叫 connectionStore.deleteConnectionsByPodId", () => {
        const pinia = setupTestPinia();
        setActivePinia(pinia);
        const store = usePodStore();
        const connectionStore = useConnectionStore();

        const pod = createMockPod({ id: "pod-1" });
        store.pods = [pod];

        const deleteSpy = vi.spyOn(connectionStore, "deleteConnectionsByPodId");

        store.removePod("pod-1");

        expect(deleteSpy).toHaveBeenCalledWith("pod-1");
      });
    });

    describe("updatePodPosition", () => {
      it("應更新 Pod 的座標", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 200 });
        store.pods = [pod];

        store.updatePodPosition("pod-1", 300, 400);

        expect(store.pods[0]?.x).toBe(300);
        expect(store.pods[0]?.y).toBe(400);
      });

      it("Pod 不存在時不應報錯", () => {
        const store = usePodStore();

        expect(() =>
          store.updatePodPosition("non-existent", 100, 200),
        ).not.toThrow();
      });
    });

    describe("updatePodName", () => {
      it("應更新 Pod 的名稱", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", name: "Old Name" });
        store.pods = [pod];

        store.updatePodName("pod-1", "New Name");

        expect(store.pods[0]?.name).toBe("New Name");
      });

      it("Pod 不存在時不應報錯", () => {
        const store = usePodStore();

        expect(() =>
          store.updatePodName("non-existent", "New Name"),
        ).not.toThrow();
      });
    });

    describe("updatePodRepository", () => {
      it("應更新 Pod 的 repositoryId", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", repositoryId: null });
        store.pods = [pod];

        store.updatePodRepository("pod-1", "repo-1");

        expect(store.pods[0]?.repositoryId).toBe("repo-1");
      });

      it("可以清除 repositoryId", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", repositoryId: "repo-1" });
        store.pods = [pod];

        store.updatePodRepository("pod-1", null);

        expect(store.pods[0]?.repositoryId).toBeNull();
      });

      it("Pod 不存在時應 early return", () => {
        const store = usePodStore();

        expect(() =>
          store.updatePodRepository("non-existent", "repo-1"),
        ).not.toThrow();
      });
    });

    describe("updatePodCommand", () => {
      it("應更新 Pod 的 commandId", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", commandId: null });
        store.pods = [pod];

        store.updatePodCommand("pod-1", "cmd-1");

        expect(store.pods[0]?.commandId).toBe("cmd-1");
      });

      it("可以清除 commandId", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", commandId: "cmd-1" });
        store.pods = [pod];

        store.updatePodCommand("pod-1", null);

        expect(store.pods[0]?.commandId).toBeNull();
      });

      it("Pod 不存在時應 early return", () => {
        const store = usePodStore();

        expect(() =>
          store.updatePodCommand("non-existent", "cmd-1"),
        ).not.toThrow();
      });
    });

    describe("clearPodOutputsByIds", () => {
      it("應清空指定多個 Pod 的 output", () => {
        const store = usePodStore();
        const pod1 = createMockPod({ id: "pod-1", output: ["line1", "line2"] });
        const pod2 = createMockPod({ id: "pod-2", output: ["line3"] });
        const pod3 = createMockPod({ id: "pod-3", output: ["line4"] });
        store.pods = [pod1, pod2, pod3];

        store.clearPodOutputsByIds(["pod-1", "pod-2"]);

        expect(store.pods[0]?.output).toEqual([]);
        expect(store.pods[1]?.output).toEqual([]);
        expect(store.pods[2]?.output).toEqual(["line4"]);
      });

      it("空陣列時不應清空任何 output", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", output: ["line1"] });
        store.pods = [pod];

        store.clearPodOutputsByIds([]);

        expect(store.pods[0]?.output).toEqual(["line1"]);
      });

      it("不存在的 podId 應不報錯", () => {
        const store = usePodStore();
        const pod = createMockPod({ id: "pod-1", output: ["line1"] });
        store.pods = [pod];

        expect(() =>
          store.clearPodOutputsByIds(["pod-1", "non-existent"]),
        ).not.toThrow();
        expect(store.pods[0]?.output).toEqual([]);
      });
    });
  });

  describe("setMultiInstanceWithBackend", () => {
    it("成功時應回傳更新的 Pod、顯示成功 Toast", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      const updatedPod = createMockPod({ id: "pod-1", multiInstance: true });

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true, pod: updatedPod },
      });

      const result = await store.setMultiInstanceWithBackend("pod-1", true);

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: "pod:set-multi-instance",
          responseEvent: "pod:multi-instance:set",
          payload: { podId: "pod-1", multiInstance: true },
        }),
        expect.objectContaining({
          errorCategory: "Pod",
          errorAction: "操作失敗",
        }),
      );
      expect(mockShowSuccessToast).toHaveBeenCalledWith("Pod", "更新成功");
      expect(result).toEqual(updatedPod);
    });

    it("executeAction 失敗時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: false,
        error: "Pod 設定失敗",
      });

      const result = await store.setMultiInstanceWithBackend("pod-1", false);

      expect(result).toBeNull();
    });

    it("回應 success: false 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: false },
      });

      const result = await store.setMultiInstanceWithBackend("pod-1", false);

      expect(result).toBeNull();
    });

    it("回應無 pod 時應回傳 null", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = usePodStore();

      mockExecuteAction.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      const result = await store.setMultiInstanceWithBackend("pod-1", true);

      expect(result).toBeNull();
    });
  });

  describe("syncPodsFromBackend", () => {
    it("應處理多個 Pod 並使用 enrichPod", () => {
      const store = usePodStore();
      const pod1 = createMockPod({ id: "pod-1", x: undefined as any });
      // 模擬 providerConfig 缺失時 enrichPod 應補預設值
      const pod2 = createMockPod({
        id: "pod-2",
        providerConfig: undefined as any,
      });

      store.syncPodsFromBackend([pod1, pod2]);

      expect(store.pods).toHaveLength(2);
      // enrichPod 應填入預設值
      expect(store.pods[0]?.x).toBe(100);
      // store 未載入 defaultOptions 時，enrichPod 回傳 placeholder { model: "" }
      expect(store.pods[1]?.providerConfig?.model).toBe("");
    });

    it("應過濾掉無效 Pod", () => {
      const store = usePodStore();
      const validPod = createMockPod({ id: "pod-1", name: "Valid" });
      const invalidPod = createMockPod({ id: "pod-2", name: "" }); // 無效名稱

      store.syncPodsFromBackend([validPod, invalidPod]);

      expect(store.pods).toHaveLength(1);
      expect(store.pods[0]?.id).toBe("pod-1");
    });

    it("應使用 index 計算自動偏移座標", () => {
      const store = usePodStore();
      const pod1 = { id: "pod-1", name: "Pod 1" } as Pod;
      const pod2 = { id: "pod-2", name: "Pod 2" } as Pod;
      const pod3 = { id: "pod-3", name: "Pod 3" } as Pod;

      store.syncPodsFromBackend([pod1, pod2, pod3]);

      expect(store.pods[0]?.x).toBe(100); // 100 + (0 * 300)
      expect(store.pods[0]?.y).toBe(150); // 150 + (0 % 2) * 100
      expect(store.pods[1]?.x).toBe(400); // 100 + (1 * 300)
      expect(store.pods[1]?.y).toBe(250); // 150 + (1 % 2) * 100
      expect(store.pods[2]?.x).toBe(700); // 100 + (2 * 300)
      expect(store.pods[2]?.y).toBe(150); // 150 + (2 % 2) * 100
    });

    it("已有座標時應使用已有座標", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 500, y: 600 });

      store.syncPodsFromBackend([pod]);

      expect(store.pods[0]?.x).toBe(500);
      expect(store.pods[0]?.y).toBe(600);
    });
  });

  describe("updatePodProviderConfigModel", () => {
    it("合法 model 名稱應成功更新 providerConfig.model", () => {
      const store = usePodStore();
      // 建立一個 codex provider 的 Pod，初始 model 為 gpt-5.4
      const pod = createMockPod({
        id: "pod-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      store.pods = [pod];

      // gpt-4o-mini 符合 isValidModelName 規則（字母、數字、點、連字號）
      store.updatePodProviderConfigModel("pod-1", "gpt-4o-mini");

      expect(store.pods[0]?.providerConfig?.model).toBe("gpt-4o-mini");
    });

    it("非法 model 名稱應被拒絕，store state 不應被更新", () => {
      const store = usePodStore();
      const pod = createMockPod({
        id: "pod-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      store.pods = [pod];

      // "../etc/passwd" 含有 "/" 不符合 isValidModelName 規則，應被拒絕
      store.updatePodProviderConfigModel("pod-1", "../etc/passwd");

      // model 不應被更新
      expect(store.pods[0]?.providerConfig?.model).toBe("gpt-5.4");
      expect(console.warn).toHaveBeenCalledWith(
        "[PodStore] model 不合法，已拒絕更新：../etc/passwd",
      );
    });

    it("空字串 model 應被拒絕，store state 不應被更新", () => {
      const store = usePodStore();
      const pod = createMockPod({
        id: "pod-1",
        providerConfig: { model: "opus" },
      });
      store.pods = [pod];

      store.updatePodProviderConfigModel("pod-1", "");

      // model 不應被更新
      expect(store.pods[0]?.providerConfig?.model).toBe("opus");
      expect(console.warn).toHaveBeenCalledWith(
        "[PodStore] model 不合法，已拒絕更新：",
      );
    });

    it("Pod 不存在時應靜默忽略不拋錯，store state 不變", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      store.pods = [pod];
      const originalModel = store.pods[0]?.providerConfig?.model;

      // 對不存在的 podId 呼叫，不應 throw，也不應改動其他 pod
      expect(() =>
        store.updatePodProviderConfigModel("non-existent", "valid-model"),
      ).not.toThrow();
      expect(store.pods[0]?.providerConfig?.model).toBe(originalModel);
    });

    it("model 更新後 providerConfig 僅含 model 欄位（provider 判別改由 Pod.provider 負責）", () => {
      const store = usePodStore();
      // ProviderConfig 現在只有 model 欄位，provider 身份由上層 Pod.provider 負責
      const pod = createMockPod({
        id: "pod-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      store.pods = [pod];

      // valid-model 符合 isValidModelName 規則
      store.updatePodProviderConfigModel("pod-1", "valid-model");

      expect(store.pods[0]?.providerConfig?.model).toBe("valid-model");
      // Pod.provider 仍為 'codex'，providerConfig 只有 model 欄位
      expect(store.pods[0]?.provider).toBe("codex");
      expect(Object.keys(store.pods[0]?.providerConfig ?? {})).toEqual([
        "model",
      ]);
    });
  });

  describe("updatePodField", () => {
    it("Pod 存在時應成功更新 commandId 欄位", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", commandId: null });
      store.pods = [pod];

      store.updatePodField("pod-1", "commandId", "cmd-abc");

      expect(store.pods[0]?.commandId).toBe("cmd-abc");
    });

    it("Pod 存在時應成功更新 commandId 至另一個值", () => {
      const store = usePodStore();
      const pod = createMockPod({ id: "pod-1", commandId: "cmd-old" });
      store.pods = [pod];

      store.updatePodField("pod-1", "commandId", "cmd-new");

      expect(store.pods[0]?.commandId).toBe("cmd-new");
    });

    it("Pod 不存在時應靜默忽略不拋錯", () => {
      const store = usePodStore();
      store.pods = [];

      expect(() =>
        store.updatePodField("non-existent", "commandId", null),
      ).not.toThrow();
      expect(store.pods).toHaveLength(0);
    });
  });

  describe("showTypeMenu / hideTypeMenu", () => {
    it("showTypeMenu 應設定 visible 為 true 並設定 position", () => {
      const store = usePodStore();

      store.showTypeMenu({ x: 100, y: 200 });

      expect(store.typeMenu.visible).toBe(true);
      expect(store.typeMenu.position).toEqual({ x: 100, y: 200 });
    });

    it("hideTypeMenu 應設定 visible 為 false 並清除 position", () => {
      const store = usePodStore();
      store.typeMenu = {
        visible: true,
        position: { x: 100, y: 200 },
      };

      store.hideTypeMenu();

      expect(store.typeMenu.visible).toBe(false);
      expect(store.typeMenu.position).toBeNull();
    });

    it("showTypeMenu 應正常開啟選單", () => {
      const store = usePodStore();

      store.showTypeMenu({ x: 50, y: 150 });

      expect(store.typeMenu.visible).toBe(true);
      expect(store.typeMenu.position).toEqual({ x: 50, y: 150 });
    });

    it("選單關閉後立即嘗試重開應能在新位置開啟", () => {
      const store = usePodStore();

      store.showTypeMenu({ x: 100, y: 200 });
      expect(store.typeMenu.visible).toBe(true);

      store.hideTypeMenu();
      expect(store.typeMenu.visible).toBe(false);

      // 立即在新位置重開，不應被攔截
      store.showTypeMenu({ x: 300, y: 400 });
      expect(store.typeMenu.visible).toBe(true);
      expect(store.typeMenu.position).toEqual({ x: 300, y: 400 });
    });
  });
});
