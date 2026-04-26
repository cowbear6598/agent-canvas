import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDeleteModal from "@/components/canvas/ConfirmDeleteModal.vue";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open" data-testid="dialog"><slot /></div>',
  },
  DialogContent: {
    name: "DialogContent",
    template: '<div data-testid="dialog-content"><slot /></div>',
  },
  DialogHeader: {
    name: "DialogHeader",
    template: '<div data-testid="dialog-header"><slot /></div>',
  },
  DialogTitle: {
    name: "DialogTitle",
    template: '<div data-testid="dialog-title"><slot /></div>',
  },
  DialogDescription: {
    name: "DialogDescription",
    template: '<div data-testid="dialog-description"><slot /></div>',
  },
  DialogFooter: {
    name: "DialogFooter",
    template: '<div data-testid="dialog-footer"><slot /></div>',
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["variant", "disabled"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
}));

type ItemType = "repository" | "command" | "mcpServer";
type GroupType = "commandGroup";
type ExtendedItemType = ItemType | GroupType;

function mountModal(
  props: {
    open?: boolean;
    itemName?: string;
    isInUse?: boolean;
    itemType?: ExtendedItemType;
  } = {},
) {
  return mount(ConfirmDeleteModal, {
    props: {
      open: true,
      itemName: "Test Item",
      isInUse: false,
      itemType: "repository",
      ...props,
    },
  });
}

describe("ConfirmDeleteModal", () => {
  describe("基本顯示", () => {
    it("open 為 false 時不渲染內容", () => {
      const wrapper = mountModal({ open: false });

      expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
    });

    it("isInUse 為 false 時顯示「確認刪除」標題", () => {
      const wrapper = mountModal({ isInUse: false });

      expect(wrapper.text()).toContain("確認刪除");
    });

    it("isInUse 為 false 時顯示項目名稱", () => {
      const wrapper = mountModal({
        isInUse: false,
        itemName: "我的 Output Style",
      });

      expect(wrapper.text()).toContain("我的 Output Style");
    });

    it("isInUse 為 false 時顯示取消和刪除按鈕", () => {
      const wrapper = mountModal({ isInUse: false });

      const buttons = wrapper.findAll("button");
      expect(buttons.some((btn) => btn.text().includes("取消"))).toBe(true);
      expect(buttons.some((btn) => btn.text().includes("刪除"))).toBe(true);
    });

    it("isInUse 為 false 時不顯示只有確定的按鈕", () => {
      const wrapper = mountModal({ isInUse: false });

      const buttons = wrapper.findAll("button");
      // 應有取消和刪除兩個按鈕，而不是只有確定
      expect(buttons.length).toBe(2);
    });
  });

  describe("一般類型在使用中", () => {
    it("command 在 isInUse 為 true 時阻擋刪除", () => {
      const wrapper = mountModal({ isInUse: true, itemType: "command" });

      const buttons = wrapper.findAll("button");
      expect(buttons.some((btn) => btn.text().includes("刪除"))).toBe(false);
    });
  });

  describe("MCP Server 在使用中", () => {
    it("mcpServer 在 isInUse 為 false 時正常顯示刪除按鈕", () => {
      const wrapper = mountModal({ isInUse: false, itemType: "mcpServer" });

      const buttons = wrapper.findAll("button");
      expect(buttons.some((btn) => btn.text().includes("刪除"))).toBe(true);
    });

    it("mcpServer 在 isInUse 為 true 時顯示「無法刪除」標題", () => {
      const wrapper = mountModal({ isInUse: true, itemType: "mcpServer" });

      expect(wrapper.text()).toContain("無法刪除");
    });

    it("mcpServer 在 isInUse 為 true 時阻擋刪除", () => {
      const wrapper = mountModal({ isInUse: true, itemType: "mcpServer" });

      const buttons = wrapper.findAll("button");
      expect(buttons.some((btn) => btn.text().includes("刪除"))).toBe(false);
    });

    it("mcpServer 在 isInUse 為 true 時只顯示確定按鈕", () => {
      const wrapper = mountModal({ isInUse: true, itemType: "mcpServer" });

      const buttons = wrapper.findAll("button");
      expect(buttons.length).toBe(1);
      expect(buttons[0]?.text()).toContain("確認");
    });
  });

  describe("按鈕行為", () => {
    it("點擊取消按鈕 emit update:open 為 false", async () => {
      const wrapper = mountModal({ isInUse: false });

      const buttons = wrapper.findAll("button");
      const cancelButton = buttons.find((btn) => btn.text().includes("取消"));
      await cancelButton!.trigger("click");

      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("點擊刪除按鈕 emit confirm 事件", async () => {
      const wrapper = mountModal({ isInUse: false });

      const buttons = wrapper.findAll("button");
      const deleteButton = buttons.find((btn) => btn.text().includes("刪除"));
      await deleteButton!.trigger("click");

      expect(wrapper.emitted("confirm")).toBeTruthy();
    });

    it("點擊刪除按鈕同時 emit update:open 為 false", async () => {
      const wrapper = mountModal({ isInUse: false });

      const buttons = wrapper.findAll("button");
      const deleteButton = buttons.find((btn) => btn.text().includes("刪除"));
      await deleteButton!.trigger("click");

      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("點擊確定按鈕（isInUse 為 true 時）emit update:open 為 false", async () => {
      const wrapper = mountModal({ isInUse: true, itemType: "command" });

      const buttons = wrapper.findAll("button");
      const confirmButton = buttons.find((btn) => btn.text().includes("確認"));
      await confirmButton!.trigger("click");

      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });
});
