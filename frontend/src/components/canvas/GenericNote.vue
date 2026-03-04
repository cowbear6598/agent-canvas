<script setup lang="ts">
import { ref, onUnmounted, computed } from 'vue'
import type { BaseNote } from '@/types'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import { useBatchDrag } from '@/composables/canvas'
import { isCtrlOrCmdPressed } from '@/utils/keyboardHelpers'

type NoteType = 'outputStyle' | 'skill' | 'subAgent' | 'repository' | 'command' | 'mcpServer'

interface Props {
  note: BaseNote
  noteType: NoteType
  branchName?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'drag-end': [data: { noteId: string; x: number; y: number }]
  'drag-move': [data: { noteId: string; screenX: number; screenY: number }]
  'drag-complete': [data: { noteId: string; isOverTrash: boolean; startX: number; startY: number }]
  'contextmenu': [data: { noteId: string; event: MouseEvent }]
  'dblclick': [data: { noteId: string; noteType: NoteType }]
}>()

const {
  viewportStore,
  selectionStore,
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  connectionStore
} = useCanvasContext()
const { startBatchDrag, isElementSelected } = useBatchDrag()

const NOTE_TYPE_CONFIG = {
  outputStyle: {
    store: outputStyleStore,
    selectionType: 'outputStyleNote' as const,
    cssClass: 'output-style-note',
  },
  skill: {
    store: skillStore,
    selectionType: 'skillNote' as const,
    cssClass: 'skill-note',
  },
  subAgent: {
    store: subAgentStore,
    selectionType: 'subAgentNote' as const,
    cssClass: 'subagent-note',
  },
  repository: {
    store: repositoryStore,
    selectionType: 'repositoryNote' as const,
    cssClass: 'repository-note',
  },
  command: {
    store: commandStore,
    selectionType: 'commandNote' as const,
    cssClass: 'command-note',
  },
  mcpServer: {
    store: mcpServerStore,
    selectionType: 'mcpServerNote' as const,
    cssClass: 'mcp-server-note',
  },
} as const

const noteStore = computed(() => NOTE_TYPE_CONFIG[props.noteType]?.store ?? outputStyleStore)

const isDragging = ref(false)
const isAnimating = computed(() => noteStore.value.isNoteAnimating(props.note.id))

const isSelected = computed(() => {
  const selectionType = NOTE_TYPE_CONFIG[props.noteType].selectionType
  return selectionStore.isElementSelected(selectionType, props.note.id)
})

const dragRef = ref<{
  startX: number
  startY: number
  noteX: number
  noteY: number
} | null>(null)
const startPosition = ref<{ x: number; y: number } | null>(null)

let currentMouseMoveHandler: ((e: MouseEvent) => void) | null = null
let currentMouseUpHandler: (() => void) | null = null

const cleanupEventListeners = (): void => {
  if (currentMouseMoveHandler) {
    document.removeEventListener('mousemove', currentMouseMoveHandler)
    currentMouseMoveHandler = null
  }
  if (currentMouseUpHandler) {
    document.removeEventListener('mouseup', currentMouseUpHandler)
    currentMouseUpHandler = null
  }
}

onUnmounted(() => {
  cleanupEventListeners()
})

const resolveStartPosition = (): { x: number; y: number } => ({
  x: startPosition.value?.x ?? props.note.x,
  y: startPosition.value?.y ?? props.note.y,
})

const onMouseMove = (moveEvent: MouseEvent): void => {
  if (!dragRef.value) return
  const dx = (moveEvent.clientX - dragRef.value.startX) / viewportStore.zoom
  const dy = (moveEvent.clientY - dragRef.value.startY) / viewportStore.zoom

  emit('drag-end', {
    noteId: props.note.id,
    x: dragRef.value.noteX + dx,
    y: dragRef.value.noteY + dy,
  })

  emit('drag-move', {
    noteId: props.note.id,
    screenX: moveEvent.clientX,
    screenY: moveEvent.clientY,
  })
}

const onMouseUp = (): void => {
  const { x: startX, y: startY } = resolveStartPosition()

  emit('drag-complete', {
    noteId: props.note.id,
    isOverTrash: noteStore.value.isOverTrash,
    startX,
    startY,
  })

  isDragging.value = false
  noteStore.value.setDraggedNote(null)
  noteStore.value.setIsDraggingNote(false)
  startPosition.value = null
  dragRef.value = null
  cleanupEventListeners()
}

const handleCtrlClick = (): void => {
  const selectionType = NOTE_TYPE_CONFIG[props.noteType].selectionType
  selectionStore.toggleElement({ type: selectionType, id: props.note.id })
}

const tryStartBatchDragOrSelect = (e: MouseEvent): boolean => {
  const selectionType = NOTE_TYPE_CONFIG[props.noteType].selectionType

  if (isElementSelected(selectionType, props.note.id) && selectionStore.selectedElements.length > 1) {
    return startBatchDrag(e)
  }

  if (!isElementSelected(selectionType, props.note.id)) {
    selectionStore.setSelectedElements([{ type: selectionType, id: props.note.id }])
  }

  return false
}

const startSingleDrag = (e: MouseEvent): void => {
  cleanupEventListeners()

  isDragging.value = true
  noteStore.value.setDraggedNote(props.note.id)
  noteStore.value.setIsDraggingNote(true)

  startPosition.value = { x: props.note.x, y: props.note.y }
  dragRef.value = {
    startX: e.clientX,
    startY: e.clientY,
    noteX: props.note.x,
    noteY: props.note.y,
  }

  currentMouseMoveHandler = onMouseMove
  currentMouseUpHandler = onMouseUp

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 使用 document 級別的事件監聽器而非 Vue 事件系統的原因：
// 1. 需要追蹤全局 mousemove/mouseup 事件（不受組件邊界限制）
// 2. 需要計算相對於 viewport 的坐標變化
// 3. 需要在 unmount 時精確清理監聽器以防記憶體洩漏
const handleMouseDown = (e: MouseEvent): void => {
  connectionStore.selectConnection(null)

  if (isCtrlOrCmdPressed(e)) {
    handleCtrlClick()
    return
  }

  if (tryStartBatchDragOrSelect(e)) return

  startSingleDrag(e)
}

const cssClass = computed(() => ['note-base', NOTE_TYPE_CONFIG[props.noteType].cssClass])

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault()
  emit('contextmenu', { noteId: props.note.id, event: e })
}

const displayName = computed(() => {
  if (props.noteType === 'repository' && props.branchName) {
    return `${props.note.name} (${props.branchName})`
  }
  return props.note.name
})

/**
 * 處理雙擊事件
 * outputStyle、subAgent、command、mcpServer 四種類型可編輯
 */
const handleDoubleClick = (): void => {
  const editableTypes: NoteType[] = ['outputStyle', 'subAgent', 'command', 'mcpServer']

  if (editableTypes.includes(props.noteType)) {
    emit('dblclick', { noteId: props.note.id, noteType: props.noteType })
  }
}
</script>

<template>
  <div
    :class="[cssClass, { dragging: isDragging, animating: isAnimating, selected: isSelected }]"
    :style="{
      left: `${note.x}px`,
      top: `${note.y}px`,
    }"
    @mousedown="handleMouseDown"
    @contextmenu="handleContextMenu"
    @dblclick="handleDoubleClick"
  >
    <div class="note-text-base">
      {{ displayName }}
    </div>
  </div>
</template>
