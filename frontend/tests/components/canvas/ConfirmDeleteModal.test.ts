import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDeleteModal from "@/components/canvas/ConfirmDeleteModal.vue";

// mock shadcn dialog，讓 open prop 控制渲染、並轉發 update:open 事件（供 ESC 測試）
vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open" data-testid="dialog"><slot /></div>',
  },
  DialogContent: { template: "<div><slot /></div>" },
  DialogHeader: { template: "<div><slot /></div>" },
  DialogTitle: { template: "<div data-testid='dialog-title'><slot /></div>" },
  DialogDescription: { template: "<div><slot /></div>" },
  DialogFooter: { template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["variant", "disabled"],
    template: "<button @click=\"$emit('click', $event)\"><slot /></button>",
  },
}));

function mountModal(props = {}) {
  return mount(ConfirmDeleteModal, {
    props: {
      open: true,
      itemName: "TestItem",
      isInUse: false,
      itemType: "repository",
      ...props,
    },
  });
}

describe("ConfirmDeleteModal smoke", () => {
  it("open=true 時渲染標題", () => {
    const wrapper = mountModal();
    expect(wrapper.find("[data-testid='dialog']").exists()).toBe(true);
  });

  it("點確認（刪除）觸發 confirm emit", async () => {
    const wrapper = mountModal();
    const deleteBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("刪除"));
    await deleteBtn!.trigger("click");
    expect(wrapper.emitted("confirm")).toBeTruthy();
  });

  it("點取消觸發 update:open(false)", async () => {
    const wrapper = mountModal();
    const cancelBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("取消"));
    await cancelBtn!.trigger("click");
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("ESC（Dialog update:open false）觸發關閉", async () => {
    const wrapper = mountModal();
    await wrapper
      .findComponent({ name: "Dialog" })
      .vm.$emit("update:open", false);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });
});
