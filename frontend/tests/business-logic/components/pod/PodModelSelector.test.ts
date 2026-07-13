import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

describe("PodModelSelector", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    useProviderCapabilityStore().syncFromPayload([
      {
        name: "codex",
        availableModels: [
          { label: "GPT-5.4", value: "gpt-5.4" },
          { label: "GPT-5.5", value: "gpt-5.5" },
          { label: "GPT-5.6 Sol", value: "gpt-5.6-sol" },
          { label: "GPT-5.6 Terra", value: "gpt-5.6-terra" },
          { label: "GPT-5.6 Luna", value: "gpt-5.6-luna" },
        ],
      },
    ]);
  });

  it("可捲動清單切換 model 後應歸零捲動位置，讓 active model 保持可見", async () => {
    const wrapper = mount(PodModelSelector, {
      props: {
        podId: "pod-1",
        provider: "codex",
        currentModel: "gpt-5.6-luna",
      },
    });
    const stack = wrapper.find<HTMLElement>(".model-cards-stack");
    stack.element.scrollTop = 64;

    const terraButton = wrapper
      .findAll(".model-card")
      .find((button) => button.text() === "GPT-5.6 Terra");
    expect(terraButton).toBeDefined();
    await terraButton!.trigger("click");
    expect(wrapper.emitted("update:model")?.[0]).toEqual(["gpt-5.6-terra"]);

    await wrapper.setProps({ currentModel: "gpt-5.6-terra" });

    expect(stack.element.scrollTop).toBe(0);
    expect(wrapper.find(".model-card.active").text()).toBe("GPT-5.6 Terra");
  });
});
