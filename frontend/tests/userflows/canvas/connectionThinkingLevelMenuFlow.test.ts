import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummarySection from "@/components/canvas/connectionMenu/SummarySection.vue";
import BranchSettingsPanel from "@/components/canvas/connectionMenu/BranchSettingsPanel.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";
import { createMockConnection } from "@tests/helpers/factories";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.model ?? params?.provider ?? key,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

function setupThinkingCapabilities(): void {
  const capabilityStore = useProviderCapabilityStore();
  capabilityStore.syncFromPayload([
    {
      name: "claude",
      availableModels: [
        {
          label: "Sonnet",
          value: "sonnet",
          thinkingLevels: ["low", "medium", "high"],
          thinkingLevelLabels: {
            low: "Low",
            medium: "Medium",
            high: "High",
          },
          defaultThinkingLevel: "medium",
        },
        {
          label: "Haiku",
          value: "haiku",
        },
      ],
    },
  ]);
}

describe("connection thinking level 選單流程", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    setupThinkingCapabilities();
  });

  it("使用者能在 summary 區塊選擇 summary thinking level", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "sonnet",
        summaryThinkingLevel: "medium",
      }),
    ];
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionSummaryThinkingLevel")
      .mockResolvedValue(connectionStore.connections[0] ?? null);

    const wrapper = mount(SummarySection, {
      props: {
        connectionId: "conn-1",
        currentSummaryModel: "sonnet",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const thinkingButton = wrapper
      .findAll("button")
      .find((button) =>
        button.text().includes("summaryThinkingLevel"),
      );
    thinkingButton?.element.parentElement?.dispatchEvent(
      new Event("mouseenter"),
    );
    await nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "High")
      ?.trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("conn-1", "high");
  });

  it("summary thinking level 未寫入時，選單會把模型預設值標成已選", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "sonnet",
        summaryThinkingLevel: null,
      }),
    ];

    const wrapper = mount(SummarySection, {
      props: {
        connectionId: "conn-1",
        currentSummaryModel: "sonnet",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const thinkingButton = wrapper
      .findAll("button")
      .find((button) =>
        button.text().includes("summaryThinkingLevel"),
      );
    thinkingButton?.element.parentElement?.dispatchEvent(
      new Event("mouseenter"),
    );
    await nextTick();

    const mediumButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Medium");

    expect(mediumButton?.classes()).toContain("border-l-primary");
  });

  it("summary thinking level 未寫入時，點擊模型預設值會寫回 connection", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "sonnet",
        summaryThinkingLevel: null,
      }),
    ];
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionSummaryThinkingLevel")
      .mockResolvedValue(connectionStore.connections[0] ?? null);

    const wrapper = mount(SummarySection, {
      props: {
        connectionId: "conn-1",
        currentSummaryModel: "sonnet",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const thinkingButton = wrapper
      .findAll("button")
      .find((button) =>
        button.text().includes("summaryThinkingLevel"),
      );
    thinkingButton?.element.parentElement?.dispatchEvent(
      new Event("mouseenter"),
    );
    await nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Medium")
      ?.trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("conn-1", "medium");
  });

  it("使用者能在 branch 模式選擇 branch thinking level", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        triggerMode: "branch",
        branchProvider: "claude",
        branchModel: "sonnet",
        branchThinkingLevel: "low",
      }),
    ];
    const updateSpy = vi
      .spyOn(connectionStore, "updateConnectionBranchThinkingLevel")
      .mockResolvedValue(connectionStore.connections[0] ?? null);

    const wrapper = mount(BranchSettingsPanel, {
      props: {
        connectionId: "conn-1",
        currentBranchProvider: "claude",
        currentBranchModel: "sonnet",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const thinkingButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("branchThinkingLevel"));
    thinkingButton?.element.parentElement?.dispatchEvent(
      new Event("mouseenter"),
    );
    await nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Medium")
      ?.trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("conn-1", "medium");
  });

  it("branch model 尚未寫入時，選單會使用 provider 第一個模型的預設 thinking level", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        triggerMode: "branch",
        branchProvider: "claude",
        branchModel: undefined,
        branchThinkingLevel: null,
      }),
    ];

    const wrapper = mount(BranchSettingsPanel, {
      props: {
        connectionId: "conn-1",
        currentBranchProvider: "claude",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const thinkingButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("branchThinkingLevel"));
    thinkingButton?.element.parentElement?.dispatchEvent(
      new Event("mouseenter"),
    );
    await nextTick();

    const mediumButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Medium");

    expect(mediumButton?.classes()).toContain("border-l-primary");
  });

  it("不支援 thinking 的模型不顯示 thinking level 選項", () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        summaryProvider: "claude",
        summaryModel: "haiku",
      }),
    ];

    const wrapper = mount(SummarySection, {
      props: {
        connectionId: "conn-1",
        currentSummaryModel: "haiku",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).not.toContain("summaryThinkingLevel");
    expect(wrapper.text()).not.toContain("Low");
    expect(wrapper.text()).not.toContain("Medium");
    expect(wrapper.text()).not.toContain("High");
  });
});
