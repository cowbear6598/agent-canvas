import { describe, expect, it } from "vitest";
import {
  buildCanvasCommandPayload,
  buildCanvasPodCommandPayload,
} from "@/stores/canvasScopedCommand";

describe("canvasScopedCommand", () => {
  it("應集中組裝 canvas-scoped payload", () => {
    expect(buildCanvasCommandPayload("canvas-1", { runId: "run-1" })).toEqual({
      canvasId: "canvas-1",
      runId: "run-1",
    });
  });

  it("應集中組裝 canvas + pod scoped payload", () => {
    expect(
      buildCanvasPodCommandPayload("canvas-1", "pod-1", {
        runId: "run-1",
        limit: 50,
      }),
    ).toEqual({
      canvasId: "canvas-1",
      podId: "pod-1",
      runId: "run-1",
      limit: 50,
    });
  });
});
