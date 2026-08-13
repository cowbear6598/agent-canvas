import { ref, onMounted, onUnmounted } from "vue";
import type { Ref } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import { useDragHandler } from "@/composables/useDragHandler";
import { MOUSE_BUTTON, WHEEL_LINE_TO_PX } from "@/lib/constants";
import { isMacOS } from "@/utils/platform";

const MIN_PAN_DISTANCE = 3;

interface CanvasPanOptions {
  onRightClick?: (mouseEvent: MouseEvent) => void;
}

export function useCanvasPan(options?: CanvasPanOptions): {
  isPanning: Ref<boolean>;
  hasPanned: Ref<boolean>;
  isSpacePressed: Ref<boolean>;
  isSpacePanning: Ref<boolean>;
  startPan: (mouseEvent: MouseEvent) => void;
  startSpacePan: (mouseEvent: MouseEvent) => void;
  handleWheelPan: (event: WheelEvent) => void;
  resetPanState: () => void;
} {
  const { viewportStore } = useCanvasContext();
  const hasPanned = ref(false);
  const isSpacePressed = ref(false);
  let offsetFrameId: number | null = null;
  let pendingOffset: { x: number; y: number } | null = null;

  const applyPendingOffset = (): void => {
    if (!pendingOffset) return;
    viewportStore.setOffset(pendingOffset.x, pendingOffset.y);
    pendingOffset = null;
  };

  const flushPendingOffset = (): void => {
    if (offsetFrameId !== null) {
      window.cancelAnimationFrame(offsetFrameId);
      offsetFrameId = null;
    }
    applyPendingOffset();
  };

  const scheduleOffset = (x: number, y: number): void => {
    pendingOffset = { x, y };
    if (offsetFrameId !== null) return;
    offsetFrameId = window.requestAnimationFrame(() => {
      offsetFrameId = null;
      applyPendingOffset();
    });
  };

  // === 右鍵拖拽狀態 ===
  let startX = 0;
  let startY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;
  let panStartEvent: MouseEvent | null = null;

  const { isDragging: isPanning, startDrag } = useDragHandler({
    button: MOUSE_BUTTON.RIGHT,
    onMove: (mouseEvent: MouseEvent): void => {
      const horizontalDelta = mouseEvent.clientX - startX;
      const verticalDelta = mouseEvent.clientY - startY;

      if (
        !hasPanned.value &&
        (Math.abs(horizontalDelta) > MIN_PAN_DISTANCE ||
          Math.abs(verticalDelta) > MIN_PAN_DISTANCE)
      ) {
        hasPanned.value = true;
      }

      scheduleOffset(
        startOffsetX + horizontalDelta,
        startOffsetY + verticalDelta,
      );
    },
    onEnd: (): void => {
      flushPendingOffset();
      const didPan = hasPanned.value;
      const panEvent = panStartEvent;

      panStartEvent = null;

      // Mac 上 contextmenu 事件可能早於 mouseup 觸發，
      // 改在 mouseup 時判斷是否為單純右鍵點擊，才觸發選單
      if (!didPan && options?.onRightClick && panEvent) {
        options.onRightClick(panEvent);
      }
    },
  });

  const startPan = (mouseEvent: MouseEvent): void => {
    if (mouseEvent.button !== MOUSE_BUTTON.RIGHT) return;

    const target = mouseEvent.target as HTMLElement;

    if (
      target.id === "canvas" ||
      target.classList.contains("canvas-grid") ||
      target.classList.contains("canvas-content")
    ) {
      hasPanned.value = false;
      startX = mouseEvent.clientX;
      startY = mouseEvent.clientY;
      startOffsetX = viewportStore.offset.x;
      startOffsetY = viewportStore.offset.y;
      panStartEvent = mouseEvent;

      startDrag(mouseEvent);
    }
  };

  // === Space+左鍵拖拽狀態 ===
  let spaceStartX = 0;
  let spaceStartY = 0;
  let spaceStartOffsetX = 0;
  let spaceStartOffsetY = 0;

  const { isDragging: isSpacePanning, startDrag: startSpaceDrag } =
    useDragHandler({
      button: MOUSE_BUTTON.LEFT,
      onMove: (mouseEvent: MouseEvent): void => {
        const horizontalDelta = mouseEvent.clientX - spaceStartX;
        const verticalDelta = mouseEvent.clientY - spaceStartY;

        scheduleOffset(
          spaceStartOffsetX + horizontalDelta,
          spaceStartOffsetY + verticalDelta,
        );
      },
      onEnd: flushPendingOffset,
    });

  const startSpacePan = (mouseEvent: MouseEvent): void => {
    if (mouseEvent.button !== MOUSE_BUTTON.LEFT) return;
    if (!isSpacePressed.value) return;

    spaceStartX = mouseEvent.clientX;
    spaceStartY = mouseEvent.clientY;
    spaceStartOffsetX = viewportStore.offset.x;
    spaceStartOffsetY = viewportStore.offset.y;

    startSpaceDrag(mouseEvent);
  };

  // === Wheel 平移 ===
  function handleWheelPan(event: WheelEvent): void {
    event.preventDefault();

    // Firefox deltaMode=1 代表「行」模式，需換算為 px
    const normalize = event.deltaMode === 1 ? WHEEL_LINE_TO_PX : 1;

    let deltaX = event.deltaX * normalize;
    let deltaY = event.deltaY * normalize;

    // Windows 特殊處理：Shift+滾輪 → 水平滾動
    if (!isMacOS && event.shiftKey && deltaX === 0 && deltaY !== 0) {
      deltaX = deltaY;
      deltaY = 0;
    }

    // offset 是螢幕空間座標（與右鍵拖拽一致），不需要除以 zoom
    const baseOffset = pendingOffset ?? viewportStore.offset;
    scheduleOffset(baseOffset.x - deltaX, baseOffset.y - deltaY);
  }

  // 判斷事件目標是否為可編輯元素，避免在輸入框中攔截 Space
  function isEditableTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
  }

  // === Space 按鍵監聽 ===
  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" && !e.repeat) {
      if (isEditableTarget(e.target as HTMLElement | null)) return;

      e.preventDefault();
      isSpacePressed.value = true;
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      isSpacePressed.value = false;
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  });

  onUnmounted(() => {
    flushPendingOffset();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  });

  const resetPanState = (): void => {
    hasPanned.value = false;
  };

  return {
    isPanning,
    hasPanned,
    isSpacePressed,
    isSpacePanning,
    startPan,
    startSpacePan,
    handleWheelPan,
    resetPanState,
  };
}
