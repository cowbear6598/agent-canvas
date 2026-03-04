<script setup lang="ts">
import { ref } from 'vue'
import type { BaseNote } from '@/types'
import type { UnbindBehavior } from '@/stores/note/noteBindingActions'
import { useSlotDropTarget } from '@/composables/pod/useSlotDropTarget'
import { useSlotEject } from '@/composables/pod/useSlotEject'

const props = defineProps<{
  podId: string
  boundNote: BaseNote | undefined
  slotClass: string
  placeholder: string
  podRotation?: number
  draggedNoteId: () => string | null
  validateDrop: (noteId: string) => boolean
  getNoteById: (id: string) => BaseNote | undefined
  setNoteAnimating: (noteId: string, animating: boolean) => void
  unbindFromPod: (podId: string, behavior: UnbindBehavior) => Promise<void>
  getViewportZoom: () => number
  getViewportOffset: () => { x: number; y: number }
}>()

const emit = defineEmits<{
  'note-dropped': [noteId: string]
  'note-removed': []
}>()

const slotRef = ref<HTMLElement | null>(null)

const { isDropTarget, isInserting } = useSlotDropTarget({
  slotRef,
  draggedNoteId: props.draggedNoteId,
  validateDrop: props.validateDrop,
  onDrop: (noteId: string) => {
    emit('note-dropped', noteId)
  }
})

const { isEjecting, handleSlotClick: ejectSlotClick } = useSlotEject({
  slotRef,
  podRotation: () => props.podRotation ?? 0,
  getNoteById: props.getNoteById,
  setNoteAnimating: props.setNoteAnimating,
  unbindFromPod: props.unbindFromPod,
  getViewportZoom: props.getViewportZoom,
  getViewportOffset: props.getViewportOffset
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
        'inserting': isInserting
      }
    ]"
    @click="handleSlotClick"
  >
    <template v-if="boundNote">
      <span class="text-xs font-mono">{{ boundNote.name }}</span>
    </template>
    <template v-else>
      <span class="text-xs font-mono opacity-50">{{ placeholder }}</span>
    </template>
  </div>
</template>
