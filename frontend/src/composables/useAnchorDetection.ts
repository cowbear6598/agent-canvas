import type { Pod } from '@/types/pod'
import type { AnchorPoint, AnchorPosition } from '@/types/connection'
import { POD_WIDTH, POD_HEIGHT, DEGREES_TO_RADIANS } from '@/lib/constants'

const DETECTION_RADIUS = 20

const anchorOffsets: Record<AnchorPosition, { localX: number; localY: number }> = {
  top: { localX: POD_WIDTH / 2, localY: 0 },
  bottom: { localX: POD_WIDTH / 2, localY: POD_HEIGHT },
  left: { localX: 0, localY: POD_HEIGHT / 2 },
  right: { localX: POD_WIDTH, localY: POD_HEIGHT / 2 },
}

export function useAnchorDetection(): {
  getAnchorPositions: (pod: Pod) => AnchorPoint[]
  detectTargetAnchor: (point: { x: number; y: number }, pods: Pod[], sourcePodId: string) => AnchorPoint | null
} {
  const getAnchorPositions = (pod: Pod): AnchorPoint[] => {
    const positions: AnchorPosition[] = ['top', 'bottom', 'left', 'right']

    const rotation = pod.rotation || 0
    const radians = rotation * DEGREES_TO_RADIANS

    const centerX = pod.x + POD_WIDTH / 2
    const centerY = pod.y + POD_HEIGHT / 2

    return positions.map(anchor => {
      const { localX, localY } = anchorOffsets[anchor]

      const relativeX = localX - POD_WIDTH / 2
      const relativeY = localY - POD_HEIGHT / 2

      const rotatedX = relativeX * Math.cos(radians) - relativeY * Math.sin(radians)
      const rotatedY = relativeX * Math.sin(radians) + relativeY * Math.cos(radians)

      return {
        podId: pod.id,
        anchor,
        x: centerX + rotatedX,
        y: centerY + rotatedY,
      }
    })
  }

  const findAnchorForPod = (
    pod: Pod,
    point: { x: number; y: number },
    sourcePodId: string
  ): AnchorPoint | null => {
    if (pod.id === sourcePodId) return null

    const anchors = getAnchorPositions(pod)

    for (const anchor of anchors) {
      const dx = point.x - anchor.x
      const dy = point.y - anchor.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= DETECTION_RADIUS) {
        return anchor
      }
    }

    return null
  }

  const detectTargetAnchor = (
    point: { x: number; y: number },
    pods: Pod[],
    sourcePodId: string
  ): AnchorPoint | null => {
    for (const pod of pods) {
      const anchor = findAnchorForPod(pod, point, sourcePodId)
      if (anchor) return anchor
    }

    return null
  }

  return {
    getAnchorPositions,
    detectTargetAnchor,
  }
}
