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
  currentBranchProvider: "claude" as const,
  currentBranchModel: "sonnet",
};

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ConnectionContextMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

/**
 * DOM 中 .relative 容器的順序（Phase 3B 重構後）：
 *   [0] Summary Provider 子選單
 *   [1] Summary Model 子選單
 * 注意：原本的第 [2] AI Model 子選單已於 Phase 3B 移除，
 * branchModel 現在透過 ProviderModelSelector 元件管理（branch 面板內）。
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

/**
 * 展開 Branch Model 子選單；triggerMode === "branch" 時 .relative 順序為：
 *   [0] Branch Provider, [1] Branch Model, [2] Summary Provider, [3] Summary Model。
 */
async function openBranchModelMenu(wrapper: ReturnType<typeof mountMenu>) {
  const branchModelWrapper = wrapper.findAll(".relative")[1]!;
  await branchModelWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

/** 展開 Branch Provider 子選單（branch mode 下 .relative[0]） */
async function openBranchProviderMenu(wrapper: ReturnType<typeof mountMenu>) {
  const branchProviderWrapper = wrapper.findAll(".relative")[0]!;
  await branchProviderWrapper.trigger("mouseenter");
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
      summaryProvider: "claude",
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

    it("summaryProvider=codex 且 currentSummaryModel=gpt-5.4 時，GPT-5.4 按鈕應有選中樣式，其他 Codex 模型沒有", async () => {
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
            mcp: false,
            goal: true,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);

      const wrapper = mountMenu({ currentSummaryModel: "gpt-5.4" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");

      const currentBtn = buttons.find((b) => b.text().includes("GPT-5.4"));
      expect(currentBtn?.classes()).toContain("border-l-2");

      const otherBtn = buttons.find((b) => b.text().includes("GPT-4.5"));
      expect(otherBtn?.classes()).not.toContain("border-l-2");
    });

    it("summaryProvider=codex 但 currentSummaryModel 為 claude 模型（跨 provider）時，沒有任何 Codex model 按鈕應有選中樣式", async () => {
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
          summaryProvider: "codex",
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
            mcp: false,
            goal: true,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);

      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);
      const buttons = wrapper.findAll("button");

      const modelButtons = buttons.filter((b) => b.text().includes("GPT-"));
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
  // Phase 3B 重構說明：
  // 舊版的「AI Model」子選單（作為第三個 .relative 容器）已被移除。
  // branchModel 現在透過 ProviderModelSelector 元件在 Branch 設定面板中管理。
  // Branch 設定面板只在 currentTriggerMode === 'branch' 時顯示。
  // 以下測試已依新架構對齊。

  describe("Branch 設定面板 - Provider/Model 子選單渲染", () => {
    it("triggerMode 為 branch 時，hover Branch Model 子選單應顯示 Claude 的模型選項", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const text = wrapper.text();
      expect(text).toContain("Haiku");
      expect(text).toContain("Sonnet");
      expect(text).toContain("Opus");
    });

    it("triggerMode 為 auto 時，Branch 設定面板不應顯示", () => {
      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      expect(wrapper.text()).not.toContain("Branch Provider");
    });

    it("triggerMode 為 direct 時，Branch 設定面板不應顯示", () => {
      const wrapper = mountMenu({ currentTriggerMode: "direct" });
      expect(wrapper.text()).not.toContain("Branch Provider");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Branch Model 選中狀態標記（透過 hover 子選單）", () => {
    it("currentBranchModel 為 sonnet 時，Sonnet 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      expect(sonnetBtn?.classes()).toContain("bg-secondary");
      expect(sonnetBtn?.classes()).toContain("border-l-2");
    });

    it("currentBranchModel 為 haiku 時，Haiku 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "haiku",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).toContain("bg-secondary");
      expect(haikuBtn?.classes()).toContain("border-l-2");
    });

    it("currentBranchModel 為 opus 時，Opus 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "opus",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      expect(opusBtn?.classes()).toContain("bg-secondary");
      expect(opusBtn?.classes()).toContain("border-l-2");
    });

    it("currentBranchModel 為 sonnet 時，Haiku 按鈕不應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).not.toContain("border-l-2");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Branch Model 點擊不同模型 - 成功流程", () => {
    it("點擊 Haiku（非當前）應呼叫 updateConnectionBranchModel 並帶正確參數", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionBranchModel");
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("conn-123", "haiku");
    });

    it("切換模型成功後應 emit branch-model-changed", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({
        connection: {
          id: "conn-123",
          sourcePodId: "pod-upstream",
          sourceAnchor: "bottom",
          targetPodId: "pod-target",
          targetAnchor: "top",
        },
      });

      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("branch-model-changed")).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Branch Model 點擊已選中的模型 - 不呼叫 store", () => {
    it("點擊已選中的模型不應呼叫 updateConnectionBranchModel", async () => {
      const connectionStore = useConnectionStore();
      const spy = vi.spyOn(connectionStore, "updateConnectionBranchModel");

      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");
      await flushPromises();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Branch Model 切換模型失敗", () => {
    it("updateConnectionBranchModel 回傳 null 時不應 emit branch-model-changed", async () => {
      mockCreateWebSocketRequest.mockResolvedValue({});

      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await flushPromises();

      expect(wrapper.emitted("branch-model-changed")).toBeFalsy();
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
            mcp: false,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-5.5", label: "GPT-5.5" },
            { value: "gpt-5.6", label: "GPT-5.6" },
          ],
        },
      ]);

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
          status: "idle",
        },
      ] as typeof connectionStore.connections;

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
            mcp: false,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-5.5", label: "GPT-5.5" },
          ],
        },
      ]);

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
          status: "idle",
        },
      ] as typeof connectionStore.connections;
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

    it("Branch Provider=claude 時，hover Branch Model 子選單應顯示 Claude 三個模型", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
      expect(labels.some((l) => l.includes("GPT"))).toBe(false);
    });

    it("Branch Provider=codex 時，hover Branch Model 子選單應顯示 Codex 模型", async () => {
      // Phase 3B 後 branchProvider 可獨立選擇（不再鎖定 Claude）
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
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
            mcp: false,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-5.5", label: "GPT-5.5" },
          ],
        },
      ]);

      const wrapper = mountMenu({
        currentTriggerMode: "branch",
        currentBranchProvider: "codex",
        currentBranchModel: "gpt-5.4",
      });
      await openBranchModelMenu(wrapper);
      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("GPT-5.4"))).toBe(true);
      expect(labels.some((l) => l.includes("GPT-5.5"))).toBe(true);
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

    it("I1 - 點擊 Branch 應 emit branch-mode-clicked（不直接切換 triggerMode，由 modal 流程處理）", async () => {
      const connectionStore = useConnectionStore();
      const triggerSpy = vi.spyOn(
        connectionStore,
        "updateConnectionTriggerMode",
      );

      const wrapper = mountMenu({ currentTriggerMode: "auto" });
      const buttons = wrapper.findAll("button");
      const branchBtn = buttons.find((b) =>
        b.text().includes("Branch 判斷 (Branch)"),
      );
      await branchBtn?.trigger("click");
      await flushPromises();

      // 點擊 Branch 不應直接呼叫 updateConnectionTriggerMode（改由 BranchEditModal 提交時送出合併更新）
      expect(triggerSpy).not.toHaveBeenCalled();
      // 應 emit branch-mode-clicked 讓 host 開啟 BranchEditModal
      expect(wrapper.emitted("branch-mode-clicked")).toBeTruthy();
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

      const wrapper = mountMenu({ currentTriggerMode: "branch" });
      const buttons = wrapper.findAll("button");
      const branchDecideBtn = buttons.find((b) =>
        b.text().includes("Branch 判斷 (Branch)"),
      );
      await branchDecideBtn?.trigger("click");
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

    it("展開後應顯示 Claude / Codex 兩個 provider 選項", async () => {
      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const labels = buttons.map((b) => b.text());

      expect(labels.some((l) => l.includes("Claude"))).toBe(true);
      expect(labels.some((l) => l.includes("Codex"))).toBe(true);
      expect(labels.some((l) => l.includes("Gemini"))).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("Summary Provider currentProvider 計算邏輯", () => {
    it("舊 Connection（summaryProvider 為 undefined）時不再 UI fallback，應顯示未就緒狀態", async () => {
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
          status: "idle",
          // summaryProvider 刻意不設定，模擬舊 Connection
        },
      ] as typeof connectionStore.connections;

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      expect(providerWrapper.text()).toContain("載入中");

      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      expect(claudeBtn?.classes()).not.toContain("bg-secondary");
      expect(claudeBtn?.classes()).not.toContain("border-l-2");
    });

    it("Connection summaryProvider 為 codex 時 currentProvider 應優先取 codex 而非 Pod provider", async () => {
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
          status: "idle",
        },
      ] as typeof connectionStore.connections;

      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
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
            mcp: false,
            goal: true,
          },
          availableModels: [
            { value: "gpt-5.4", label: "GPT-5.4" },
            { value: "gpt-4.5", label: "GPT-4.5" },
          ],
        },
      ]);

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");

      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      expect(codexBtn?.classes()).toContain("bg-secondary");
      expect(codexBtn?.classes()).toContain("border-l-2");

      // Claude 按鈕不應有 active 樣式
      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      expect(claudeBtn?.classes()).not.toContain("border-l-2");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("summaryModelOptions 依 currentProvider 動態渲染", () => {
    it("currentProvider 為 codex 時，Summary Model 子選單應顯示 Codex 模型", async () => {
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
            mcp: false,
            goal: true,
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
    it("點擊 Codex（非當前 claude）應呼叫 updateConnectionSummaryProvider，含 codex 預設模型", async () => {
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
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
            mcp: false,
            goal: true,
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
            mcp: false,
            goal: true,
          },
          availableModels: [{ value: "gpt-5.4", label: "GPT-5.4" }],
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

      const { toasts } = useToast();
      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");
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
            mcp: true,
          },
          availableModels: [{ value: "sonnet", label: "Sonnet" }],
        },
        {
          name: "codex",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            mcp: false,
            goal: true,
          },
          availableModels: [{ value: "gpt-5.4", label: "GPT-5.4" }],
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

      const wrapper = mountMenu();
      await openProviderMenu(wrapper);

      const providerWrapper = wrapper.findAll(".relative")[0]!;
      const buttons = providerWrapper.findAll("button");
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");
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
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");
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
