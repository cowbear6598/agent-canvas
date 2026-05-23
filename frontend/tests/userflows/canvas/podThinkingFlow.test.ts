import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import PodThinkingSlot from "@/components/pod/PodThinkingSlot.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

describe("PodThinkingSlot", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
  });

  it("水位應依 levels 原始排序計算，不受 popover 顯示反轉影響", async () => {
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

    const wrapper = mount(PodThinkingSlot, {
      props: {
        podId: "pod-1",
        podRotation: 0,
        currentLevel: "low",
        currentModel: "sonnet",
        provider: "claude",
        disabled: false,
        disabledTooltip: "",
      },
    });

    expect(wrapper.find(".pod-thinking-slot").attributes("style")).toContain(
      "--thinking-fill-pct: 33.33333333333333%;",
    );

    await wrapper.setProps({ currentLevel: "high" });

    expect(wrapper.find(".pod-thinking-slot").attributes("style")).toContain(
      "--thinking-fill-pct: 100%;",
    );
  });
});
