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
          { label: "GPT-6 Astra", value: "gpt-6-astra" },
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

    const astraButton = wrapper
      .findAll(".model-card")
      .find((button) => button.text() === "GPT-6 Astra");
    expect(astraButton).toBeDefined();
    await astraButton!.trigger("click");
    expect(wrapper.emitted("update:model")?.[0]).toEqual(["gpt-6-astra"]);

    await wrapper.setProps({ currentModel: "gpt-6-astra" });

    expect(stack.element.scrollTop).toBe(0);
    expect(wrapper.find(".model-card.active").text()).toBe("GPT-6 Astra");
  });
});
