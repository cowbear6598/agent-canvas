<script setup lang="ts">
import { ref } from "vue";
import type { BaseNote } from "@/types";
import type { UnbindBehavior } from "@/stores/note/noteBindingActions";
import { useSlotDropTarget } from "@/composables/pod/useSlotDropTarget";
import { useSlotEject } from "@/composables/pod/useSlotEject";
import { useViewportStore } from "@/stores/pod";

interface SingleBindStore {
  draggedNoteId: string | null;
  getNoteById: (
    noteId: string,
  ) => (BaseNote & { x: number; y: number; id: string }) | undefined;
  setNoteAnimating: (noteId: string, animating: boolean) => void;
  unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>;
}

const props = defineProps<{
  podId: string;
  boundNote: BaseNote | undefined;
  store: SingleBindStore;
  label: string;
  slotClass: string;
  podRotation?: number;
  /** 是否停用此 slot（不接受 drop、顯示 disabled 樣式） */
  disabled?: boolean;
  /** disabled 時 hover 顯示的說明文字 */
  disabledTooltip?: string;
}>();

const emit = defineEmits<{
  "note-dropped": [noteId: string];
  "note-removed": [];
}>();

const viewportStore = useViewportStore();
const slotRef = ref<HTMLElement | null>(null);

const { isDropTarget, isInserting } = useSlotDropTarget({
  slotRef,
  draggedNoteId: () => props.store.draggedNoteId,
  validateDrop: (noteId: string) => {
    // disabled 時不接受 drop
    if (props.disabled) return false;
    const draggedNote = props.store.getNoteById(noteId);
    return draggedNote !== undefined && !draggedNote.boundToPodId;
  },
  onDrop: (noteId: string) => {
    emit("note-dropped", noteId);
  },
});

const { isEjecting, handleSlotClick: ejectSlotClick } = useSlotEject({
  slotRef,
  podRotation: () => props.podRotation ?? 0,
  getNoteById: (id: string) => props.store.getNoteById(id),
  setNoteAnimating: (noteId: string, animating: boolean) =>
    props.store.setNoteAnimating(noteId, animating),
  unbindFromPod: (podId: string, behavior: UnbindBehavior) =>
    props.store.unbindFromPod(podId, behavior),
  getViewportZoom: () => viewportStore.zoom,
  getViewportOffset: () => viewportStore.offset,
});

const handleSlotClick = async (e: MouseEvent): Promise<void> => {
  // disabled 時不處理點擊
  if (props.disabled) return;
  if (!props.boundNote) return;
  await ejectSlotClick(e, props.boundNote.id, props.podId, () =>
    emit("note-removed"),
  );
};
</script>

<template>
  <!--
    單一 div 結構：disabled 切換不再造成 DOM 重建，避免已綁定 Note 的 slot
    在 disabled=true 時退回虛線空槽樣式（pod-slot-has-item / has-note 仍維持）。
    disabled 時透過 useSlotDropTarget 內 validateDrop 阻擋 drop，
    handleSlotClick 內也已守門，因此不需要為 isInserting / isDropTarget / ejecting 額外加條件。
  -->
  <div
    ref="slotRef"
    class="pod-slot-base"
    :class="[
      slotClass,
      {
        'drop-target': isDropTarget,
        'pod-slot-has-item': boundNote !== undefined,
        'has-note': boundNote !== undefined,
        ejecting: isEjecting,
        inserting: isInserting,
        'opacity-50 cursor-not-allowed': disabled,
      },
    ]"
    :title="disabled ? disabledTooltip : undefined"
    @click="handleSlotClick"
  >
    <template v-if="boundNote">
      <span class="text-xs font-mono">{{ boundNote.name }}</span>
    </template>
    <template v-else>
      <span class="text-xs font-mono opacity-50">{{ label }}</span>
    </template>
  </div>
</template>
