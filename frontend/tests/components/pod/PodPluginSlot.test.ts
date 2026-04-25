import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import PodPluginSlot from "@/components/pod/PodPluginSlot.vue";
import type { PodProvider } from "@/types/pod";

const defaultProps = {
  podId: "pod-1",
  podRotation: 0,
  activeCount: 3,
  provider: "claude" as PodProvider,
  capabilityDisabled: false,
  disabledTooltip: "pod.slot.codexDisabled",
};

function mountSlot(overrides: Partial<typeof defaultProps> = {}) {
  return mount(PodPluginSlot, {
    props: { ...defaultProps, ...overrides },
  });
}

describe("PodPluginSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 基本顯示 ──────────────────────────────────────────────────────────────

  it("Claude provider：應顯示 props.activeCount 數字", () => {
    const wrapper = mountSlot({ provider: "claude", activeCount: 5 });
    expect(wrapper.text()).toContain("5");
    wrapper.unmount();
  });

  it("Codex provider：不顯示 activeCount 數字", () => {
    const wrapper = mountSlot({ provider: "codex", activeCount: 5 });
    expect(wrapper.text()).not.toContain("5");
    wrapper.unmount();
  });

  it("應顯示 'Plugins' 標籤（i18n key）", () => {
    const wrapper = mountSlot();
    // t() 在 mock 中直接回傳 key，所以期待 key 本身出現在文字中
    expect(wrapper.text()).toContain("pod.slot.pluginsLabel");
    wrapper.unmount();
  });

  // ── capabilityDisabled = true ─────────────────────────────────────────────

  describe("capabilityDisabled = true", () => {
    it("button 應有 aria-disabled 屬性", () => {
      const wrapper = mountSlot({ capabilityDisabled: true });
      const button = wrapper.find("button");
      expect(button.attributes("aria-disabled")).toBe("true");
      wrapper.unmount();
    });

    it("tooltip（title）應套用 disabledTooltip 值", () => {
      const wrapper = mountSlot({
        capabilityDisabled: true,
        disabledTooltip: "pod.slot.codexDisabled",
      });
      const button = wrapper.find("button");
      expect(button.attributes("title")).toBe("pod.slot.codexDisabled");
      wrapper.unmount();
    });

    it("click 不應 emit（early return）", async () => {
      const wrapper = mountSlot({ capabilityDisabled: true });
      const button = wrapper.find("button");
      await button.trigger("click");
      expect(wrapper.emitted("click")).toBeFalsy();
      wrapper.unmount();
    });
  });

  // ── capabilityDisabled = false ────────────────────────────────────────────

  describe("capabilityDisabled = false", () => {
    it("button 不應有 aria-disabled 屬性", () => {
      const wrapper = mountSlot({ capabilityDisabled: false });
      const button = wrapper.find("button");
      expect(button.attributes("aria-disabled")).toBeUndefined();
      wrapper.unmount();
    });

    it("button 不應有 title 屬性", () => {
      const wrapper = mountSlot({ capabilityDisabled: false });
      const button = wrapper.find("button");
      expect(button.attributes("title")).toBeUndefined();
      wrapper.unmount();
    });

    it("click 應 emit 'click' 並帶 MouseEvent", async () => {
      const wrapper = mountSlot({ capabilityDisabled: false });
      const button = wrapper.find("button");
      await button.trigger("click");
      expect(wrapper.emitted("click")).toBeTruthy();
      const [event] = wrapper.emitted("click")![0] as [MouseEvent];
      expect(event).toBeInstanceOf(MouseEvent);
      wrapper.unmount();
    });
  });
});
