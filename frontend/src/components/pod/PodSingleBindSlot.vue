<script setup lang="ts">
import { ref } from 'vue'
import type { BaseNote } from '@/types'
import type { UnbindBehavior } from '@/stores/note/noteBindingActions'
import { useSlotDropTarget } from '@/composables/pod/useSlotDropTarget'
import { useSlotEject } from '@/composables/pod/useSlotEject'
import { useViewportStore } from '@/stores/pod'

interface SingleBindStore {
  draggedNoteId: string | null
  getNoteById: (noteId: string) => (BaseNote & { x: number; y: number; id: string }) | undefined
  setNoteAnimating: (noteId: string, animating: boolean) => void
  unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>
}

const props = defineProps<{
  podId: string
  boundNote: BaseNote | undefined
  store: SingleBindStore
  label: string
  slotClass: string
  podRotation?: number
}>()

const emit = defineEmits<{
  'note-dropped': [noteId: string]
  'note-removed': []
}>()

const viewportStore = useViewportStore()
const slotRef = ref<HTMLElement | null>(null)

const { isDropTarget, isInserting } = useSlotDropTarget({
  slotRef,
  draggedNoteId: () => props.store.draggedNoteId,
  validateDrop: (noteId: string) => {
    const draggedNote = props.store.getNoteById(noteId)
    return draggedNote !== undefined && !draggedNote.boundToPodId
  },
  onDrop: (noteId: string) => {
    emit('note-dropped', noteId)
  },
})

const { isEjecting, handleSlotClick: ejectSlotClick } = useSlotEject({
  slotRef,
  podRotation: () => props.podRotation ?? 0,
  getNoteById: (id: string) => props.store.getNoteById(id),
  setNoteAnimating: (noteId: string, animating: boolean) => props.store.setNoteAnimating(noteId, animating),
  unbindFromPod: (podId: string, behavior: UnbindBehavior) =>
    props.store.unbindFromPod(podId, behavior),
  getViewportZoom: () => viewportStore.zoom,
  getViewportOffset: () => viewportStore.offset,
})

const handleSlotClick = async (e: MouseEvent): Promise<void> => {
  if (!props.boundNote) return
  await ejectSlotClick(e, props.boundNote.id, props.podId, () => emit('note-removed'))
}
</script>

<template>
  <div
    ref="slotRef"
    class="pod-slot-base"
    :class="[
      slotClass,
      {
        'drop-target': isDropTarget,
        'pod-slot-has-item': boundNote !== undefined,
        'has-note': boundNote !== undefined,
        'ejecting': isEjecting,
        'inserting': isInserting,
      },
    ]"
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
