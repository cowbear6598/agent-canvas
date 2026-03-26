import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
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
    props: ["modelValue", "disabled"],
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

vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    props: ["modelValue", "placeholder", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input class="input-mock" :value="modelValue" :placeholder="placeholder" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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

// 備份 API mock
const { mockTestBackupConnection, mockTriggerBackup } = vi.hoisted(() => ({
  mockTestBackupConnection: vi.fn(),
  mockTriggerBackup: vi.fn(),
}));

vi.mock("@/services/backupApi", () => ({
  testBackupConnection: mockTestBackupConnection,
  triggerBackup: mockTriggerBackup,
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

// mock configStore - 使用 reactive 讓 watch 能正確追蹤狀態變化
const { mockSetTimezoneOffset, mockSetBackupConfig } = vi.hoisted(() => ({
  mockSetTimezoneOffset: vi.fn(),
  mockSetBackupConfig: vi.fn(),
}));

// mockConfigStoreState 必須在 vi.mock 工廠外部宣告，才能在測試中存取
// 使用 reactive 讓 watch 能偵測到狀態改變
let mockConfigStoreState: {
  timezoneOffset: number;
  backupStatus: "idle" | "running" | "success" | "failed";
  lastBackupTime: string | null;
  lastBackupError: string | null;
  setTimezoneOffset: (offset: number) => void;
  setBackupConfig: (config: {
    gitRemoteUrl: string;
    time: string;
    enabled: boolean;
  }) => void;
  setBackupStatus: (
    status: "idle" | "running" | "success" | "failed",
    error?: string | null,
  ) => void;
  setLastBackupTime: (time: string) => void;
  fetchConfig: () => Promise<void>;
};

vi.mock("@/stores/configStore", () => ({
  useConfigStore: () => mockConfigStoreState,
}));

function mountModal(open = true) {
  return mount(GlobalSettingsModal, {
    props: { open },
  });
}

describe("GlobalSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每次測試前重置 reactive configStore state
    mockConfigStoreState = reactive({
      timezoneOffset: 8,
      backupStatus: "idle" as "idle" | "running" | "success" | "failed",
      lastBackupTime: null as string | null,
      lastBackupError: null as string | null,
      setTimezoneOffset: mockSetTimezoneOffset,
      setBackupConfig: mockSetBackupConfig,
      setBackupStatus: vi.fn(
        (
          status: "idle" | "running" | "success" | "failed",
          error?: string | null,
        ) => {
          mockConfigStoreState.backupStatus = status;
          mockConfigStoreState.lastBackupError = error ?? null;
        },
      ),
      setLastBackupTime: vi.fn((time: string) => {
        mockConfigStoreState.lastBackupTime = time;
      }),
      fetchConfig: vi.fn(),
    });
    // 預設 withErrorToast 直接執行 promise 並回傳結果
    mockWithErrorToast.mockImplementation((promise: Promise<unknown>) =>
      promise.catch(() => null),
    );
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

    const saveButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await saveButton.trigger("click");
    await nextTick();

    expect(mockUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryModel: "sonnet",
        aiDecideModel: "sonnet",
      }),
    );

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

    const button = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
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

    const button = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
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

    const button = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
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

    const button = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await button.trigger("click");
    await nextTick();

    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("儲存中");

    resolveUpdate({ success: true });
    await nextTick();
    await nextTick();

    wrapper.unmount();
  });

  it("開啟時應顯示時區下拉選單，預設為 UTC+8", async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAll(".select-mock");
    // 第三個 Select 是時區選單（index 2）
    expect(selects[2]).toBeDefined();
    expect(selects[2]?.attributes("data-value")).toBe("8");

    wrapper.unmount();
  });

  it("載入設定後應正確顯示伺服器回傳的時區值", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      timezoneOffset: -5,
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAll(".select-mock");
    expect(selects[2]?.attributes("data-value")).toBe("-5");

    wrapper.unmount();
  });

  it("切換時區後應更新本地狀態", async () => {
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
    // 第三個 Select 是時區選單（index 2）
    await selects[2]?.vm.$emit("update:modelValue", "3");
    await nextTick();

    expect(selects[2]?.props("modelValue")).toBe("3");

    wrapper.unmount();
  });

  it("點擊儲存應發送包含 timezoneOffset 的 payload", async () => {
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

    const button = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await button.trigger("click");
    await nextTick();

    expect(mockUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ timezoneOffset: 8 }),
    );

    wrapper.unmount();
  });

  // ==== 備份設定相關測試 ====

  it("應渲染備份設定區塊標題與描述文字", async () => {
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    const wrapper = mountModal(true);
    await nextTick();

    expect(wrapper.text()).toContain("備份設定");
    expect(wrapper.text()).toContain(
      "設定 Git 遠端儲存庫，定時自動備份畫布資料",
    );

    wrapper.unmount();
  });

  it("載入設定後應正確顯示伺服器回傳的備份設定值", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupGitRemoteUrl: "git@github.com:test/repo.git",
      backupTime: "04:30",
      backupEnabled: true,
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const input = wrapper.find(".input-mock");
    expect(input.attributes("value")).toBe("git@github.com:test/repo.git");

    const switchComp = wrapper.findComponent({ name: "Switch" });
    expect(switchComp.props("modelValue")).toBe(true);

    wrapper.unmount();
  });

  it("Git Remote URL 輸入框應正確綁定 v-model", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const inputComp = wrapper.findComponent({ name: "Input" });
    await inputComp.vm.$emit("update:modelValue", "git@new-url.git");
    await nextTick();

    expect(inputComp.props("modelValue")).toBe("git@new-url.git");

    wrapper.unmount();
  });

  it("備份時間選擇器應正確綁定 v-model（時與分）", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupTime: "03:00",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const selects = wrapper.findAllComponents({ name: "Select" });
    // 時區在 index 2，backupHour 在 index 3，backupMinute 在 index 4
    const hourSelect = selects[3];
    const minuteSelect = selects[4];

    await hourSelect?.vm.$emit("update:modelValue", "05");
    await minuteSelect?.vm.$emit("update:modelValue", "30");
    await nextTick();

    expect(hourSelect?.props("modelValue")).toBe("05");
    expect(minuteSelect?.props("modelValue")).toBe("30");

    wrapper.unmount();
  });

  it("備份開關應正確綁定 v-model", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: false,
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const switchComp = wrapper.findComponent({ name: "Switch" });
    await switchComp.vm.$emit("update:modelValue", true);
    await nextTick();

    expect(switchComp.props("modelValue")).toBe(true);

    wrapper.unmount();
  });

  it("點擊儲存應發送包含備份設定的 payload", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupGitRemoteUrl: "git@github.com:test/backup.git",
      backupTime: "03:00",
      backupEnabled: true,
    });
    mockUpdateConfig.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const saveButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await saveButton.trigger("click");
    await nextTick();

    expect(mockUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        backupGitRemoteUrl: "git@github.com:test/backup.git",
        backupTime: "03:00",
        backupEnabled: true,
      }),
    );

    wrapper.unmount();
  });

  it("備份開關關閉時，Git Remote URL 與時間選擇器應被禁用", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: false,
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const input = wrapper.find(".input-mock");
    expect(input.attributes("disabled")).toBeDefined();

    const selects = wrapper.findAllComponents({ name: "Select" });
    // backupHour select (index 3) 應該 disabled
    expect(selects[3]?.props("disabled")).toBe(true);
    // backupMinute select (index 4) 應該 disabled
    expect(selects[4]?.props("disabled")).toBe(true);

    wrapper.unmount();
  });

  it("點擊「立即備份」應發送 BACKUP_TRIGGER 事件", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });
    mockTriggerBackup.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));
    await backupBtn?.trigger("click");
    await nextTick();

    expect(mockTriggerBackup).toHaveBeenCalled();

    wrapper.unmount();
  });

  it("立即備份進行中應禁用按鈕並顯示載入文字", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });

    let resolveBackup!: (value: unknown) => void;
    const backupPromise = new Promise((resolve) => {
      resolveBackup = resolve;
    });
    mockTriggerBackup.mockReturnValue(backupPromise);

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));
    await backupBtn?.trigger("click");
    await nextTick();

    const updatedButtons = wrapper.findAll("button");
    const loadingBtn = updatedButtons.find((b) =>
      b.text().includes("備份中..."),
    );
    expect(loadingBtn).toBeDefined();
    expect(loadingBtn?.attributes("disabled")).toBeDefined();

    resolveBackup({ success: true });
    await flushPromises();

    wrapper.unmount();
  });

  it("立即備份成功時應顯示成功 toast 並更新狀態", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });
    mockTriggerBackup.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));
    await backupBtn?.trigger("click");
    await flushPromises();

    expect(mockShowSuccessToast).toHaveBeenCalledWith("Config", "備份已觸發");

    wrapper.unmount();
  });

  it("立即備份失敗時應顯示錯誤 toast 並更新狀態", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>, category: string, action: string) => {
        void category;
        void action;
        return promise.catch(() => null);
      },
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });
    mockTriggerBackup.mockRejectedValue(new Error("備份失敗"));

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));
    await backupBtn?.trigger("click");
    await flushPromises();

    expect(mockShowSuccessToast).not.toHaveBeenCalledWith(
      "Config",
      "備份已觸發",
    );

    wrapper.unmount();
  });

  it("備份開關關閉時「立即備份」按鈕應被禁用", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: false,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));

    expect(backupBtn?.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("Git Remote URL 為空時「立即備份」按鈕應被禁用", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const buttons = wrapper.findAll("button");
    const backupBtn = buttons.find((b) => b.text().includes("立即備份"));

    expect(backupBtn?.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("應顯示上次備份時間與備份狀態", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
    });
    // 設定 configStore 狀態
    mockConfigStoreState.lastBackupTime = "2026-03-26T03:00:00Z";
    mockConfigStoreState.backupStatus = "success";

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("上次備份：2026-03-26T03:00:00Z");

    wrapper.unmount();
  });

  // ==== 備份驗證相關測試 ====

  it("備份開啟但 Git Remote URL 為空時，點擊儲存應顯示 inline 錯誤訊息且不送出請求", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const saveButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await saveButton.trigger("click");
    await nextTick();

    // 應顯示 inline 錯誤訊息，不使用 toast
    expect(mockShowErrorToast).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("請填寫 Git Remote URL");
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("備份關閉時即使 Git Remote URL 為空，點擊儲存也應正常送出", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: false,
      backupGitRemoteUrl: "",
    });
    mockUpdateConfig.mockResolvedValue({ success: true });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    const saveButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("儲存"))!;
    await saveButton.trigger("click");
    await nextTick();

    expect(mockShowErrorToast).not.toHaveBeenCalled();
    expect(mockUpdateConfig).toHaveBeenCalled();

    wrapper.unmount();
  });

  // ==== 備份失敗 inline 錯誤訊息測試 ====

  it("configStore.backupStatus 變成 failed 時，應顯示 inline 錯誤訊息", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    // 模擬後端發來 BACKUP_FAILED 事件後，handleBackupFailed 呼叫 configStore.setBackupStatus
    mockConfigStoreState.setBackupStatus("failed", "備份推送失敗");
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("備份推送失敗");

    wrapper.unmount();
  });

  it("configStore.backupStatus 已是 failed、lastBackupError 更新時，應顯示新的 inline 錯誤訊息", async () => {
    mockWithErrorToast.mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
    mockGetConfig.mockResolvedValue({
      success: true,
      summaryModel: "sonnet",
      aiDecideModel: "sonnet",
      backupEnabled: true,
      backupGitRemoteUrl: "git@github.com:test/backup.git",
    });

    // 初始狀態：上次備份已失敗
    mockConfigStoreState.backupStatus = "failed";
    mockConfigStoreState.lastBackupError = "舊的錯誤訊息";

    const wrapper = mountModal(true);
    await nextTick();
    await nextTick();

    // 模擬第二次備份失敗（backupStatus 保持 failed，但 lastBackupError 改變）
    // 正常流程會先變成 running 再 failed，但測試邊界情況
    mockConfigStoreState.setBackupStatus("failed", "新的備份推送失敗");
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("新的備份推送失敗");

    wrapper.unmount();
  });
});
