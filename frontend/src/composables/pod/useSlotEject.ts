import type { Ref } from "vue";
import { ref } from "vue";
import { DEGREES_TO_RADIANS } from "@/lib/constants";
import type { UnbindBehavior } from "@/stores/note/noteBindingActions";

interface NotePosition {
  id: string;
  x: number;
  y: number;
}

export interface UseSlotEjectOptions {
  slotRef: Ref<HTMLElement | null>;
  podRotation: () => number;
  getNoteById: (id: string) => NotePosition | undefined;
  setNoteAnimating: (noteId: string, animating: boolean) => void;
  unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>;
  getViewportZoom: () => number;
  getViewportOffset: () => { x: number; y: number };
}

interface UseSlotEjectReturn {
  isEjecting: Ref<boolean>;
  handleSlotClick: (
    e: MouseEvent,
    boundNoteId: string,
    podId: string,
    onRemoved: () => void,
  ) => Promise<void>;
}

const EJECT_X_OFFSET_PX = 30;
const EJECT_ANIMATION_DURATION_MS = 300;

export function useSlotEject(options: UseSlotEjectOptions): UseSlotEjectReturn {
  const {
    slotRef,
    podRotation,
    getNoteById,
    setNoteAnimating,
    unbindFromPod,
    getViewportZoom,
    getViewportOffset,
  } = options;

  const isEjecting = ref(false);

  const handleSlotClick = async (
    e: MouseEvent,
    boundNoteId: string,
    podId: string,
    onRemoved: () => void,
  ): Promise<void> => {
    if (isEjecting.value) return;

    e.stopPropagation();
    e.preventDefault();

    const note = getNoteById(boundNoteId);
    if (!note) return;

    const slotElement = slotRef.value;
    if (!slotElement) return;

    const zoom = getViewportZoom();

    const podElement = slotElement.closest(".pod-wrapper");
    if (!podElement) return;

    const podRect = podElement.getBoundingClientRect();
    const slotRect = slotElement.getBoundingClientRect();
    const viewportOffset = getViewportOffset();

    const podCenterX = (podRect.right - viewportOffset.x) / zoom;
    const podCenterY = (slotRect.top - viewportOffset.y) / zoom;

    const baseY = 0;

    const rotation = podRotation();
    const radians = rotation * DEGREES_TO_RADIANS;

    const rotatedX =
      EJECT_X_OFFSET_PX * Math.cos(radians) - baseY * Math.sin(radians);
    const rotatedY =
      EJECT_X_OFFSET_PX * Math.sin(radians) + baseY * Math.cos(radians);

    const ejectX = podCenterX + rotatedX;
    const ejectY = podCenterY + rotatedY;

    isEjecting.value = true;
    setNoteAnimating(boundNoteId, true);

    await unbindFromPod(podId, {
      mode: "move-to-position",
      position: { x: ejectX, y: ejectY },
    });

    onRemoved();

    setTimeout(() => {
      isEjecting.value = false;
      setNoteAnimating(boundNoteId, false);
    }, EJECT_ANIMATION_DURATION_MS);
  };

  return {
    isEjecting,
    handleSlotClick,
  };
}
