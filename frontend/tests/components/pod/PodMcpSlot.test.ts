import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import PodMcpSlot from "@/components/pod/PodMcpSlot.vue";
import type { PodProvider } from "@/types/pod";

const defaultProps = {
  podId: "pod-1",
  podRotation: 0,
  activeCount: 3,
  provider: "claude" as PodProvider,
  capabilityDisabled: false,
  disabledTooltip: "pod.slot.providerDisabled",
};

function mountSlot(overrides: Partial<typeof defaultProps> = {}) {
  return mount(PodMcpSlot, {
    props: { ...defaultProps, ...overrides },
  });
}

// ── 案例 12：PodMcpSlot 啟用數量徽章（Claude 顯示數字、Codex 不顯示） ────

describe("PodMcpSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 徽章顯示行為（Claude vs Codex） ─────────────────────────────────────

  describe("案例 12：啟用數量徽章顯示", () => {
    it("Claude provider：應顯示 activeCount 數字", () => {
      const wrapper = mountSlot({ provider: "claude", activeCount: 5 });
      expect(wrapper.text()).toContain("5");
      wrapper.unmount();
    });

    it("Claude provider：activeCount 為 0 時仍顯示 (0)", () => {
      const wrapper = mountSlot({ provider: "claude", activeCount: 0 });
      // 格式為 "MCPs (0)"，包含 "(0)"
      expect(wrapper.text()).toContain("(0)");
      wrapper.unmount();
    });

    it("Codex provider：不顯示 activeCount 數字（唯讀，點開 popover 看）", () => {
      const wrapper = mountSlot({ provider: "codex", activeCount: 5 });
      expect(wrapper.text()).not.toContain("5");
      wrapper.unmount();
    });

    it("應顯示 MCPs 標籤（i18n key pod.slot.mcpLabel）", () => {
      const wrapper = mountSlot();
      // t() 在 mock 中直接回傳 key
      expect(wrapper.text()).toContain("pod.slot.mcpLabel");
      wrapper.unmount();
    });
  });

  // ── active class 正確套用 ─────────────────────────────────────────────────

  describe("案例 12：active class 正確套用", () => {
    it("Claude provider + activeCount > 0：button 應有 pod-mcp-slot--active class", () => {
      const wrapper = mountSlot({ provider: "claude", activeCount: 2 });
      const button = wrapper.find("button");
      expect(button.classes()).toContain("pod-mcp-slot--active");
      wrapper.unmount();
    });

    it("Claude provider + activeCount === 0：button 不應有 pod-mcp-slot--active class", () => {
      const wrapper = mountSlot({ provider: "claude", activeCount: 0 });
      const button = wrapper.find("button");
      expect(button.classes()).not.toContain("pod-mcp-slot--active");
      wrapper.unmount();
    });

    it("Codex provider：button 應有 pod-mcp-slot--codex class（不論 activeCount）", () => {
      const wrapper = mountSlot({ provider: "codex", activeCount: 5 });
      const button = wrapper.find("button");
      expect(button.classes()).toContain("pod-mcp-slot--codex");
      wrapper.unmount();
    });

    it("Codex provider：button 不應有 pod-mcp-slot--active class", () => {
      const wrapper = mountSlot({ provider: "codex", activeCount: 5 });
      const button = wrapper.find("button");
      expect(button.classes()).not.toContain("pod-mcp-slot--active");
      wrapper.unmount();
    });
  });

  // ── capabilityDisabled ───────────────────────────────────────────────────

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
        disabledTooltip: "pod.slot.providerDisabled",
      });
      const button = wrapper.find("button");
      expect(button.attributes("title")).toBe("pod.slot.providerDisabled");
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

  // ── podRotation transform ────────────────────────────────────────────────

  describe("podRotation prop 套用反向旋轉 transform", () => {
    it("podRotation=0 時 button 的 transform 應為 rotate(0deg)", () => {
      const wrapper = mountSlot({ podRotation: 0 });
      const button = wrapper.find("button");
      // style attribute 應含 rotate(0deg)（或等效的 rotate(-0deg)）
      const style = button.attributes("style") ?? "";
      expect(style).toContain("rotate(0deg)");
      wrapper.unmount();
    });

    it("podRotation=5 時 button 的 transform 應為 rotate(-5deg)（counter-rotation）", () => {
      const wrapper = mountSlot({ podRotation: 5 });
      const button = wrapper.find("button");
      const style = button.attributes("style") ?? "";
      expect(style).toContain("rotate(-5deg)");
      wrapper.unmount();
    });

    it("podRotation=-5 時 button 的 transform 應為 rotate(5deg)（counter-rotation）", () => {
      const wrapper = mountSlot({ podRotation: -5 });
      const button = wrapper.find("button");
      const style = button.attributes("style") ?? "";
      expect(style).toContain("rotate(5deg)");
      wrapper.unmount();
    });

    it("podRotation=10 時 button 的 transform 應為 rotate(-10deg)", () => {
      const wrapper = mountSlot({ podRotation: 10 });
      const button = wrapper.find("button");
      const style = button.attributes("style") ?? "";
      expect(style).toContain("rotate(-10deg)");
      wrapper.unmount();
    });
  });

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
