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

it("Astra 可選 Ultra，切換至其他模型後不再顯示", async () => {
  setActivePinia(setupTestPinia());
  useProviderCapabilityStore().syncFromPayload([
    {
      name: "codex",
      availableModels: [
        {
          label: "GPT-6 Astra",
          value: "gpt-6-astra",
          thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
          defaultThinkingLevel: "medium",
        },
        {
          label: "GPT-5.6 Sol",
          value: "gpt-5.6-sol",
          thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
          defaultThinkingLevel: "medium",
        },
      ],
    },
  ]);
  const wrapper = mount(ThinkingPopover, {
    props: {
      podId: "astra",
      provider: "codex",
      currentModel: "gpt-6-astra",
      currentLevel: "medium",
      anchorRect: new DOMRect(100, 100, 20, 20),
    },
    global: { stubs: { Teleport: true } },
  });
  expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
    "Ultra",
    "Max",
    "xHigh",
    "High",
    "Medium",
    "Low",
  ]);
  await wrapper.findAll("button")[0]!.trigger("click");
  expect(wrapper.emitted("select")).toEqual([["ultra"]]);
  await wrapper.setProps({ currentModel: "gpt-5.6-sol" });
  expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
    "Max",
    "xHigh",
    "High",
    "Medium",
    "Low",
  ]);
  wrapper.unmount();
});
