import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { useBoxSelect } from "@/composables/canvas/useBoxSelect";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import { useViewportStore } from "@/stores/pod/viewportStore";
import { usePodStore } from "@/stores/pod/podStore";
import {
  useRepositoryStore,
  useCommandStore,
  useMcpServerStore,
} from "@/stores/note";

// Mock useCanvasContext
vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    viewportStore: useViewportStore(),
    selectionStore: useSelectionStore(),
    podStore: usePodStore(),
    repositoryStore: useRepositoryStore(),
    commandStore: useCommandStore(),
    mcpServerStore: useMcpServerStore(),
  }),
}));

// Mock isCtrlOrCmdPressed
vi.mock("@/utils/keyboardHelpers", () => ({
  isCtrlOrCmdPressed: vi.fn(() => false),
}));

const BOX_SELECT_THRESHOLD = 5;

describe("useBoxSelect", () => {
  setupStoreTest();

  describe("回傳值", () => {
    it("應回傳 isBoxSelecting ref 和 startBoxSelect 函數", () => {
      const TestComponent = defineComponent({
        setup() {
          const result = useBoxSelect();
          return { result };
        },
        render() {
          return h("div");
        },
      });

      const wrapper = mount(TestComponent);
      const { result } = wrapper.vm;

      expect(result.isBoxSelecting).toBeDefined();
      expect(result.isBoxSelecting.value).toBe(false);
      expect(result.startBoxSelect).toBeTypeOf("function");
    });
  });

  describe("startBoxSelect - 按鈕過濾", () => {
    it("非左鍵點擊時不應啟動框選", () => {
      const selectionStore = useSelectionStore();
      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 右鍵點擊 (button = 2)
      const rightClickEvent = new MouseEvent("mousedown", {
        button: 2,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(rightClickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(rightClickEvent);

      expect(startSelectionSpy).not.toHaveBeenCalled();
    });

    it("中鍵點擊時不應啟動框選", () => {
      const selectionStore = useSelectionStore();
      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 中鍵點擊 (button = 1)
      const middleClickEvent = new MouseEvent("mousedown", {
        button: 1,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(middleClickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(middleClickEvent);

      expect(startSelectionSpy).not.toHaveBeenCalled();
    });
  });

  describe("startBoxSelect - 目標元素過濾", () => {
    it("target 非 canvas-grid 也非 canvas-content 時不應啟動框選", () => {
      const selectionStore = useSelectionStore();
      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "other-element" });
        },
      });

      const wrapper = mount(TestComponent);
      const otherElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(clickEvent, "target", {
        value: otherElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      expect(startSelectionSpy).not.toHaveBeenCalled();
    });

    it("target 為 canvas-grid 時應啟動框選", () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 200,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      expect(startSelectionSpy).toHaveBeenCalledWith(100, 200, false);
    });

    it("target 為 canvas-content 時應啟動框選", () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-content" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 200,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      expect(startSelectionSpy).toHaveBeenCalledWith(100, 200, false);
    });
  });

  describe("startBoxSelect - 啟動框選", () => {
    it("zoom 為 0 時不應啟動框選", () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 0;
      viewportStore.offset = { x: 0, y: 0 };

      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 200,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      expect(startSelectionSpy).not.toHaveBeenCalled();
    });

    it("應設定 selectionStore.startSelection 並轉換座標", () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 2;
      viewportStore.offset = { x: 50, y: 100 };

      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      let isBoxSelecting: any;
      const TestComponent = defineComponent({
        setup() {
          const result = useBoxSelect();
          isBoxSelecting = result.isBoxSelecting;
          return { startBoxSelect: result.startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 250,
        clientY: 300,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      // canvasX = (250 - 50) / 2 = 100
      // canvasY = (300 - 100) / 2 = 100
      expect(startSelectionSpy).toHaveBeenCalledWith(100, 100, false);
      expect(isBoxSelecting.value).toBe(true);
    });

    it("Ctrl 按下時應傳遞 isCtrlPressed = true", async () => {
      const { isCtrlOrCmdPressed } = await import("@/utils/keyboardHelpers");
      vi.mocked(isCtrlOrCmdPressed).mockReturnValueOnce(true);

      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const startSelectionSpy = vi.spyOn(selectionStore, "startSelection");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const clickEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 200,
        ctrlKey: true,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(clickEvent);

      expect(startSelectionSpy).toHaveBeenCalledWith(100, 200, true);
    });
  });

  describe("拖曳與結束框選", () => {
    it("拖曳距離小於閾值時應呼叫 cancelSelection", async () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const cancelSelectionSpy = vi.spyOn(selectionStore, "cancelSelection");

      let isBoxSelecting: any;
      const TestComponent = defineComponent({
        setup() {
          const result = useBoxSelect();
          isBoxSelecting = result.isBoxSelecting;
          return { startBoxSelect: result.startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 開始框選
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);
      expect(isBoxSelecting.value).toBe(true);

      // 移動 2 像素（小於閾值 5）
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientX: 102,
        clientY: 102,
      });
      document.dispatchEvent(mousemoveEvent);

      // 放開滑鼠
      const mouseupEvent = new MouseEvent("mouseup", {
        clientX: 102,
        clientY: 102,
      });
      document.dispatchEvent(mouseupEvent);

      // 距離 = Math.sqrt(2^2 + 2^2) = 2.83 < 5
      expect(cancelSelectionSpy).toHaveBeenCalled();
      expect(isBoxSelecting.value).toBe(false);
    });

    it("拖曳距離等於閾值時應呼叫 endSelection", async () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const endSelectionSpy = vi.spyOn(selectionStore, "endSelection");
      const cancelSelectionSpy = vi.spyOn(selectionStore, "cancelSelection");

      let isBoxSelecting: any;
      const TestComponent = defineComponent({
        setup() {
          const result = useBoxSelect();
          isBoxSelecting = result.isBoxSelecting;
          return { startBoxSelect: result.startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 開始框選
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);
      expect(isBoxSelecting.value).toBe(true);

      // 移動 3 和 4 像素（畢氏定理 = 5）
      const mouseupEvent = new MouseEvent("mouseup", {
        clientX: 103,
        clientY: 104,
      });
      document.dispatchEvent(mouseupEvent);

      // 距離 = Math.sqrt(3^2 + 4^2) = 5 (不大於閾值)
      expect(endSelectionSpy).toHaveBeenCalled();
      expect(cancelSelectionSpy).not.toHaveBeenCalled();
    });

    it("拖曳距離大於閾值時應呼叫 endSelection", async () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const endSelectionSpy = vi.spyOn(selectionStore, "endSelection");
      const cancelSelectionSpy = vi.spyOn(selectionStore, "cancelSelection");

      let isBoxSelecting: any;
      const TestComponent = defineComponent({
        setup() {
          const result = useBoxSelect();
          isBoxSelecting = result.isBoxSelecting;
          return { startBoxSelect: result.startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 開始框選
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);
      expect(isBoxSelecting.value).toBe(true);

      // 移動 10 像素（大於閾值 5）
      const mouseupEvent = new MouseEvent("mouseup", {
        clientX: 110,
        clientY: 110,
      });
      document.dispatchEvent(mouseupEvent);

      // 距離 = Math.sqrt(10^2 + 10^2) = 14.14 > 5
      expect(endSelectionSpy).toHaveBeenCalled();
      expect(cancelSelectionSpy).not.toHaveBeenCalled();
      expect(isBoxSelecting.value).toBe(false);
    });

    it("拖曳過程中應呼叫 updateSelection 和 calculateSelectedElements", async () => {
      const viewportStore = useViewportStore();
      const selectionStore = useSelectionStore();
      const podStore = usePodStore();
      const repositoryStore = useRepositoryStore();
      const commandStore = useCommandStore();
      const mcpServerStore = useMcpServerStore();

      viewportStore.zoom = 2;
      viewportStore.offset = { x: 50, y: 100 };

      const updateSelectionSpy = vi.spyOn(selectionStore, "updateSelection");
      const calculateSelectedElementsSpy = vi.spyOn(
        selectionStore,
        "calculateSelectedElements",
      );

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 開始框選
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 250,
        clientY: 300,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);

      // 移動滑鼠
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientX: 450,
        clientY: 500,
      });
      document.dispatchEvent(mousemoveEvent);

      // moveCanvasX = (450 - 50) / 2 = 200
      // moveCanvasY = (500 - 100) / 2 = 200
      expect(updateSelectionSpy).toHaveBeenCalledWith(200, 200);
      expect(calculateSelectedElementsSpy).toHaveBeenCalledWith({
        pods: podStore.pods,
        noteGroups: [
          { notes: repositoryStore.notes, type: "repositoryNote" },
          { notes: commandStore.notes, type: "commandNote" },
          { notes: mcpServerStore.notes, type: "mcpServerNote" },
        ],
      });
    });
  });

  describe("事件監聽器清理", () => {
    it("unmount 時應清理事件監聽器", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      // 開始框選（註冊事件監聽器）
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      wrapper.vm.startBoxSelect(mousedownEvent);

      removeEventListenerSpy.mockClear();

      // 卸載元件
      wrapper.unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mousemove",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mouseup",
        expect.any(Function),
      );
    });

    it("mouseup 後應清理事件監聽器", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      // 開始框選
      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);

      removeEventListenerSpy.mockClear();

      // 放開滑鼠
      const mouseupEvent = new MouseEvent("mouseup", {
        clientX: 150,
        clientY: 150,
      });
      document.dispatchEvent(mouseupEvent);

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mousemove",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mouseup",
        expect.any(Function),
      );
    });

    it("多次啟動框選時應先清理舊的事件監聽器", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      // 第一次啟動框選
      const mousedownEvent1 = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent1, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent1);

      removeEventListenerSpy.mockClear();

      // 第二次啟動框選（應先清理第一次的監聽器）
      const mousedownEvent2 = new MouseEvent("mousedown", {
        button: 0,
        clientX: 200,
        clientY: 200,
      });
      Object.defineProperty(mousedownEvent2, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent2);

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mousemove",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "mouseup",
        expect.any(Function),
      );
    });
  });

  describe("Input blur 處理", () => {
    it("activeElement 為 input 時應 blur", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      const blurSpy = vi.spyOn(input, "blur");

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);

      expect(blurSpy).toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it("activeElement 為 textarea 時應 blur", () => {
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      textarea.focus();

      const blurSpy = vi.spyOn(textarea, "blur");

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      wrapper.vm.startBoxSelect(mousedownEvent);

      expect(blurSpy).toHaveBeenCalled();

      document.body.removeChild(textarea);
    });

    it("activeElement 非 input/textarea 時不應報錯", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);
      div.focus();

      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      viewportStore.offset = { x: 0, y: 0 };

      const TestComponent = defineComponent({
        setup() {
          const { startBoxSelect } = useBoxSelect();
          return { startBoxSelect };
        },
        render() {
          return h("div", { class: "canvas-grid" });
        },
      });

      const wrapper = mount(TestComponent);
      const canvasElement = wrapper.element;

      const mousedownEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      Object.defineProperty(mousedownEvent, "target", {
        value: canvasElement,
        writable: false,
      });

      expect(() => wrapper.vm.startBoxSelect(mousedownEvent)).not.toThrow();

      document.body.removeChild(div);
    });
  });
});
