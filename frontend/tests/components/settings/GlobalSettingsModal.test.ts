import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import GlobalSettingsModal from "@/components/settings/GlobalSettingsModal.vue";

// Mock UI 元件
vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open"><slot /></div>',
  },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
  DialogFooter: { name: "DialogFooter", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["disabled"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    emits: ["click"],
  },
}));

vi.mock("@/components/ui/label", () => ({
  Label: { name: "Label", template: "<label><slot /></label>" },
}));

vi.mock("@/components/ui/select", () => ({
  Select: {
    name: "Select",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<div class="select-mock" :data-value="modelValue"><slot /></div>',
  },
  SelectTrigger: { name: "SelectTrigger", template: "<div><slot /></div>" },
  SelectValue: {
    name: "SelectValue",
    props: ["placeholder"],
    template: "<span></span>",
  },
  SelectContent: { name: "SelectContent", template: "<div><slot /></div>" },
  SelectItem: {
    name: "SelectItem",
    props: ["value"],
    template: '<div :data-value="value"><slot /></div>',
  },
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: {
    name: "Switch",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<button class="switch-mock" :data-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: {
    name: "ScrollArea",
    template: "<div><slot /></div>",
  },
}));

// 使用 vi.hoisted 確保 mock 在 vi.mock 中可用
const { mockGetConfig, mockUpdateConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockUpdateConfig: vi.fn(),
}));

vi.mock("@/services/configApi", () => ({
  getConfig: mockGetConfig,
  updateConfig: mockUpdateConfig,
}));

// 使用 vi.hoisted 確保 mock 在 vi.mock 中可用
const { mockListPlugins } = vi.hoisted(() => ({
  mockListPlugins: vi.fn(),
}));

vi.mock("@/services/pluginApi", () => ({
  listPlugins: mockListPlugins,
}));

// 使用 vi.hoisted 確保 mock 在 vi.mock 中可用
const { mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
    toast: vi.fn(),
  }),
}));

// 使用 vi.hoisted 確保 mock 在 vi.mock 中可用
const { mockWithErrorToast } = vi.hoisted(() => ({
  mockWithErrorToast: vi.fn(),
}));

vi.mock("@/composables/useWebSocketErrorHandler", () => ({
  useWebSocketErrorHandler: () => ({
    withErrorToast: mockWithErrorToast,
    handleWebSocketError: vi.fn(),
    wrapWebSocketRequest: vi.fn(),
  }),
}));

function mountModal(open = true) {
  return mount(GlobalSettingsModal, {
    props: { open },
  });
}

describe("GlobalSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 預設 withErrorToast 直接執行 promise 並回傳結果
    mockWithErrorToast.mockImplementation((promise: Promise<unknown>) =>
      promise.catch(() => null),
    );
    // 預設 listPlugins 回傳空陣列
    mockListPlugins.mockResolvedValue([]);
  });

  it("應正確渲染 Modal 標題與兩個模型選擇區塊", async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    const wrapper = mountModal(true);
    await nextTick();

    expect(wrapper.text()).toContain("全域設定");
    expect(wrapper.text()).toContain("管理模型與全域參數設定");
    expect(wrapper.text()).toContain("總結模型");
    expect(wrapper.text()).toContain("AI 決策模型");

    wrapper.unmount();
  });

  it("開啟時應發送 config:get WebSocket 事件載入目前設定", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "opus",
      aiDecideModel: "haiku",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    expect(mockGetConfig).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("載入設定後應正確顯示目前選擇的模型", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "opus",
      aiDecideModel: "haiku",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAll(".select-mock");
    expect(selects[0]?.attributes("data-value")).toBe("opus");
    expect(selects[1]?.attributes("data-value")).toBe("haiku");

    wrapper.unmount();
  });

  it("切換總結模型後應更新本地狀態", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAllComponents({ name: "Select" });
    await selects[0]?.vm.$emit("update:modelValue", "haiku");
    await nextTick();

    expect(selects[0]?.props("modelValue")).toBe("haiku");

    wrapper.unmount();
  });

  it("切換 AI 決策模型後應更新本地狀態", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAllComponents({ name: "Select" });
    await selects[1]?.vm.$emit("update:modelValue", "opus");
    await nextTick();

    expect(selects[1]?.props("modelValue")).toBe("opus");

    wrapper.unmount();
  });

  it("點擊儲存應發送 config:update WebSocket 事件並傳送正確 payload", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    mockUpdateConfig.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const button = wrapper.find("button");
    await button.trigger("click");
    await nextTick();

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: [],
    });

    wrapper.unmount();
  });

  it("儲存成功後應關閉 Modal 並顯示成功 Toast", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    mockUpdateConfig.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const button = wrapper.find("button");
    await button.trigger("click");
    await nextTick();
    await nextTick();

    expect(mockShowSuccessToast).toHaveBeenCalledWith("Config", "儲存成功");
    expect(wrapper.emitted("update:open")).toBeTruthy();
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);

    wrapper.unmount();
  });

  it("儲存失敗時不應關閉 Modal 且儲存按鈕可再次點擊", async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    // 第一次 withErrorToast 是 loadConfig（成功），第二次是 handleSave（失敗回傳 null）
    mockWithErrorToast
      .mockImplementationOnce((promise: Promise<unknown>) => promise)
      .mockImplementationOnce(() => Promise.resolve(null));

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const button = wrapper.find("button");
    await button.trigger("click");
    await nextTick();
    await nextTick();

    expect(mockShowSuccessToast).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toBeFalsy();
    // isSaving 被重置，儲存按鈕不應被禁用
    expect(button.attributes("disabled")).toBeUndefined();

    wrapper.unmount();
  });

  it("載入中狀態應禁用儲存按鈕", async () => {
    let resolveGetConfig!: (value: unknown) => void;
    const getConfigPromise = new Promise((resolve) => {
      resolveGetConfig = resolve;
    });
    mockGetConfig.mockReturnValue(getConfigPromise);
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );

    const wrapper = mountModal(true);
    await nextTick();

    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();

    resolveGetConfig({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    await nextTick();
    await nextTick();

    wrapper.unmount();
  });

  it("儲存中狀態應禁用儲存按鈕並顯示載入文字", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    let resolveUpdate!: (value: unknown) => void;
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    mockUpdateConfig.mockReturnValue(updatePromise);

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const button = wrapper.find("button");
    await button.trigger("click");
    await nextTick();

    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("儲存中");

    resolveUpdate({ success: true });
    await nextTick();
    await nextTick();

    wrapper.unmount();
  });

  it("應呼叫 listPlugins 並在載入後顯示 Plugin 列表", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: [],
    });
    mockListPlugins.mockResolvedValue([
      {
        id: "plugin-1",
        name: "My Plugin",
        version: "1.0.0",
        description: "測試 Plugin",
      },
    ]);

    const wrapper = mountModal(true);
    await flushPromises();

    expect(mockListPlugins).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("My Plugin");
    expect(wrapper.text()).toContain("1.0.0");

    wrapper.unmount();
  });

  it("getConfig 回傳 enabledPluginIds，開關初始狀態應正確", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: ["plugin-1"],
    });
    mockListPlugins.mockResolvedValue([
      {
        id: "plugin-1",
        name: "Plugin A",
        version: "1.0.0",
        description: "",
      },
      {
        id: "plugin-2",
        name: "Plugin B",
        version: "2.0.0",
        description: "",
      },
    ]);

    const wrapper = mountModal(true);
    await flushPromises();

    const switches = wrapper.findAll(".switch-mock");
    expect(switches[0]?.attributes("data-checked")).toBe("true");
    expect(switches[1]?.attributes("data-checked")).toBeOneOf([
      "false",
      undefined,
    ]);

    wrapper.unmount();
  });

  it("模擬切換開關，enabledPluginIds 應正確更新", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: [],
    });
    mockListPlugins.mockResolvedValue([
      {
        id: "plugin-1",
        name: "Plugin A",
        version: "1.0.0",
        description: "",
      },
    ]);

    const wrapper = mountModal(true);
    await flushPromises();

    const switchComp = wrapper.findComponent({ name: "Switch" });
    expect(switchComp.props("modelValue")).toBe(false);

    await switchComp.vm.$emit("update:modelValue", true);
    await nextTick();

    expect(switchComp.props("modelValue")).toBe(true);

    wrapper.unmount();
  });

  it("listPlugins 回傳空陣列，應顯示空狀態提示", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    mockListPlugins.mockResolvedValue([]);

    const wrapper = mountModal(true);
    await flushPromises();

    expect(wrapper.text()).toContain(
      "尚未安裝任何 Plugin，請透過 Claude Code CLI 安裝",
    );

    wrapper.unmount();
  });

  it("點擊儲存時應送出包含正確 enabledPluginIds 的 payload", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: ["plugin-1"],
    });
    mockListPlugins.mockResolvedValue([
      {
        id: "plugin-1",
        name: "Plugin A",
        version: "1.0.0",
        description: "",
      },
      {
        id: "plugin-2",
        name: "Plugin B",
        version: "2.0.0",
        description: "",
      },
    ]);
    mockUpdateConfig.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await flushPromises();

    // 啟用 plugin-2
    const switches = wrapper.findAllComponents({ name: "Switch" });
    await switches[1]?.vm.$emit("update:modelValue", true);
    await nextTick();

    // 使用 Button 元件找到儲存按鈕（避免與 Switch 按鈕混淆）
    const saveButton = wrapper.findComponent({ name: "Button" });
    await saveButton.trigger("click");
    await nextTick();

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      enabledPluginIds: ["plugin-1", "plugin-2"],
    });

    wrapper.unmount();
  });
});
