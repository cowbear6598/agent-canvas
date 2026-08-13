import type { AnchorPosition } from '@/types/connection'
import { RADIANS_TO_DEGREES } from '@/lib/constants'

export interface PathData {
  path: string
  midPoint: { x: number; y: number }
  angle: number
}

export interface ArrowPosition {
  x: number
  y: number
  angle: number
}

export interface BezierPathParams {
  start: { x: number; y: number }
  end: { x: number; y: number }
  sourceAnchor: AnchorPosition
  targetAnchor: AnchorPosition
}

const CURVE_MIDPOINT = 0.5
const TANGENT_STEP = 0.01
const BEZIER_LENGTH_ESTIMATION_FACTOR = 1.2
const BEZIER_CONTROL_POINT_RATIO = 0.3
const BEZIER_MAX_OFFSET_PX = 100
const MAX_CONNECTION_ARROWS = 5

function applyAnchorOffset(
  baseX: number,
  baseY: number,
  anchor: AnchorPosition,
  offset: number
): { x: number; y: number } {
  let x = baseX
  let y = baseY

  if (anchor === 'top') {
    y -= offset
  } else if (anchor === 'bottom') {
    y += offset
  } else if (anchor === 'left') {
    x -= offset
  } else if (anchor === 'right') {
    x += offset
  }

  return { x, y }
}

export function useConnectionPath(): {
  calculatePathData: (params: BezierPathParams) => PathData
  calculateMultipleArrowPositions: (params: BezierPathParams, spacing?: number) => ArrowPosition[]
} {
  const calculateControlPoints = (
    params: BezierPathParams
  ): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } => {
    const { start, end, sourceAnchor, targetAnchor } = params
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const offset = Math.min(distance * BEZIER_CONTROL_POINT_RATIO, BEZIER_MAX_OFFSET_PX)

    const cp1 = applyAnchorOffset(start.x, start.y, sourceAnchor, offset)
    const cp2 = applyAnchorOffset(end.x, end.y, targetAnchor, offset)

    return { cp1x: cp1.x, cp1y: cp1.y, cp2x: cp2.x, cp2y: cp2.y }
  }

  const calculateBezierPoint = (
    curveParameter: number,
    startPoint: number,
    controlPoint1: number,
    controlPoint2: number,
    endPoint: number
  ): number => {
    const oneMinusT = 1 - curveParameter
    return (
      oneMinusT * oneMinusT * oneMinusT * startPoint +
      3 * oneMinusT * oneMinusT * curveParameter * controlPoint1 +
      3 * oneMinusT * curveParameter * curveParameter * controlPoint2 +
      curveParameter * curveParameter * curveParameter * endPoint
    )
  }

  const calculateBezierTangent = (
    curveParameter: number,
    startPoint: number,
    controlPoint1: number,
    controlPoint2: number,
    endPoint: number
  ): number => {
    const oneMinusT = 1 - curveParameter
    const tSquared = curveParameter * curveParameter
    const oneMinusTSquared = oneMinusT * oneMinusT
    return (
      3 * oneMinusTSquared * (controlPoint1 - startPoint) +
      6 * oneMinusT * curveParameter * (controlPoint2 - controlPoint1) +
      3 * tSquared * (endPoint - controlPoint2)
    )
  }

  const calculatePathData = (
    params: BezierPathParams
  ): PathData => {
    const { start, end } = params
    const { cp1x, cp1y, cp2x, cp2y } = calculateControlPoints(params)

    const path = `M ${start.x},${start.y} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${end.x},${end.y}`

    const midX = calculateBezierPoint(CURVE_MIDPOINT, start.x, cp1x, cp2x, end.x)
    const midY = calculateBezierPoint(CURVE_MIDPOINT, start.y, cp1y, cp2y, end.y)

    const beforeX = calculateBezierPoint(CURVE_MIDPOINT - TANGENT_STEP, start.x, cp1x, cp2x, end.x)
    const beforeY = calculateBezierPoint(CURVE_MIDPOINT - TANGENT_STEP, start.y, cp1y, cp2y, end.y)
    const afterX = calculateBezierPoint(CURVE_MIDPOINT + TANGENT_STEP, start.x, cp1x, cp2x, end.x)
    const afterY = calculateBezierPoint(CURVE_MIDPOINT + TANGENT_STEP, start.y, cp1y, cp2y, end.y)

    const angle = Math.atan2(afterY - beforeY, afterX - beforeX) * RADIANS_TO_DEGREES

    return {
      path,
      midPoint: { x: midX, y: midY },
      angle,
    }
  }

  const calculateMultipleArrowPositions = (
    params: BezierPathParams,
    spacing: number = 80
  ): ArrowPosition[] => {
    const { start, end } = params
    const { cp1x, cp1y, cp2x, cp2y } = calculateControlPoints(params)

    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const straightDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const estimatedLength = straightDistance * BEZIER_LENGTH_ESTIMATION_FACTOR

    const arrowCount = Math.min(
      MAX_CONNECTION_ARROWS,
      Math.max(1, Math.floor(estimatedLength / spacing))
    )

    const arrows: ArrowPosition[] = []
    for (let i = 1; i <= arrowCount; i++) {
      const curveParameter = i / (arrowCount + 1)

      const x = calculateBezierPoint(curveParameter, start.x, cp1x, cp2x, end.x)
      const y = calculateBezierPoint(curveParameter, start.y, cp1y, cp2y, end.y)

      const tangentX = calculateBezierTangent(curveParameter, start.x, cp1x, cp2x, end.x)
      const tangentY = calculateBezierTangent(curveParameter, start.y, cp1y, cp2y, end.y)
      const angle = Math.atan2(tangentY, tangentX) * RADIANS_TO_DEGREES

      arrows.push({ x, y, angle })
    }

    return arrows
  }

  return {
    calculatePathData,
    calculateMultipleArrowPositions,
  }
}
