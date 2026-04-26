import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod } from "../../helpers/factories";
import { useDeleteSelection } from "@/composables/canvas/useDeleteSelection";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import type { SelectableElement } from "@/types";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast and domHelpers
const { mockToast, mockIsEditingElement } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockIsEditingElement: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/utils/domHelpers", () => ({
  isEditingElement: () => mockIsEditingElement(),
}));

describe("useDeleteSelection", () => {
  setupStoreTest(() => {
    mockIsEditingElement.mockReturnValue(false);
    const { canvasStore } = useCanvasContext();
    canvasStore.activeCanvasId = "canvas-1";
  });

  describe("deleteSelectedElements", () => {
    it("無選中元素時不操作", async () => {
      const { selectionStore, podStore } = useCanvasContext();

      // 建立測試元件來呼叫 composable
      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [];

      const deletePodSpy = vi.spyOn(podStore, "deletePodWithBackend");
      const clearSelectionSpy = vi.spyOn(selectionStore, "clearSelection");

      await deleteSelectedElements();

      expect(deletePodSpy).not.toHaveBeenCalled();
      expect(clearSelectionSpy).not.toHaveBeenCalled();
    });

    it("刪除選中的 Pod", async () => {
      const { selectionStore, podStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      const pod1 = createMockPod({ id: "pod-1" });
      const pod2 = createMockPod({ id: "pod-2" });
      podStore.pods = [pod1, pod2];

      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
      ] as SelectableElement[];

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();
      const clearSelectionSpy = vi.spyOn(selectionStore, "clearSelection");

      await deleteSelectedElements();

      expect(deletePodSpy).toHaveBeenCalledTimes(2);
      expect(deletePodSpy).toHaveBeenCalledWith("pod-1");
      expect(deletePodSpy).toHaveBeenCalledWith("pod-2");
      expect(clearSelectionSpy).toHaveBeenCalled();
    });

    it("刪除選中的 repositoryNote", async () => {
      const { selectionStore, repositoryStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "repositoryNote", id: "repo-note-1" },
      ] as SelectableElement[];

      const deleteNoteSpy = vi
        .spyOn(repositoryStore, "deleteNote")
        .mockResolvedValue();
      const clearSelectionSpy = vi.spyOn(selectionStore, "clearSelection");

      await deleteSelectedElements();

      expect(deleteNoteSpy).toHaveBeenCalledWith("repo-note-1");
      expect(clearSelectionSpy).toHaveBeenCalled();
    });

    it("刪除選中的 commandNote", async () => {
      const { selectionStore, commandStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "commandNote", id: "command-note-1" },
      ] as SelectableElement[];

      const deleteNoteSpy = vi
        .spyOn(commandStore, "deleteNote")
        .mockResolvedValue();

      await deleteSelectedElements();

      expect(deleteNoteSpy).toHaveBeenCalledWith("command-note-1");
      expect(selectionStore.clearSelection).toHaveBeenCalled();
    });

    it("刪除選中的 mcpServerNote", async () => {
      const { selectionStore, mcpServerStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "mcpServerNote", id: "mcp-server-note-1" },
      ] as SelectableElement[];

      const deleteNoteSpy = vi
        .spyOn(mcpServerStore, "deleteNote")
        .mockResolvedValue();

      await deleteSelectedElements();

      expect(deleteNoteSpy).toHaveBeenCalledWith("mcp-server-note-1");
      expect(selectionStore.clearSelection).toHaveBeenCalled();
    });

    it("混合刪除 Pod 和多種 Note（含 mcpServerNote）", async () => {
      const {
        selectionStore,
        podStore,
        repositoryStore,
        commandStore,
        mcpServerStore,
      } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "repositoryNote", id: "repo-1" },
        { type: "commandNote", id: "command-1" },
        { type: "mcpServerNote", id: "mcp-1" },
      ] as SelectableElement[];

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();
      const deleteRepositorySpy = vi
        .spyOn(repositoryStore, "deleteNote")
        .mockResolvedValue();
      const deleteCommandSpy = vi
        .spyOn(commandStore, "deleteNote")
        .mockResolvedValue();
      const deleteMcpServerSpy = vi
        .spyOn(mcpServerStore, "deleteNote")
        .mockResolvedValue();

      await deleteSelectedElements();

      expect(deletePodSpy).toHaveBeenCalledWith("pod-1");
      expect(deleteRepositorySpy).toHaveBeenCalledWith("repo-1");
      expect(deleteCommandSpy).toHaveBeenCalledWith("command-1");
      expect(deleteMcpServerSpy).toHaveBeenCalledWith("mcp-1");
      expect(selectionStore.clearSelection).toHaveBeenCalled();
    });

    it("部分刪除失敗時顯示 Toast 但不阻斷其他刪除", async () => {
      const { selectionStore, podStore, repositoryStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
        { type: "repositoryNote", id: "note-1" },
      ] as SelectableElement[];

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      vi.spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValueOnce() // pod-1 成功
        .mockRejectedValueOnce(new Error("Pod 刪除失敗")); // pod-2 失敗

      vi.spyOn(repositoryStore, "deleteNote").mockResolvedValueOnce(); // note-1 成功

      await deleteSelectedElements();

      expect(mockToast).toHaveBeenCalledWith({
        title: "刪除部分失敗",
        description: "1 個物件刪除失敗",
        duration: 3000,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "刪除元素失敗:",
        expect.any(Error),
      );
      expect(selectionStore.clearSelection).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("多個刪除失敗時 Toast 顯示正確失敗數量", async () => {
      const { selectionStore, podStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
        { type: "pod", id: "pod-3" },
      ] as SelectableElement[];

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      vi.spyOn(podStore, "deletePodWithBackend")
        .mockRejectedValueOnce(new Error("失敗 1"))
        .mockRejectedValueOnce(new Error("失敗 2"))
        .mockResolvedValueOnce(); // pod-3 成功

      await deleteSelectedElements();

      expect(mockToast).toHaveBeenCalledWith({
        title: "刪除部分失敗",
        description: "2 個物件刪除失敗",
        duration: 3000,
      });

      expect(selectionStore.clearSelection).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("全部刪除成功時不顯示 Toast", async () => {
      const { selectionStore, podStore } = useCanvasContext();

      const TestComponent = defineComponent({
        setup() {
          return useDeleteSelection();
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      const { deleteSelectedElements } = wrapper.vm as ReturnType<
        typeof useDeleteSelection
      >;

      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
      ] as SelectableElement[];

      vi.spyOn(podStore, "deletePodWithBackend").mockResolvedValue();

      await deleteSelectedElements();

      expect(mockToast).not.toHaveBeenCalled();
      expect(selectionStore.clearSelection).toHaveBeenCalled();
    });
  });

  describe("handleKeyDown", () => {
    it("Delete 鍵觸發刪除", async () => {
      const { selectionStore, podStore } = useCanvasContext();
      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
      ] as SelectableElement[];

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();

      mount(TestComponent);

      // 模擬按下 Delete 鍵
      const event = new KeyboardEvent("keydown", { key: "Delete" });
      document.dispatchEvent(event);

      // 等待 async 操作完成
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deletePodSpy).toHaveBeenCalledWith("pod-1");
    });

    it("在輸入框中按下 Delete 鍵不觸發刪除", async () => {
      const { selectionStore, podStore } = useCanvasContext();
      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
      ] as SelectableElement[];

      mockIsEditingElement.mockReturnValue(true);

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();

      mount(TestComponent);

      const event = new KeyboardEvent("keydown", { key: "Delete" });
      document.dispatchEvent(event);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deletePodSpy).not.toHaveBeenCalled();
    });

    it("無選取時按下 Delete 鍵不觸發刪除", async () => {
      const { selectionStore, podStore } = useCanvasContext();
      selectionStore.selectedElements = [];

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();

      mount(TestComponent);

      const event = new KeyboardEvent("keydown", { key: "Delete" });
      document.dispatchEvent(event);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deletePodSpy).not.toHaveBeenCalled();
    });

    it("按下非 Delete 鍵不觸發刪除", async () => {
      const { selectionStore, podStore } = useCanvasContext();
      selectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
      ] as SelectableElement[];

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      const deletePodSpy = vi
        .spyOn(podStore, "deletePodWithBackend")
        .mockResolvedValue();

      mount(TestComponent);

      const event = new KeyboardEvent("keydown", { key: "Backspace" });
      document.dispatchEvent(event);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deletePodSpy).not.toHaveBeenCalled();
    });
  });

  describe("生命週期", () => {
    it("onMounted 時註冊 keydown 事件監聽器", () => {
      const addEventListenerSpy = vi.spyOn(document, "addEventListener");

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      mount(TestComponent);

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );

      addEventListenerSpy.mockRestore();
    });

    it("onUnmounted 時移除 keydown 事件監聽器", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const TestComponent = defineComponent({
        setup() {
          useDeleteSelection();
          return {};
        },
        template: "<div></div>",
      });

      const wrapper = mount(TestComponent);
      wrapper.unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );

      removeEventListenerSpy.mockRestore();
    });
  });
});
