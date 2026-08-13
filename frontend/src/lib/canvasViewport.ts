import type { Position } from "@/types";

export interface CanvasViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getCanvasViewportBounds(params: {
  offset: Position;
  zoom: number;
  screenWidth: number;
  screenHeight: number;
  bufferRatio: number;
}): CanvasViewportBounds {
  const { offset, zoom, screenWidth, screenHeight, bufferRatio } = params;
  const bufferX = screenWidth * bufferRatio;
  const bufferY = screenHeight * bufferRatio;

  return {
    left: (-offset.x - bufferX) / zoom,
    top: (-offset.y - bufferY) / zoom,
    right: (-offset.x + screenWidth + bufferX) / zoom,
    bottom: (-offset.y + screenHeight + bufferY) / zoom,
  };
}

export function isCanvasRectVisible(
  bounds: CanvasViewportBounds,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    rect.x + rect.width >= bounds.left &&
    rect.x <= bounds.right &&
    rect.y + rect.height >= bounds.top &&
    rect.y <= bounds.bottom
  );
}

export function isCanvasSegmentBoundsVisible(
  bounds: CanvasViewportBounds,
  start: Position,
  end: Position,
): boolean {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);

  return !(
    right < bounds.left ||
    left > bounds.right ||
    bottom < bounds.top ||
    top > bounds.bottom
  );
}
