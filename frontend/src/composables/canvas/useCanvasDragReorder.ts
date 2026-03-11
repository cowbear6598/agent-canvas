import {ref, toRaw} from 'vue'
import type {Ref} from 'vue'
import type {Canvas} from '@/types/canvas'
import {useCanvasStore} from '@/stores/canvasStore'

interface UseCanvasDragReorderReturn {
  draggedIndex: Ref<number | null>
  dragOverIndex: Ref<number | null>
  handleDragStart: (event: Event, index: number) => void
  handleDragEnd: () => void
  handleDragOver: (event: Event, index: number) => void
  handleDragEnter: (event: Event, index: number) => void
  handleDragLeave: (event: Event) => void
  handleDrop: (event: Event, targetIndex: number) => void
  handleSidebarDragLeave: (event: Event) => void
  cancelDrag: () => void
}

export function useCanvasDragReorder(sidebarRef: Ref<HTMLElement | undefined>): UseCanvasDragReorderReturn {
  const canvasStore = useCanvasStore()

  const draggedIndex = ref<number | null>(null)
  const dragOverIndex = ref<number | null>(null)
  const isDraggingOver = ref(false)
  const originalCanvases = ref<Canvas[]>([])

  const handleDragStart = (event: Event, index: number): void => {
    if (!(event instanceof DragEvent)) return
    if (!event.dataTransfer) return

    const canvas = canvasStore.canvases[index]
    if (!canvas) return

    draggedIndex.value = index
    originalCanvases.value = structuredClone(toRaw(canvasStore.canvases))

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', canvas.id)

    canvasStore.setDragging(true, canvas.id)
  }

  const handleDragEnd = (): void => {
    draggedIndex.value = null
    dragOverIndex.value = null
    isDraggingOver.value = false
    canvasStore.setDragging(false, null)
  }

  const handleDragOver = (event: Event, index: number): void => {
    if (!(event instanceof DragEvent)) return

    event.preventDefault()
    if (!event.dataTransfer) return

    event.dataTransfer.dropEffect = 'move'
    dragOverIndex.value = index
  }

  const handleDragEnter = (event: Event, index: number): void => {
    dragOverIndex.value = index
  }

  const handleDragLeave = (event: Event): void => {
    if (!(event instanceof DragEvent)) return

    const relatedTarget = event.relatedTarget

    if (!(relatedTarget instanceof HTMLElement)) {
      dragOverIndex.value = null
      return
    }

    if (!sidebarRef.value?.contains(relatedTarget)) {
      dragOverIndex.value = null
    }
  }

  const handleDrop = (event: Event, targetIndex: number): void => {
    if (!(event instanceof DragEvent)) return

    event.preventDefault()

    if (draggedIndex.value === null || draggedIndex.value === targetIndex) {
      return
    }

    canvasStore.reorderCanvases(draggedIndex.value, targetIndex)

    draggedIndex.value = null
    dragOverIndex.value = null
    isDraggingOver.value = false
  }

  const cancelDrag = (): void => {
    if (draggedIndex.value !== null && originalCanvases.value.length > 0) {
      canvasStore.revertCanvasOrder(originalCanvases.value)
    }

    draggedIndex.value = null
    dragOverIndex.value = null
    isDraggingOver.value = false
    originalCanvases.value = []
    canvasStore.setDragging(false, null)
  }

  const handleSidebarDragLeave = (event: Event): void => {
    if (!(event instanceof DragEvent)) return

    const relatedTarget = event.relatedTarget

    if (!(relatedTarget instanceof HTMLElement)) {
      cancelDrag()
      return
    }

    if (!sidebarRef.value?.contains(relatedTarget)) {
      cancelDrag()
    }
  }

  return {
    draggedIndex,
    dragOverIndex,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleSidebarDragLeave,
    cancelDrag,
  }
}
