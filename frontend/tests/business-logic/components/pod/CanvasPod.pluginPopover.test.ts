import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useViewportStore } from "@/stores/pod";
import type { Pod } from "@/types";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

vi.mock("@/composables/useSendCanvasAction", () => ({
  useSendCanvasAction: () => ({
    sendCanvasAction: vi.fn(),
  }),
}));

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Pod 1",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    pluginIds: [],
    ...overrides,
  };
}

describe("CanvasPod plugin popover", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    const providerCapabilityStore = useProviderCapabilityStore();
    providerCapabilityStore.syncFromPayload([
      {
        name: "claude",
        availableModels: [{ label: "Sonnet", value: "sonnet" }],
      },
    ]);
    providerCapabilityStore.loaded = true;
    vi.clearAllMocks();
  });

  it("開啟 Plugins popover 後 viewport offset 變化會關閉 popover 並清除 anchor", async () => {
    const wrapper = mount(CanvasPod, {
      props: { pod: makePod({ pluginIds: ["plugin-a"] }) },
      attachTo: document.body,
      global: {
        stubs: {
          PodModelSelector: { template: "<div />" },
          PodHeader: { template: "<div />" },
          PodUploadOverlay: { template: "<div />" },
          PodAnchors: { template: "<div />" },
          PodActions: { template: "<div />" },
          IntegrationStatusIcon: { template: "<div />" },
          ScheduleModal: { template: "<div />" },
          McpPopover: { template: "<div />" },
          ThinkingPopover: { template: "<div />" },
          PluginPopover: {
            props: ["podId", "anchorRect"],
            template:
              '<div data-testid="plugin-popover" :data-anchor-left="anchorRect.left" />',
          },
          PodSlots: {
            emits: ["plugin-clicked"],
            template:
              '<button class="plugin-slot" @click="$emit(\'plugin-clicked\', $event)">plugins</button>',
          },
        },
      },
    });

    await wrapper.find(".plugin-slot").trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="plugin-popover"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="plugin-popover"]').attributes(
        "data-anchor-left",
      ),
    ).toBe("0");

    const viewportStore = useViewportStore();
    viewportStore.setOffset(24, 36);
    await flushPromises();

    expect(wrapper.find('[data-testid="plugin-popover"]').exists()).toBe(false);
  });
});
