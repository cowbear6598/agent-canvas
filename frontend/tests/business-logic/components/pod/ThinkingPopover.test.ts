import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import ThinkingPopover from "@/components/pod/ThinkingPopover.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

describe("ThinkingPopover", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
  });

  it("顯示順序應反轉，讓高階選項在上方", () => {
    const capabilityStore = useProviderCapabilityStore();
    capabilityStore.syncFromPayload([
      {
        name: "claude",
        availableModels: [
          {
            label: "Sonnet",
            value: "sonnet",
            thinkingLevels: ["low", "medium", "high"],
            defaultThinkingLevel: "medium",
          },
        ],
      },
    ]);

    const wrapper = mount(ThinkingPopover, {
      props: {
        podId: "pod-1",
        provider: "claude",
        currentModel: "sonnet",
        currentLevel: "medium",
        anchorRect: new DOMRect(100, 100, 20, 20),
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    const labels = wrapper.findAll("button").map((button) => button.text());

    expect(labels).toEqual(["High", "Medium", "Low"]);
  });
});
