import type { Pod } from '@/types'
import type { AnchorPosition, Connection, DraggingConnection } from '@/types/connection'
import { useAnchorDetection } from '@/composables/useAnchorDetection'

interface AnchorDragStores {
  viewportStore: {
    offset: { x: number; y: number }
    zoom: number
  }
  connectionStore: {
    draggingConnection: DraggingConnection | null
    startDragging: (podId: string, anchor: AnchorPosition, point: { x: number; y: number }) => void
    updateDraggingPosition: (point: { x: number; y: number }) => void
    endDragging: () => void
    createConnection: (
      sourcePodId: string,
      sourceAnchor: AnchorPosition,
      targetPodId: string,
      targetAnchor: AnchorPosition
    ) => Promise<Connection | null>
  }
  podStore: {
    pods: Pod[]
  }
}

interface UsePodAnchorDragReturn {
  handleAnchorDragStart: (data: {
    podId: string
    anchor: AnchorPosition
    screenX: number
    screenY: number
  }) => void
  handleAnchorDragMove: (data: { screenX: number; screenY: number }) => void
  handleAnchorDragEnd: () => Promise<void>
}

export function usePodAnchorDrag(stores: AnchorDragStores): UsePodAnchorDragReturn {
  const { viewportStore, connectionStore, podStore } = stores
  const { detectTargetAnchor } = useAnchorDetection()

  const screenToCanvas = (screenX: number, screenY: number): { x: number; y: number } => ({
    x: (screenX - viewportStore.offset.x) / viewportStore.zoom,
    y: (screenY - viewportStore.offset.y) / viewportStore.zoom,
  })

  const handleAnchorDragStart = (data: {
    podId: string
    anchor: AnchorPosition
    screenX: number
    screenY: number
  }): void => {
    const canvasPoint = screenToCanvas(data.screenX, data.screenY)
    connectionStore.startDragging(data.podId, data.anchor, canvasPoint)
  }

  const handleAnchorDragMove = (data: { screenX: number; screenY: number }): void => {
    const canvasPoint = screenToCanvas(data.screenX, data.screenY)
    connectionStore.updateDraggingPosition(canvasPoint)
  }

  const handleAnchorDragEnd = async (): Promise<void> => {
    if (!connectionStore.draggingConnection) {
      connectionStore.endDragging()
      return
    }

    const { sourcePodId, sourceAnchor, currentPoint } = connectionStore.draggingConnection
    if (!sourcePodId) return

    const targetAnchor = detectTargetAnchor(currentPoint, podStore.pods, sourcePodId)

    if (targetAnchor) {
      await connectionStore.createConnection(
        sourcePodId,
        sourceAnchor,
        targetAnchor.podId,
        targetAnchor.anchor
      )
    }

    connectionStore.endDragging()
  }

  return {
    handleAnchorDragStart,
    handleAnchorDragMove,
    handleAnchorDragEnd,
  }
}
