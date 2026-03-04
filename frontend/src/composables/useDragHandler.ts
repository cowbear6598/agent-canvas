import { ref, onUnmounted } from 'vue'
import type { Ref } from 'vue'

interface UseDragHandlerOptions {
    onMove: (mouseEvent: MouseEvent) => void
    onEnd: (mouseEvent: MouseEvent) => void
    button?: 0 | 1 | 2
}

interface UseDragHandlerReturn {
    startDrag: (e: MouseEvent) => void
    isDragging: Ref<boolean>
}

export function useDragHandler(options: UseDragHandlerOptions): UseDragHandlerReturn {
    const isDragging = ref(false)
    const triggerButton = options.button ?? 0

    let currentMoveHandler: ((e: MouseEvent) => void) | null = null
    let currentUpHandler: ((e: MouseEvent) => void) | null = null

    const cleanup = (): void => {
        if (currentMoveHandler) {
            document.removeEventListener('mousemove', currentMoveHandler)
            currentMoveHandler = null
        }
        if (currentUpHandler) {
            document.removeEventListener('mouseup', currentUpHandler)
            currentUpHandler = null
        }
    }

    const startDrag = (mouseEvent: MouseEvent): void => {
        if (mouseEvent.button !== triggerButton) return

        cleanup()
        isDragging.value = true

        currentMoveHandler = (moveEvent: MouseEvent): void => {
            options.onMove(moveEvent)
        }

        currentUpHandler = (upEvent: MouseEvent): void => {
            isDragging.value = false
            cleanup()
            options.onEnd(upEvent)
        }

        document.addEventListener('mousemove', currentMoveHandler)
        document.addEventListener('mouseup', currentUpHandler)
    }

    onUnmounted(() => {
        cleanup()
    })

    return {
        startDrag,
        isDragging,
    }
}
