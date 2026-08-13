import { describe, expect, it } from "vitest";
import {
  getCanvasViewportBounds,
  isCanvasRectVisible,
  isCanvasSegmentBoundsVisible,
} from "@/lib/canvasViewport";

describe("canvasViewport", () => {
  const bounds = getCanvasViewportBounds({
    offset: { x: 0, y: 0 },
    zoom: 1,
    screenWidth: 1000,
    screenHeight: 800,
    bufferRatio: 0.5,
  });

  it("應將螢幕尺寸與 buffer 轉成畫布範圍", () => {
    expect(bounds).toEqual({
      left: -500,
      top: -400,
      right: 1500,
      bottom: 1200,
    });
  });

  it("只保留與視口相交的矩形", () => {
    expect(
      isCanvasRectVisible(bounds, { x: 1490, y: 1190, width: 20, height: 20 }),
    ).toBe(true);
    expect(
      isCanvasRectVisible(bounds, { x: 1600, y: 1300, width: 20, height: 20 }),
    ).toBe(false);
  });

  it("連線兩端在視口外但跨越視口時仍應保留", () => {
    expect(
      isCanvasSegmentBoundsVisible(
        bounds,
        { x: -1000, y: 400 },
        { x: 2000, y: 400 },
      ),
    ).toBe(true);
  });
});
