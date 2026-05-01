import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useConnectionStore } from "@/stores/connectionStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useToast } from "@/composables/useToast";
import ConnectionContextMenu from "@/components/canvas/ConnectionContextMenu.vue";

// ── WS 邊界 mock（store action 需要 WS 才能執行）────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── UI icon mock（避免 lucide 元件干擾）────────────────────────
vi.mock("lucide-vue-next", () => ({
  Zap: { name: "Zap", template: "<svg />" },
  Brain: { name: "Brain", template: "<svg />" },
  ArrowRight: { name: "ArrowRight", template: "<svg />" },
  ChevronRight: { name: "ChevronRight", template: "<svg />" },
}));

// ── 預設 props ────────────────────────────────────────────────
const defaultProps = {
  position: { x: 100, y: 200 },
  connectionId: "conn-123",
  currentTriggerMode: "auto" as const,
  currentSummaryModel: "sonnet",
  currentAiDecideModel: "sonnet" as const,
};

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ConnectionContextMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

/**
 * DOM 中 .relative 容器的順序（對應 template 宣告順序）：
 *   [0] Summary Provider 子選單
 *   [1] Summary Model 子選單
 *   [2] AI Model 子選單
 */

/** 展開 Summary Provider 子選單（hover 第 0 個 .relative 容器） */
async function openProviderMenu(wrapper: ReturnType<typeof mountMenu>) {
  const providerWrapper = wrapper.findAll(".relative")[0]!;
  await providerWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

/** 展開 Summary Model 子選單（hover 第 1 個 .relative 容器） */
async function openSummaryMenu(wrapper: ReturnType<typeof mountMenu>) {
  const summaryWrapper = wrapper.findAll(".relative")[1]!;
  await summaryWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

/** 展開 AI Model 子選單（hover 第 2 個 .relative 容器） */
async function openAiModelMenu(wrapper: ReturnType<typeof mountMenu>) {
  const relativeWrappers = wrapper.findAll(".relative");
  const aiModelWrapper = relativeWrappers[2]!;
  await aiModelWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

/**
 * 注入 Claude provider 的模型清單，讓 summaryModelOptions computed 可正常回傳三選一。
 * 需在 setupTestPinia 之後呼叫（setupStoreTest 的 extra callback 或 beforeEach 中）。
 */
function setupClaudeCapability() {
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
        { value: "haiku", label: "Haiku" },
        { value: "sonnet", label: "Sonnet" },
        { value: "opus", label: "Opus" },
      ],
    },
  ]);
}

/**
 * 注入上游 Pod（provider: claude），讓 connectionStore.findConnectionById 能取得 sourcePodId，
 * 再由 podStore 取得 Pod，進而查出 providerCapabilityStore 的可選模型。
 */
function setupDefaultStoreState() {
  // 設定 canvasId（store action 需要）
  const canvasStore = useCanvasStore();
  canvasStore.activeCanvasId = "canvas-1";

  // 注入 Claude 模型清單
  setupClaudeCapability();

  // 注入上游 Pod
  const podStore = usePodStore();
  podStore.pods = [
    {
      id: "pod-upstream",
      provider: "claude",
    } as ReturnType<(typeof podStore.pods)[0]["valueOf"]>,
  ] as typeof podStore.pods;

  // 注入 Connection（summaryModelOptions computed 需要 findConnectionById 能回傳結果）
  const connectionStore = useConnectionStore();
  connectionStore.connections = [
    {
      id: "conn-123",
      sourcePodId: "pod-upstream",
      targetPodId: "pod-target",
      sourceAnchor: "bottom",
      targetAnchor: "top",
      triggerMode: "auto",
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      status: "idle",
    },
  ] as typeof connectionStore.connections;
}

describe("ConnectionContextMenu", () => {
  // 使用真實 store + Pinia，只 mock WS 邊界
  setupStoreTest(() => {
    setupDefaultStoreState();
    // WS mock 預設回傳成功的 connection（各 action 可依需求在測試中 override）
    mockCreateWebSocketRequest.mockResolvedValue({
      connection: {
        id: "conn-123",
        sourcePodId: "pod-upstream",
        sourceAnchor: "bottom",
        targetPodId: "pod-target",
        targetAnchor: "top",
        triggerMode: "auto",
        summaryModel: "sonnet",
        aiDecideModel: "sonnet",
      },
    });
  });

  // 每次測試後清除 toasts（useToast 使用 module-level ref）
  beforeEach(() => {
    const { toasts } = useToast();
    toasts.value = [];
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Model 區塊渲染", () => {
    it("應顯示 Summary Model 標題文字", () => {
      const wrapper = mountMenu();
      expect(wrapper.text()).toContain("Summary Model");
    });

    it("應顯示所有 model 選項（Haiku / Sonnet / Opus）", async () => {
      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      for (const label of ["Haiku", "Sonnet", "Opus"]) {
        const btn = buttons.find((b) => b.text().includes(label));
        expect(btn, `找不到 ${label} 按鈕`).toBeDefined();
        expect(btn?.exists()).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Model 選中狀態標記", () => {
    it("currentSummaryModel 為 sonnet 時，Sonnet 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      expect(sonnetBtn?.classes()).toContain("bg-secondary");
      expect(sonnetBtn?.classes()).toContain("border-l-2");
    });

    it("currentSummaryModel 為 haiku 時，Haiku 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "haiku" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).toContain("bg-secondary");
      expect(haikuBtn?.classes()).toContain("border-l-2");
    });

    it("currentSummaryModel 為 opus 時，Opus 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "opus" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      expect(opusBtn?.classes()).toContain("bg-secondary");
      expect(opusBtn?.classes()).toContain("border-l-2");
    });

    it("currentSummaryModel 為 sonnet 時，Haiku 按鈕不應有選中樣式", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).not.toContain("border-l-2");
    });

    it("summaryProvider=gemini 且 currentSummaryModel=gemini-2.5-flash 時，Gemini 2.5 Flash 按鈕應有選中樣式，其他 Gemini 模型沒有", async () => {
      // 安排 sourcePod 為 claude，但 connection.summaryProvider 為 gemini
      const connectionStore = useConnectionStore();
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "gemini-2.5-flash",
          summaryProvider: "gemini",
          aiDecideModel: "sonnet",
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      // 注入 Gemini capability
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          ],
        },
      ]);

      const wrapper = mountMenu({ currentSummaryModel: "gemini-2.5-flash" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");

      // Gemini 2.5 Flash 應有選中樣式
      const flashBtn = buttons.find((b) =>
        b.text().includes("Gemini 2.5 Flash"),
      );
      expect(flashBtn?.classes()).toContain("border-l-2");

      // Gemini 2.5 Pro 不應有選中樣式
      const proBtn = buttons.find((b) => b.text().includes("Gemini 2.5 Pro"));
      expect(proBtn?.classes()).not.toContain("border-l-2");
    });

    it("summaryProvider=gemini 但 currentSummaryModel 為 claude 模型（跨 provider）時，沒有任何 model 按鈕應有選中樣式", async () => {
      // summaryProvider=gemini，但 currentSummaryModel 帶入 claude 的 "sonnet"（跨 provider 錯位情境）
      const connectionStore = useConnectionStore();
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "sonnet",
          summaryProvider: "gemini",
          aiDecideModel: "sonnet",
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      // 注入 Gemini capability
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          ],
        },
      ]);

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");

      // 確認選單中所有 model 按鈕都沒有 border-l-2（避免 claude 模型被誤標在 gemini 選單中）
      const modelButtons = buttons.filter((b) => b.text().includes("Gemini"));
      for (const btn of modelButtons) {
        expect(btn.classes()).not.toContain("border-l-2");
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("點擊不同模型 - 成功流程", () => {
    it("點擊 Haiku（非當前）應呼叫 updateConnectionSummaryModel 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryModel");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "haiku",
        },
      });

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "haiku");
    });

    it("點擊 Opus（非當前）應呼叫 updateConnectionSummaryModel 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryModel");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "opus",
        },
      });

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "opus");
    });

    it("切換模型成功後應顯示成功 toast", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "haiku",
        },
      });
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "總結模型已變更")).toBe(true);
      expect(toasts.value.some((t) => t.description?.includes("Haiku"))).toBe(
        true,
      );
    });

    it("切換至 Opus 成功後應顯示正確 toast description", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "opus",
        },
      });
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "總結模型已變更")).toBe(true);
      expect(toasts.value.some((t) => t.description?.includes("Opus"))).toBe(
        true,
      );
    });

    it("切換模型成功後應 emit summary-model-changed", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("summary-model-changed")).toBeTruthy();
    });

    it("切換模型成功後應 emit close", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("點擊已選中的模型 - 直接關閉", () => {
    it("點擊已選中的 Sonnet 不應呼叫 updateConnectionSummaryModel", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryModel");

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");
      await flushPromises();

      expect(spy).not.toHaveBeenCalled();
    });

    it("點擊已選中的模型應直接 emit close", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "haiku" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊已選中的模型不應顯示 toast", async () => {
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentSummaryModel: "opus" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("切換模型失敗", () => {
    it("updateConnectionSummaryModel 回傳 null 時應顯示失敗 toast", async () => {
      // WS 回傳無 connection 欄位 → store action 回傳 null
      mockCreateWebSocketRequest.mockResolvedValue({});
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "變更失敗")).toBe(true);
      expect(
        toasts.value.some((t) => t.description?.includes("總結模型")),
      ).toBe(true);
    });

    it("updateConnectionSummaryModel 失敗時不應 emit summary-model-changed", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("summary-model-changed")).toBeFalsy();
    });

    it("updateConnectionSummaryModel 失敗時不應 emit close", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("AI Model 區塊渲染", () => {
    it("應顯示 AI Model 標題文字", () => {
      const wrapper = mountMenu();
      expect(wrapper.text()).toContain("AI Model");
    });

    it("triggerMode 為 ai-decide 時，hover 後子選單應出現並顯示 Haiku/Sonnet/Opus 選項", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      await openAiModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      expect(haikuBtn?.exists()).toBe(true);
      expect(sonnetBtn?.exists()).toBe(true);
      expect(opusBtn?.exists()).toBe(true);
    });

    it.each([
      { currentTriggerMode: "auto" as const },
      { currentTriggerMode: "direct" as const },
    ])(
      "triggerMode 為 $currentTriggerMode 時，AI Model 區塊應有 opacity-50 disabled 樣式且子選單不出現",
      async ({ currentTriggerMode }) => {
        const wrapper = mountMenu({ currentTriggerMode });
        const relativeWrappers = wrapper.findAll(".relative");
        const aiModelWrapper = relativeWrappers[2]!;
        expect(aiModelWrapper.classes()).toContain("opacity-50");
        await openAiModelMenu(wrapper);
        expect(aiModelWrapper.find(".absolute").exists()).toBe(false);
      },
    );
  });

  // ──────────────────────────────────────────────────────────────
  describe("AI Model 選中狀態標記", () => {
    it("currentAiDecideModel 為 sonnet 時，Sonnet 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      expect(sonnetBtn?.classes()).toContain("bg-secondary");
      expect(sonnetBtn?.classes()).toContain("border-l-2");
    });

    it("currentAiDecideModel 為 haiku 時，Haiku 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "haiku",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).toContain("bg-secondary");
      expect(haikuBtn?.classes()).toContain("border-l-2");
    });

    it("currentAiDecideModel 為 opus 時，Opus 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "opus",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      expect(opusBtn?.classes()).toContain("bg-secondary");
      expect(opusBtn?.classes()).toContain("border-l-2");
    });

    it("currentAiDecideModel 為 sonnet 時，Haiku 按鈕不應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).not.toContain("border-l-2");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("AI Model 點擊不同模型 - 成功流程", () => {
    it("點擊 Haiku（非當前）應呼叫 updateConnectionAiDecideModel 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionAiDecideModel");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          aiDecideModel: "haiku",
        },
      });

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "haiku");
    });

    it("切換模型成功後應顯示 title 為 AI 決策模型已變更 的 toast", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          aiDecideModel: "haiku",
        },
      });
      const { toasts } = useToast();

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "AI 決策模型已變更")).toBe(
        true,
      );
    });

    it("切換模型成功後應 emit ai-decide-model-changed", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("ai-decide-model-changed")).toBeTruthy();
    });

    it("切換模型成功後應 emit close", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("AI Model 點擊已選中的模型 - 直接關閉", () => {
    it("點擊已選中的模型不應呼叫 updateConnectionAiDecideModel", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionAiDecideModel");

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");
      await flushPromises();

      expect(spy).not.toHaveBeenCalled();
    });

    it("點擊已選中的模型應直接 emit close", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "haiku",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("AI Model 切換模型失敗", () => {
    it("updateConnectionAiDecideModel 回傳 null 時應顯示失敗 toast", async () => {
      // WS 回傳無 connection 欄位 → store action 回傳 null
      mockCreateWebSocketRequest.mockResolvedValue({});
      const { toasts } = useToast();

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "變更失敗")).toBe(true);
      expect(
        toasts.value.some((t) => t.description?.includes("AI 決策模型")),
      ).toBe(true);
    });

    it("updateConnectionAiDecideModel 失敗時不應 emit ai-decide-model-changed", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("ai-decide-model-changed")).toBeFalsy();
    });

    it("updateConnectionAiDecideModel 失敗時不應 emit close", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Model 載入中分支", () => {
    it("connectionStore 中找不到對應 connection 時，Summary Model 子選單應顯示載入中", async () => {
      // 清空 connections，讓 findConnectionById 回傳 undefined
      const connectionStore = useConnectionStore();
      connectionStore.connections = [];

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      expect(wrapper.text()).toContain("載入中");
    });

    it("providerCapabilityStore 無對應模型清單時，Summary Model 子選單應顯示載入中", async () => {
      // 清空 capability 資料，讓 getAvailableModels 回傳空陣列
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
          availableModels: [],
        },
      ]);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      expect(wrapper.text()).toContain("載入中");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Model 子選單依上游 provider 動態渲染", () => {
    it("上游是 Claude 時 Summary Model 子選單應渲染三個 Claude 模型（Haiku/Sonnet/Opus）", async () => {
      // setupDefaultStoreState 已設定 Claude provider
      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
    });

    it("上游是 Codex 時 Summary Model 子選單應渲染三個 Codex 模型（GPT-5.4/GPT-5.5/GPT-5.6）", async () => {
      // 切換 Pod provider 為 codex，並設定 Codex 模型清單
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-upstream",
          provider: "codex",
        } as (typeof podStore.pods)[0],
      ] as typeof podStore.pods;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
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
            { value: "gpt-5.6", label: "GPT-5.6" },
          ],
        },
      ]);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("GPT-5.4"))).toBe(true);
      expect(labels.some((l) => l.includes("GPT-5.5"))).toBe(true);
      expect(labels.some((l) => l.includes("GPT-5.6"))).toBe(true);
    });

    it("上游是 Codex 時，點擊 GPT-5.5 應呼叫 updateConnectionSummaryModel 並傳入正確 value", async () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-upstream",
          provider: "codex",
        } as (typeof podStore.pods)[0],
      ] as typeof podStore.pods;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
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

      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryModel");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "gpt-5.5",
        },
      });

      const wrapper = mountMenu({ currentSummaryModel: "gpt-5.4" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const gpt55Btn = buttons.find((b) => b.text().includes("GPT-5.5"));
      await gpt55Btn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "gpt-5.5");
    });

    it("AI Decide Model 子選單在上游是 Claude 時仍只顯示 Claude 三個模型", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
      // 不應有 Codex 模型
      expect(labels.some((l) => l.includes("GPT"))).toBe(false);
    });

    it("AI Decide Model 子選單在上游是 Codex 時仍只顯示 Claude 三個模型（不受 provider 影響）", async () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-upstream",
          provider: "codex",
        } as (typeof podStore.pods)[0],
      ] as typeof podStore.pods;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
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

      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[2]!;
      const buttons = aiModelWrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      // AI Decide Model 硬編碼 Claude 三選一，不受上游 provider 影響
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
      // 不應有 Codex 模型
      expect(labels.some((l) => l.includes("GPT"))).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Trigger Mode 切換 - 成功流程", () => {
    it("點擊 Direct（非當前 auto）應呼叫 updateConnectionTriggerMode 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionTriggerMode");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          triggerMode: "direct",
        },
      });

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "direct");
    });

    it("點擊 ai-decide（非當前 auto）應呼叫 updateConnectionTriggerMode 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionTriggerMode");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          triggerMode: "ai-decide",
        },
      });

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const aiDecideBtn = buttons.find((b) =>
        b.text().includes("AI 判斷 (AI Decide)"),
      );
      await aiDecideBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "ai-decide");
    });

    it("切換 trigger mode 成功後應顯示成功 toast", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          triggerMode: "direct",
        },
      });
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "觸發模式已變更")).toBe(true);
    });

    it("切換 trigger mode 成功後應 emit trigger-mode-changed", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("trigger-mode-changed")).toBeTruthy();
    });

    it("切換 trigger mode 成功後應 emit close", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Trigger Mode 切換 - 點擊已選中的 mode", () => {
    it("點擊已選中的 auto 不應呼叫 updateConnectionTriggerMode", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionTriggerMode");

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const autoBtn = buttons.find((b) => b.text().includes("自動觸發 (Auto)"));
      await autoBtn?.trigger("click");
      await flushPromises();

      expect(spy).not.toHaveBeenCalled();
    });

    it("點擊已選中的 mode 應直接 emit close", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "direct" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊已選中的 mode 不應顯示 toast", async () => {
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      const buttons = wrapper.findAll("button");
      const aiDecideBtn = buttons.find((b) =>
        b.text().includes("AI 判斷 (AI Decide)"),
      );
      await aiDecideBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Trigger Mode 切換 - 失敗流程", () => {
    it("updateConnectionTriggerMode 失敗時應顯示失敗 toast", async () => {
      // WS 回傳無 connection 欄位 → store action 回傳 null
      mockCreateWebSocketRequest.mockResolvedValue({});
      const { toasts } = useToast();

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "變更失敗")).toBe(true);
      expect(
        toasts.value.some((t) => t.description?.includes("觸發模式")),
      ).toBe(true);
    });

    it("updateConnectionTriggerMode 失敗時不應 emit trigger-mode-changed", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("trigger-mode-changed")).toBeFalsy();
    });

    it("updateConnectionTriggerMode 失敗時不應 emit close", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Provider 子選單渲染", () => {
    it("應顯示 Summary Provider 標題文字", () => {
      const wrapper = mountMenu();
      expect(wrapper.text()).toContain("Summary Provider");
    });

    it("展開後應顯示 Claude / Codex / Gemini 三個 provider 選項", async () => {
      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const labels = buttons.map((b) => b.text());

      expect(labels.some((l) => l.includes("Claude"))).toBe(true);
      expect(labels.some((l) => l.includes("Codex"))).toBe(true);
      expect(labels.some((l) => l.includes("Gemini"))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Provider currentProvider 計算邏輯", () => {
    it("舊 Connection（summaryProvider 為 undefined）的 currentProvider 應 fallback 為來源 Pod provider", async () => {
      // setupDefaultStoreState 注入的 connection 沒有 summaryProvider 欄位（undefined）
      // 且上游 Pod provider 為 claude
      const connectionStore = useConnectionStore();
      // 確認 connection 沒有 summaryProvider
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "sonnet",
          aiDecideModel: "sonnet",
          status: "idle",
          // summaryProvider 刻意不設定，模擬舊 Connection
        },
      ] as typeof connectionStore.connections;

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");

      // Claude 按鈕應有 active 樣式，代表 currentProvider = claude（來源 Pod provider）
      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      expect(claudeBtn?.classes()).toContain("bg-secondary");
      expect(claudeBtn?.classes()).toContain("border-l-2");
    });

    it("Connection summaryProvider 為 gemini 時 currentProvider 應優先取 gemini 而非 Pod provider", async () => {
      const connectionStore = useConnectionStore();
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "gemini-2.5-flash",
          summaryProvider: "gemini",
          aiDecideModel: "sonnet",
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      // 補上 Gemini capability 讓 summaryModelOptions 正常解析
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
            { value: "haiku", label: "Haiku" },
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          ],
        },
      ]);

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");

      // Gemini 按鈕應有 active 樣式
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      expect(geminiBtn?.classes()).toContain("bg-secondary");
      expect(geminiBtn?.classes()).toContain("border-l-2");

      // Claude 按鈕不應有 active 樣式
      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      expect(claudeBtn?.classes()).not.toContain("border-l-2");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("summaryModelOptions 依 currentProvider 動態渲染", () => {
    it("currentProvider 為 gemini 時，Summary Model 子選單應顯示 Gemini 模型", async () => {
      const connectionStore = useConnectionStore();
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "gemini-2.5-flash",
          summaryProvider: "gemini",
          aiDecideModel: "sonnet",
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          ],
        },
      ]);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Gemini 2.5 Flash"))).toBe(true);
      expect(labels.some((l) => l.includes("Gemini 2.5 Pro"))).toBe(true);
      // 不應顯示 Claude 模型
      expect(labels.some((l) => l.includes("Haiku"))).toBe(false);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(false);
    });

    it("connection summaryProvider 切換為 codex 後，Summary Model 子選單應顯示 Codex 模型", async () => {
      const connectionStore = useConnectionStore();
      connectionStore.connections = [
        {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          targetPodId: "pod-target",
          sourceAnchor: "bottom",
          targetAnchor: "top",
          triggerMode: "auto",
          summaryModel: "gpt-5.4",
          summaryProvider: "codex",
          aiDecideModel: "sonnet",
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
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
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("GPT-5.4"))).toBe(true);
      expect(labels.some((l) => l.includes("GPT-4.5"))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Provider 點擊子選單項目 - 成功流程", () => {
    it("點擊 Gemini（非當前 claude）應呼叫 updateConnectionSummaryProvider，含 provider 與該 provider 預設模型", async () => {
      // 設定 Gemini capability，讓 getDefaultModel 能回傳正確預設模型
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
            { value: "haiku", label: "Haiku" },
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          // 第一個模型作為 getDefaultModel 回傳值
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          ],
        },
      ]);

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryProvider: "gemini",
          summaryModel: "gemini-2.5-flash",
        },
      });

      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryProvider");

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");
      await flushPromises();

      // 第一個模型 "gemini-2.5-flash" 為 getDefaultModel 回傳值
      expect(spy).toHaveBeenCalledWith(
        "conn-123",
        "gemini",
        "gemini-2.5-flash",
      );
    });

    it("點擊 Codex（非當前 claude）應呼叫 updateConnectionSummaryProvider，含 codex 預設模型", async () => {
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
            { value: "haiku", label: "Haiku" },
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
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
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryProvider: "codex",
          summaryModel: "gpt-5.4",
        },
      });

      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryProvider");

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "codex", "gpt-5.4");
    });

    it("切換 provider 成功後應顯示成功 toast，title 為 Summary Provider 已切換", async () => {
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
            { value: "haiku", label: "Haiku" },
            { value: "sonnet", label: "Sonnet" },
            { value: "opus", label: "Opus" },
          ],
        },
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          ],
        },
      ]);

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryProvider: "gemini",
          summaryModel: "gemini-2.5-flash",
        },
      });

      const { toasts } = useToast();
      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");
      await flushPromises();

      expect(
        toasts.value.some((t) => t.title === "Summary Provider 已切換"),
      ).toBe(true);
    });

    it("切換 provider 成功後應 emit summary-model-changed（非透過 updateConnectionSummaryModel 路徑）", async () => {
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
          availableModels: [{ value: "sonnet", label: "Sonnet" }],
        },
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          availableModels: [
            { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          ],
        },
      ]);

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryProvider: "gemini",
          summaryModel: "gemini-2.5-flash",
        },
      });

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("summary-model-changed")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊已選中的 provider 不應呼叫 updateConnectionSummaryProvider，直接 emit close", async () => {
      // 當前 connection 的 summaryProvider 為 claude（默認 setupDefaultStoreState）
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionSummaryProvider");

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      await claudeBtn?.trigger("click");
      await flushPromises();

      expect(spy).not.toHaveBeenCalled();
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Provider 失敗流程", () => {
    it("updateConnectionSummaryProvider 失敗時應顯示失敗 toast 且不 emit close", async () => {
      // WS 回傳無 connection 欄位 → store action 回傳 null
      mockCreateWebSocketRequest.mockResolvedValue({});
      const { toasts } = useToast();

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");
      await flushPromises();

      expect(toasts.value.some((t) => t.title === "變更失敗")).toBe(true);
      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Model 子選單（透過 updateConnectionSummaryModel 路徑，非 provider update）", () => {
    it("點擊 Model 子選單項目應呼叫 updateConnectionSummaryModel，不經由 updateConnectionSummaryProvider", async () => {
      const connectionStore = useConnectionStore();
      const modelSpy = vi.spyOn(
        connectionStore,
        "updateConnectionSummaryModel",
      );
      const providerSpy = vi.spyOn(
        connectionStore,
        "updateConnectionSummaryProvider",
      );

      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
          summaryModel: "haiku",
        },
      });

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(modelSpy).toHaveBeenCalledWith("conn-123", "haiku");
      expect(providerSpy).not.toHaveBeenCalled();
    });
  });
});
