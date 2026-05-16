import { ref } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import { isCtrlOrCmdPressed } from "@/utils/keyboardHelpers";
import { useDragHandler } from "@/composables/useDragHandler";

const BOX_SELECT_THRESHOLD = 5;

export function useBoxSelect(): {
  isBoxSelecting: import("vue").Ref<boolean>;
  startBoxSelect: (event: MouseEvent) => void;
} {
  const {
    viewportStore,
    selectionStore,
    podStore,
    repositoryStore,
  } = useCanvasContext();

  const isBoxSelecting = ref(false);

  let startClientX = 0;
  let startClientY = 0;

  // noteGroups 快照：在 startBoxSelect 時建立，onMove 期間直接重用，避免每幀分配新陣列
  let noteGroupsSnapshot: Parameters<
    typeof selectionStore.calculateSelectedElements
  >[0]["noteGroups"] = [];

  const { startDrag } = useDragHandler({
    onMove: (moveEvent: MouseEvent): void => {
      const moveCanvasX =
        (moveEvent.clientX - viewportStore.offset.x) / viewportStore.zoom;
      const moveCanvasY =
        (moveEvent.clientY - viewportStore.offset.y) / viewportStore.zoom;
      selectionStore.updateSelection(moveCanvasX, moveCanvasY);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: noteGroupsSnapshot,
      });
    },
    onEnd: (upEvent: MouseEvent): void => {
      const deltaX = Math.abs(upEvent.clientX - startClientX);
      const deltaY = Math.abs(upEvent.clientY - startClientY);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance < BOX_SELECT_THRESHOLD) {
        selectionStore.cancelSelection();
      } else {
        selectionStore.endSelection();
      }

      isBoxSelecting.value = false;
    },
  });

  const shouldStartBoxSelect = (
    event: MouseEvent,
    target: HTMLElement,
  ): boolean => {
    if (event.button !== 0) return false;
    if (
      !target.classList.contains("canvas-grid") &&
      !target.classList.contains("canvas-content")
    )
      return false;
    if (viewportStore.zoom === 0) return false;
    return true;
  };

  const startBoxSelect = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;

    if (!shouldStartBoxSelect(event, target)) return;

    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      document.activeElement.blur();
    }

    event.preventDefault();

    startClientX = event.clientX;
    startClientY = event.clientY;
    const canvasX =
      (event.clientX - viewportStore.offset.x) / viewportStore.zoom;
    const canvasY =
      (event.clientY - viewportStore.offset.y) / viewportStore.zoom;

    const isCtrlPressed = isCtrlOrCmdPressed(event);
    selectionStore.startSelection(canvasX, canvasY, isCtrlPressed);
    isBoxSelecting.value = true;

    // 建立 noteGroups 快照，後續 onMove 直接重用，不再每幀重組陣列
    noteGroupsSnapshot = [
      { notes: repositoryStore.notes, type: "repositoryNote" as const },
    ];

    startDrag(event);
  };

  return {
    isBoxSelecting,
    startBoxSelect,
  };
}
