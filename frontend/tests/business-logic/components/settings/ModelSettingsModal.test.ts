import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ModelSettingsModal from "@/components/settings/ModelSettingsModal.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const getConfigMock = vi.fn();
const updateConfigMock = vi.fn();

vi.mock("@/services/configApi", () => ({
  getConfig: () => getConfigMock(),
  updateConfig: (payload: unknown) => updateConfigMock(payload),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
  }),
}));

vi.mock("@/composables/useWebSocketErrorHandler", () => ({
  useWebSocketErrorHandler: () => ({
    withErrorToast: <T>(promise: Promise<T>) => promise,
  }),
}));

const passthroughStub = { template: "<div><slot /></div>" };
const buttonStub = {
  props: ["type", "variant", "disabled"],
  emits: ["click"],
  template: `
    <button
      :type="type"
      :data-variant="variant"
      :disabled="disabled"
      @click="$emit('click', $event)"
    >
      <slot />
    </button>
  `,
};
const selectStub = {
  props: ["modelValue", "disabled"],
  template: `
    <div
      class="select-stub"
      :data-model-value="modelValue ?? ''"
      :data-disabled="disabled ? 'true' : 'false'"
    >
      <slot />
    </div>
  `,
};
const selectItemStub = {
  props: ["value"],
  template: '<div class="select-item-stub" :data-value="value"><slot /></div>',
};
const selectValueStub = {
  props: ["placeholder"],
  template: '<span class="select-value-stub">{{ placeholder }}</span>',
};
const loaderStub = defineComponent({
  setup() {
    return () => h("span", { class: "loader-stub" });
  },
});

function mountModal() {
  return mount(ModelSettingsModal, {
    props: { open: true },
    global: {
      stubs: {
        Button: buttonStub,
        Dialog: passthroughStub,
        DialogContent: passthroughStub,
        DialogDescription: passthroughStub,
        DialogFooter: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        Label: passthroughStub,
        Loader2: loaderStub,
        ScrollArea: passthroughStub,
        Select: selectStub,
        SelectContent: passthroughStub,
        SelectItem: selectItemStub,
        SelectTrigger: passthroughStub,
        SelectValue: selectValueStub,
      },
    },
  });
}

function syncProviderCapabilities(): void {
  const providerCapabilityStore = useProviderCapabilityStore();
  providerCapabilityStore.syncFromPayload([
    {
      name: "claude",
      availableModels: [
        {
          label: "Claude Sonnet 4.5",
          value: "claude-sonnet-4-5",
          thinkingLevels: ["low", "high"],
          thinkingLevelLabels: {
            low: "低",
            high: "高",
          },
          defaultThinkingLevel: "low",
        },
      ],
    },
    {
      name: "codex",
      availableModels: [
        {
          label: "GPT-5.4",
          value: "gpt-5.4",
          thinkingLevels: ["medium"],
          thinkingLevelLabels: {
            medium: "中",
          },
          defaultThinkingLevel: "medium",
        },
      ],
    },
  ]);
  providerCapabilityStore.loaded = true;
}

function selectedValues(wrapper: ReturnType<typeof mountModal>): string[] {
  return wrapper
    .findAll(".select-stub")
    .map((select) => select.attributes("data-model-value") ?? "");
}

function saveButton(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll("button").at(-1);
}

describe("ModelSettingsModal", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    syncProviderCapabilities();
    getConfigMock.mockResolvedValue({
      requestId: "request-1",
      success: true,
      timezoneOffset: 8,
      memoryProvider: "claude",
      memoryModel: "claude-sonnet-4-5",
      memoryThinkingLevel: "high",
      connectionLineProvider: "codex",
      connectionLineModel: "gpt-5.4",
      connectionLineThinkingLevel: "medium",
    });
    updateConfigMock.mockResolvedValue({
      requestId: "request-2",
      success: true,
    });
  });

  it("切換 Model 設定類別時會顯示各自已載入的 provider、model、thinking level", async () => {
    const wrapper = mountModal();

    await flushPromises();

    expect(selectedValues(wrapper)).toEqual([
      "claude",
      "claude-sonnet-4-5",
      "high",
    ]);
    expect(wrapper.text()).toContain("Claude Sonnet 4.5");
    expect(wrapper.text()).toContain("高");
    expect(wrapper.text()).not.toContain("GPT-5.4");
    expect(wrapper.text()).not.toContain("中");

    const connectionLineTab = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Connection Line"));
    expect(connectionLineTab).toBeDefined();
    await connectionLineTab!.trigger("click");

    expect(selectedValues(wrapper)).toEqual(["codex", "gpt-5.4", "medium"]);
    expect(wrapper.text()).toContain("GPT-5.4");
    expect(wrapper.text()).toContain("中");
    expect(wrapper.text()).not.toContain("Claude Sonnet 4.5");
    expect(wrapper.text()).not.toContain("高");
  });

  it("不顯示未設定 provider 選項", async () => {
    const wrapper = mountModal();

    await flushPromises();

    expect(wrapper.text()).not.toContain("Not set");
    expect(wrapper.text()).not.toContain("未設定");
    expect(wrapper.find('[data-value="__provider_unset__"]').exists()).toBe(
      false,
    );
  });

  it("簡化後不顯示整體與分類說明文", async () => {
    const wrapper = mountModal();

    await flushPromises();

    expect(wrapper.text()).not.toContain(
      "設定 Memory 與 Connection Line 使用的統一模型。",
    );
    expect(wrapper.text()).not.toContain("維護記憶內容時使用的模型設定。");
    expect(wrapper.text()).not.toContain(
      "Connection Line 執行時使用的統一模型設定。",
    );
    expect(wrapper.text().match(/Memory/g)?.length ?? 0).toBe(1);
    expect(wrapper.text().match(/Connection Line/g)?.length ?? 0).toBe(1);
  });

  it("載入設定失敗時應停用儲存且不送出舊狀態", async () => {
    getConfigMock.mockResolvedValueOnce(null);
    const wrapper = mountModal();

    await flushPromises();
    await saveButton(wrapper)?.trigger("click");

    expect(saveButton(wrapper)?.attributes("disabled")).toBeDefined();
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("provider 沒有可用 model 時應停用儲存", async () => {
    const providerCapabilityStore = useProviderCapabilityStore();
    providerCapabilityStore.syncFromPayload([
      {
        name: "opencode",
        availableModels: [],
      },
      {
        name: "codex",
        availableModels: [
          {
            label: "GPT-5.4",
            value: "gpt-5.4",
            thinkingLevels: ["medium"],
            defaultThinkingLevel: "medium",
          },
        ],
      },
    ]);
    providerCapabilityStore.loaded = true;
    getConfigMock.mockResolvedValueOnce({
      requestId: "request-1",
      success: true,
      timezoneOffset: 8,
      memoryProvider: "opencode",
      memoryModel: "",
      memoryThinkingLevel: null,
      connectionLineProvider: "codex",
      connectionLineModel: "gpt-5.4",
      connectionLineThinkingLevel: "medium",
    });

    const wrapper = mountModal();

    await flushPromises();
    await saveButton(wrapper)?.trigger("click");

    expect(saveButton(wrapper)?.attributes("disabled")).toBeDefined();
    expect(updateConfigMock).not.toHaveBeenCalled();
  });
});
