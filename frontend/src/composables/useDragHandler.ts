import { ref, onUnmounted } from 'vue'
import type { Ref } from 'vue'

interface UseDragHandlerOptions {
    onMove: (e: MouseEvent) => void
    onEnd: (e: MouseEvent) => void
    /** 觸發拖曳的滑鼠按鍵（預設 0 = 左鍵，2 = 右鍵） */
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

    const startDrag = (e: MouseEvent): void => {
        if (e.button !== triggerButton) return

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
