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
  disabled: false,
  disabledTooltip: "pod.slot.providerDisabled",
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

  // ── disabled = true ─────────────────────────────────────────────

  describe("disabled = true", () => {
    it("button 應有 aria-disabled 屬性", () => {
      const wrapper = mountSlot({ disabled: true });
      const button = wrapper.find("button");
      expect(button.attributes("aria-disabled")).toBe("true");
      wrapper.unmount();
    });

    it("tooltip（title）應套用 disabledTooltip 值", () => {
      const wrapper = mountSlot({
        disabled: true,
        disabledTooltip: "pod.slot.providerDisabled",
      });
      const button = wrapper.find("button");
      expect(button.attributes("title")).toBe("pod.slot.providerDisabled");
      wrapper.unmount();
    });

    it("click 不應 emit（early return）", async () => {
      const wrapper = mountSlot({ disabled: true });
      const button = wrapper.find("button");
      await button.trigger("click");
      expect(wrapper.emitted("click")).toBeFalsy();
      wrapper.unmount();
    });
  });

  // ── disabled = false ────────────────────────────────────────────

  describe("disabled = false", () => {
    it("button 不應有 aria-disabled 屬性", () => {
      const wrapper = mountSlot({ disabled: false });
      const button = wrapper.find("button");
      expect(button.attributes("aria-disabled")).toBeUndefined();
      wrapper.unmount();
    });

    it("button 不應有 title 屬性", () => {
      const wrapper = mountSlot({ disabled: false });
      const button = wrapper.find("button");
      expect(button.attributes("title")).toBeUndefined();
      wrapper.unmount();
    });

    it("click 應 emit 'click' 並帶 MouseEvent", async () => {
      const wrapper = mountSlot({ disabled: false });
      const button = wrapper.find("button");
      await button.trigger("click");
      expect(wrapper.emitted("click")).toBeTruthy();
      const [event] = wrapper.emitted("click")![0] as [MouseEvent];
      expect(event).toBeInstanceOf(MouseEvent);
      wrapper.unmount();
    });
  });

  // ── Gemini provider ───────────────────────────────────────────────────────

  describe("Gemini provider", () => {
    // T-S1：Gemini 應顯示 activeCount 數字，不顯示 codex 唯讀 label
    it("T-S1：應顯示 activeCount 數字（與 Claude 一致，不套 codex 唯讀分支）", () => {
      const wrapper = mountSlot({ provider: "gemini", activeCount: 7 });
      expect(wrapper.text()).toContain("7");
      wrapper.unmount();
    });

    // T-S2：Gemini + disabled = true
    describe("disabled = true", () => {
      it("T-S2：button 應有 aria-disabled 屬性", () => {
        const wrapper = mountSlot({
          provider: "gemini",
          disabled: true,
        });
        expect(wrapper.find("button").attributes("aria-disabled")).toBe("true");
        wrapper.unmount();
      });

      it("T-S2：click 不應 emit（early return）", async () => {
        const wrapper = mountSlot({
          provider: "gemini",
          disabled: true,
        });
        await wrapper.find("button").trigger("click");
        expect(wrapper.emitted("click")).toBeFalsy();
        wrapper.unmount();
      });

      it("T-S2：tooltip（title）應套用 disabledTooltip 值", () => {
        const wrapper = mountSlot({
          provider: "gemini",
          disabled: true,
          disabledTooltip: "pod.slot.providerDisabled",
        });
        expect(wrapper.find("button").attributes("title")).toBe(
          "pod.slot.providerDisabled",
        );
        wrapper.unmount();
      });
    });

    // T-S3：Gemini + activeCount = 0 → 不套 pod-plugin-slot--active
    it("T-S3：activeCount = 0 時不套 pod-plugin-slot--active class", () => {
      const wrapper = mountSlot({ provider: "gemini", activeCount: 0 });
      expect(wrapper.find("button").classes()).not.toContain(
        "pod-plugin-slot--active",
      );
      wrapper.unmount();
    });

    it("T-S3（補充）：activeCount > 0 時套 pod-plugin-slot--active class", () => {
      const wrapper = mountSlot({ provider: "gemini", activeCount: 2 });
      expect(wrapper.find("button").classes()).toContain(
        "pod-plugin-slot--active",
      );
      wrapper.unmount();
    });
  });
});
