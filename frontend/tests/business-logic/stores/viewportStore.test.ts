import { describe, it, expect } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useViewportStore } from "@/stores/pod/viewportStore";

describe("viewportStore canvas coordinate rules", () => {
  setupStoreTest();

  it("converts a screen click into canvas coordinates after pan and zoom", () => {
    const store = useViewportStore();
    store.setOffset(20, 40);
    store.zoom = 2;

    const canvasPoint = store.screenToCanvas(120, 240);

    expect(canvasPoint).toEqual({ x: 50, y: 100 });
  });

  it("keeps the same canvas point under the cursor when zooming", () => {
    const store = useViewportStore();
    store.setOffset(50, 50);
    store.zoom = 1;

    const beforeZoom = store.screenToCanvas(200, 200);
    store.zoomTo(2, 200, 200);
    const afterZoom = store.screenToCanvas(200, 200);

    expect(beforeZoom).toEqual({ x: 150, y: 150 });
    expect(afterZoom).toEqual(beforeZoom);
    expect(store.offset).toEqual({ x: -100, y: -100 });
  });

  it("clamps zoom so users cannot zoom beyond supported canvas bounds", () => {
    const store = useViewportStore();

    store.zoomTo(10, 100, 100);
    expect(store.zoom).toBe(3);

    store.zoom = 1;
    store.setOffset(0, 0);
    store.zoomTo(0.01, 100, 100);
    expect(store.zoom).toBe(0.1);
  });

  it("centers the viewport when the canvas is reset for a loaded workspace", () => {
    const store = useViewportStore();
    store.setOffset(999, 999);
    store.zoom = 3;

    store.resetToCenter();

    expect(store.offset).toEqual({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    expect(store.zoom).toBe(0.75);
  });
});
