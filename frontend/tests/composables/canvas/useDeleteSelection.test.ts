import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod } from "../../helpers/factories";
import { useDeleteSelection } from "@/composables/canvas/useDeleteSelection";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import type { SelectableElement } from "@/types";

vi.mock("@/services/websocket", () => webSocketMockFactory());

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

  function mountComposable(): ReturnType<typeof useDeleteSelection> {
    const TestComponent = defineComponent({
      setup() {
        return useDeleteSelection();
      },
      template: "<div></div>",
    });

    const wrapper = mount(TestComponent);
    return wrapper.vm as ReturnType<typeof useDeleteSelection>;
  }

  it("無選中元素時不操作", async () => {
    const { selectionStore, podStore } = useCanvasContext();
    const { deleteSelectedElements } = mountComposable();
    selectionStore.selectedElements = [];

    const deletePodSpy = vi.spyOn(podStore, "deletePodWithBackend");
    await deleteSelectedElements();

    expect(deletePodSpy).not.toHaveBeenCalled();
  });

  it("可刪除選中的 pod 與 repository note", async () => {
    const { selectionStore, podStore, repositoryStore } = useCanvasContext();
    const { deleteSelectedElements } = mountComposable();

    podStore.pods = [createMockPod({ id: "pod-1" })];
    selectionStore.selectedElements = [
      { type: "pod", id: "pod-1" },
      { type: "repositoryNote", id: "note-1" },
    ] as SelectableElement[];

    const deletePodSpy = vi
      .spyOn(podStore, "deletePodWithBackend")
      .mockResolvedValue();
    const deleteNoteSpy = vi
      .spyOn(repositoryStore, "deleteNote")
      .mockResolvedValue();

    await deleteSelectedElements();

    expect(deletePodSpy).toHaveBeenCalledWith("pod-1");
    expect(deleteNoteSpy).toHaveBeenCalledWith("note-1");
    expect(selectionStore.selectedElements).toEqual([]);
  });

  it("部分刪除失敗時顯示 toast", async () => {
    const { selectionStore, podStore, repositoryStore } = useCanvasContext();
    const { deleteSelectedElements } = mountComposable();

    selectionStore.selectedElements = [
      { type: "pod", id: "pod-1" },
      { type: "repositoryNote", id: "note-1" },
    ] as SelectableElement[];

    vi.spyOn(podStore, "deletePodWithBackend").mockRejectedValueOnce(
      new Error("Pod 刪除失敗"),
    );
    vi.spyOn(repositoryStore, "deleteNote").mockResolvedValueOnce();

    await deleteSelectedElements();

    expect(mockToast).toHaveBeenCalledWith({
      title: "刪除部分失敗",
      description: "1 個物件刪除失敗",
      duration: 3000,
    });
  });
});
