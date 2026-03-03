import { type Ref, onMounted, onUnmounted } from 'vue'
import { websocketClient } from '@/services/websocket'
import { WebSocketRequestEvents } from '@/types/websocket'
import type { CursorMovePayload } from '@/types/websocket'
import { useViewportStore } from '@/stores/pod/viewportStore'
import { throttle } from '@/utils/throttle'

const THROTTLE_INTERVAL_MS = 100

export function useCursorTracker(containerRef: Ref<HTMLElement | null>): void {
  const viewportStore = useViewportStore()

  const sendCursorPosition = (x: number, y: number): void => {
    websocketClient.emit<CursorMovePayload>(WebSocketRequestEvents.CURSOR_MOVE, { x, y })
  }

  const throttledSend = throttle(sendCursorPosition, THROTTLE_INTERVAL_MS)

  const handleMouseMove = (e: MouseEvent): void => {
    if (!websocketClient.isConnected.value) return

    const canvasPos = viewportStore.screenToCanvas(e.clientX, e.clientY)
    throttledSend(canvasPos.x, canvasPos.y)
  }

  onMounted(() => {
    if (!containerRef.value) return
    containerRef.value.addEventListener('mousemove', handleMouseMove)
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('mousemove', handleMouseMove)
    }
    throttledSend.cancel()
  })
}
