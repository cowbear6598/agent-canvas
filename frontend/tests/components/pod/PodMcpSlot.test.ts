import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import PodMcpSlot from "@/components/pod/PodMcpSlot.vue";

const defaultProps = {
  podId: "pod-1",
  podRotation: 0,
  activeCount: 3,
  disabled: false,
  disabledTooltip: "pod.slot.providerDisabled",
};

function mountSlot(overrides: Partial<typeof defaultProps> = {}) {
  return mount(PodMcpSlot, {
    props: { ...defaultProps, ...overrides },
  });
}

// ── PodMcpSlot：managed MCP 後三 provider 行為一致，沒有 provider 分流 ──

describe("PodMcpSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("啟用數量徽章顯示", () => {
    it("應顯示 activeCount 數字", () => {
      const wrapper = mountSlot({ activeCount: 5 });
      expect(wrapper.text()).toContain("5");
      wrapper.unmount();
    });

    it("activeCount 為 0 時仍顯示 (0)", () => {
      const wrapper = mountSlot({ activeCount: 0 });
      expect(wrapper.text()).toContain("(0)");
      wrapper.unmount();
    });

    it("應顯示 MCPs 標籤（i18n key pod.slot.mcpLabel）", () => {
      const wrapper = mountSlot();
      expect(wrapper.text()).toContain("pod.slot.mcpLabel");
      wrapper.unmount();
    });
  });

  describe("active class 套用條件", () => {
    it("activeCount > 0：button 應有 pod-mcp-slot--active class", () => {
      const wrapper = mountSlot({ activeCount: 2 });
      const button = wrapper.find("button");
      expect(button.classes()).toContain("pod-mcp-slot--active");
      wrapper.unmount();
    });

    it("activeCount === 0：button 不應有 pod-mcp-slot--active class", () => {
      const wrapper = mountSlot({ activeCount: 0 });
      const button = wrapper.find("button");
      expect(button.classes()).not.toContain("pod-mcp-slot--active");
      wrapper.unmount();
    });
  });

  // ── disabled ───────────────────────────────────────────────────

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
});
