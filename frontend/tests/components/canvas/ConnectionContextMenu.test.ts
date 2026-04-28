import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import ConnectionContextMenu from "@/components/canvas/ConnectionContextMenu.vue";

const mockUpdateConnectionTriggerMode = vi.fn();
const mockUpdateConnectionSummaryModel = vi.fn();
const mockUpdateConnectionAiDecideModel = vi.fn();
const mockToast = vi.fn();

/** 模擬上游 Pod 為 Claude provider，使 summaryModelOptions 回傳 Haiku/Sonnet/Opus */
const mockFindConnectionById = vi.fn().mockReturnValue({
  id: "conn-123",
  sourcePodId: "pod-upstream",
  triggerMode: "auto",
  summaryModel: "sonnet",
  aiDecideModel: "sonnet",
});

/** 可在測試中動態調整的 mock 函式，用於切換上游 Pod provider */
const mockGetPodById = vi
  .fn()
  .mockReturnValue({ id: "pod-upstream", provider: "claude" });

/** 可在測試中動態調整的 mock 函式，用於切換上游 provider 的可選模型 */
const mockGetAvailableModels = vi.fn().mockReturnValue([
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
]);

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({
    updateConnectionTriggerMode: mockUpdateConnectionTriggerMode,
    updateConnectionSummaryModel: mockUpdateConnectionSummaryModel,
    updateConnectionAiDecideModel: mockUpdateConnectionAiDecideModel,
    findConnectionById: mockFindConnectionById,
  }),
}));

vi.mock("@/stores/pod/podStore", () => ({
  usePodStore: () => ({
    getPodById: mockGetPodById,
  }),
}));

vi.mock("@/stores/providerCapabilityStore", () => ({
  useProviderCapabilityStore: () => ({
    getAvailableModels: mockGetAvailableModels,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("lucide-vue-next", () => ({
  Zap: { name: "Zap", template: "<svg />" },
  Brain: { name: "Brain", template: "<svg />" },
  ArrowRight: { name: "ArrowRight", template: "<svg />" },
  ChevronRight: { name: "ChevronRight", template: "<svg />" },
}));

const defaultProps = {
  position: { x: 100, y: 200 },
  connectionId: "conn-123",
  currentTriggerMode: "auto" as const,
  currentSummaryModel: "sonnet" as const,
  currentAiDecideModel: "sonnet" as const,
};

function mountMenu(props = {}) {
  return mount(ConnectionContextMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

/** 展開 Summary Model 子選單 */
async function openSummaryMenu(wrapper: ReturnType<typeof mountMenu>) {
  // 找到 relative wrapper（子選單觸發容器）
  const summaryWrapper = wrapper.find(".relative");
  await summaryWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

/** 展開 AI Model 子選單（第二個 .relative 容器） */
async function openAiModelMenu(wrapper: ReturnType<typeof mountMenu>) {
  const relativeWrappers = wrapper.findAll(".relative");
  const aiModelWrapper = relativeWrappers[1]!!;
  await aiModelWrapper.trigger("mouseenter");
  await wrapper.vm.$nextTick();
}

describe("ConnectionContextMenu", () => {
  setupStoreTest();

  // 每次測試前重置為 Claude 預設狀態，避免跨測試干擾
  // setupStoreTest() 會呼叫 vi.clearAllMocks()，因此需在此補回所有 mock 的預設實作
  beforeEach(() => {
    mockFindConnectionById.mockReturnValue({
      id: "conn-123",
      sourcePodId: "pod-upstream",
      triggerMode: "auto",
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    mockGetPodById.mockReturnValue({ id: "pod-upstream", provider: "claude" });
    mockGetAvailableModels.mockReturnValue([
      { value: "haiku", label: "Haiku" },
      { value: "sonnet", label: "Sonnet" },
      { value: "opus", label: "Opus" },
    ]);
  });

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
  });

  describe("點擊不同模型 - 成功流程", () => {
    it("點擊 Haiku（非當前）應呼叫 updateConnectionSummaryModel 並帶正確參數", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionSummaryModel).toHaveBeenCalledWith(
        "conn-123",
        "haiku",
      );
    });

    it("點擊 Opus（非當前）應呼叫 updateConnectionSummaryModel 並帶正確參數", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionSummaryModel).toHaveBeenCalledWith(
        "conn-123",
        "opus",
      );
    });

    it("切換模型成功後應顯示成功 toast", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "總結模型已變更",
          description: "已切換為 Haiku",
        }),
      );
    });

    it("切換至 Opus 成功後應顯示正確 toast description", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "總結模型已變更",
          description: "已切換為 Opus",
        }),
      );
    });

    it("切換模型成功後應 emit summary-model-changed", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("summary-model-changed")).toBeTruthy();
    });

    it("切換模型成功後應 emit close", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("點擊已選中的模型 - 直接關閉", () => {
    it("點擊已選中的 Sonnet 不應呼叫 updateConnectionSummaryModel", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionSummaryModel).not.toHaveBeenCalled();
    });

    it("點擊已選中的模型應直接 emit close", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "haiku" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊已選中的模型不應顯示 toast", async () => {
      const wrapper = mountMenu({ currentSummaryModel: "opus" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const opusBtn = buttons.find((b) => b.text().includes("Opus"));
      await opusBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("切換模型失敗", () => {
    it("updateConnectionSummaryModel 回傳 null 時應顯示失敗 toast", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue(null);
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "變更失敗",
          description: "無法變更總結模型",
        }),
      );
    });

    it("updateConnectionSummaryModel 失敗時不應 emit summary-model-changed", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue(null);
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("summary-model-changed")).toBeFalsy();
    });

    it("updateConnectionSummaryModel 失敗時不應 emit close", async () => {
      mockUpdateConnectionSummaryModel.mockResolvedValue(null);
      const wrapper = mountMenu({ currentSummaryModel: "sonnet" });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

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
        const aiModelWrapper = relativeWrappers[1]!;
        expect(aiModelWrapper.classes()).toContain("opacity-50");
        await openAiModelMenu(wrapper);
        expect(aiModelWrapper.find(".absolute").exists()).toBe(false);
      },
    );
  });

  describe("AI Model 選中狀態標記", () => {
    it("currentAiDecideModel 為 sonnet 時，Sonnet 按鈕應有選中樣式", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);
      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
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
      const aiModelWrapper = relativeWrappers[1]!;
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
      const aiModelWrapper = relativeWrappers[1]!;
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
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      expect(haikuBtn?.classes()).not.toContain("border-l-2");
    });
  });

  describe("AI Model 點擊不同模型 - 成功流程", () => {
    it("點擊 Haiku（非當前）應呼叫 updateConnectionAiDecideModel 並帶正確參數", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionAiDecideModel).toHaveBeenCalledWith(
        "conn-123",
        "haiku",
      );
    });

    it("切換模型成功後應顯示 title 為 AI 決策模型已變更 的 toast", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "AI 決策模型已變更",
        }),
      );
    });

    it("切換模型成功後應 emit ai-decide-model-changed", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("ai-decide-model-changed")).toBeTruthy();
    });

    it("切換模型成功後應 emit close", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("AI Model 點擊已選中的模型 - 直接關閉", () => {
    it("點擊已選中的模型不應呼叫 updateConnectionAiDecideModel", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionAiDecideModel).not.toHaveBeenCalled();
    });

    it("點擊已選中的模型應直接 emit close", async () => {
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "haiku",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("AI Model 切換模型失敗", () => {
    it("updateConnectionAiDecideModel 回傳 null 時應顯示失敗 toast", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue(null);
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "變更失敗",
          description: "無法變更 AI 決策模型",
        }),
      );
    });

    it("updateConnectionAiDecideModel 失敗時不應 emit ai-decide-model-changed", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue(null);
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("ai-decide-model-changed")).toBeFalsy();
    });

    it("updateConnectionAiDecideModel 失敗時不應 emit close", async () => {
      mockUpdateConnectionAiDecideModel.mockResolvedValue(null);
      const wrapper = mountMenu({
        currentTriggerMode: "ai-decide",
        currentAiDecideModel: "sonnet",
      });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  describe("Summary Model 載入中分支", () => {
    it("mockFindConnectionById 回傳 null 時，Summary Model 子選單應顯示載入中", async () => {
      mockFindConnectionById.mockReturnValue(null);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      expect(wrapper.text()).toContain("載入中");
    });

    it("mockGetAvailableModels 回傳空陣列時，Summary Model 子選單應顯示載入中", async () => {
      mockGetAvailableModels.mockReturnValue([]);

      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      expect(wrapper.text()).toContain("載入中");
    });
  });

  describe("Summary Model 子選單依上游 provider 動態渲染", () => {
    it("上游是 Claude 時 Summary Model 子選單應渲染三個 Claude 模型（Haiku/Sonnet/Opus）", async () => {
      // mockGetPodById 與 mockGetAvailableModels 已在 beforeEach 設為 Claude 預設
      const wrapper = mountMenu();
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
    });

    it("上游是 Codex 時 Summary Model 子選單應渲染三個 Codex 模型（GPT-5.4/GPT-5.5/GPT-5.6）", async () => {
      mockGetPodById.mockReturnValue({ id: "pod-upstream", provider: "codex" });
      mockGetAvailableModels.mockReturnValue([
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
        { value: "gpt-5.6", label: "GPT-5.6" },
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
      mockGetPodById.mockReturnValue({ id: "pod-upstream", provider: "codex" });
      mockGetAvailableModels.mockReturnValue([
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
      ]);
      mockUpdateConnectionSummaryModel.mockResolvedValue({ id: "conn-123" });

      const wrapper = mountMenu({ currentSummaryModel: "gpt-5.4" as never });
      await openSummaryMenu(wrapper);

      const buttons = wrapper.findAll("button");
      const gpt55Btn = buttons.find((b) => b.text().includes("GPT-5.5"));
      await gpt55Btn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionSummaryModel).toHaveBeenCalledWith(
        "conn-123",
        "gpt-5.5",
      );
    });

    it("AI Decide Model 子選單在上游是 Claude 時仍只顯示 Claude 三個模型", async () => {
      // beforeEach 已設定 Claude 上游
      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
      const buttons = aiModelWrapper.findAll("button");
      const labels = buttons.map((b) => b.text());
      expect(labels.some((l) => l.includes("Haiku"))).toBe(true);
      expect(labels.some((l) => l.includes("Sonnet"))).toBe(true);
      expect(labels.some((l) => l.includes("Opus"))).toBe(true);
      // 不應有 Codex 模型
      expect(labels.some((l) => l.includes("GPT"))).toBe(false);
    });

    it("AI Decide Model 子選單在上游是 Codex 時仍只顯示 Claude 三個模型（不受 provider 影響）", async () => {
      mockGetPodById.mockReturnValue({ id: "pod-upstream", provider: "codex" });
      mockGetAvailableModels.mockReturnValue([
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
      ]);

      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });
      await openAiModelMenu(wrapper);

      const relativeWrappers = wrapper.findAll(".relative");
      const aiModelWrapper = relativeWrappers[1]!;
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

  describe("Trigger Mode 切換 - 成功流程", () => {
    it("點擊 Direct（非當前 auto）應呼叫 updateConnectionTriggerMode 並帶正確參數", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionTriggerMode).toHaveBeenCalledWith(
        "conn-123",
        "direct",
      );
    });

    it("點擊 ai-decide（非當前 auto）應呼叫 updateConnectionTriggerMode 並帶正確參數", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const aiDecideBtn = buttons.find((b) =>
        b.text().includes("AI 判斷 (AI Decide)"),
      );
      await aiDecideBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionTriggerMode).toHaveBeenCalledWith(
        "conn-123",
        "ai-decide",
      );
    });

    it("切換 trigger mode 成功後應顯示成功 toast", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "觸發模式已變更",
        }),
      );
    });

    it("切換 trigger mode 成功後應 emit trigger-mode-changed", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("trigger-mode-changed")).toBeTruthy();
    });

    it("切換 trigger mode 成功後應 emit close", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue({ id: "conn-123" });
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("Trigger Mode 切換 - 點擊已選中的 mode", () => {
    it("點擊已選中的 auto 不應呼叫 updateConnectionTriggerMode", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const autoBtn = buttons.find((b) => b.text().includes("自動觸發 (Auto)"));
      await autoBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockUpdateConnectionTriggerMode).not.toHaveBeenCalled();
    });

    it("點擊已選中的 mode 應直接 emit close", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "direct" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊已選中的 mode 不應顯示 toast", async () => {
      const wrapper = mountMenu({ currentTriggerMode: "ai-decide" });

      const buttons = wrapper.findAll("button");
      const aiDecideBtn = buttons.find((b) =>
        b.text().includes("AI 判斷 (AI Decide)"),
      );
      await aiDecideBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("Trigger Mode 切換 - 失敗流程", () => {
    it("updateConnectionTriggerMode 失敗時應顯示失敗 toast", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue(null);
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "變更失敗",
          description: "無法變更觸發模式",
        }),
      );
    });

    it("updateConnectionTriggerMode 失敗時不應 emit trigger-mode-changed", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue(null);
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("trigger-mode-changed")).toBeFalsy();
    });

    it("updateConnectionTriggerMode 失敗時不應 emit close", async () => {
      mockUpdateConnectionTriggerMode.mockResolvedValue(null);
      const wrapper = mountMenu({ currentTriggerMode: "auto" });

      const buttons = wrapper.findAll("button");
      const directBtn = buttons.find((b) =>
        b.text().includes("直接觸發 (Direct)"),
      );
      await directBtn?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });
});
