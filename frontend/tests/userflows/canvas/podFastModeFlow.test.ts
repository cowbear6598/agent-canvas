import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setActivePinia } from "pinia";
import PodFastSlot from "@/components/pod/PodFastSlot.vue";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

describe("Pod Fast mode 控制項", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
  });

  it("關閉時閃電為空心，點擊會送出切換事件", async () => {
    const wrapper = mount(PodFastSlot, {
      props: {
        podRotation: 0,
        enabled: false,
        disabled: false,
      },
    });
    const button = wrapper.get("button");

    expect(button.classes()).not.toContain("pod-fast-slot--enabled");
    expect(button.attributes("aria-pressed")).toBe("false");

    await button.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("開啟時套用填滿狀態，停用時顯示禁止符號且不可點擊", async () => {
    const wrapper = mount(PodFastSlot, {
      props: {
        podRotation: 3,
        enabled: true,
        disabled: true,
        disabledTooltip: "目前不可切換",
      },
    });
    const button = wrapper.get("button");

    expect(button.classes()).toContain("pod-fast-slot--enabled");
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("目前不可切換");
    expect(wrapper.find(".fast-disabled-overlay").exists()).toBe(true);

    await button.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });
});
