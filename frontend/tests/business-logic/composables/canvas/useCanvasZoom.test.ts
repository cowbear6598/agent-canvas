import { describe, it, expect, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useCanvasZoom } from "@/composables/canvas/useCanvasZoom";
import { useViewportStore } from "@/stores/pod/viewportStore";
import {
  WHEEL_DELTA_PIXEL_FACTOR,
  WHEEL_DELTA_LINE_FACTOR,
  WHEEL_DELTA_PAGE_FACTOR,
  ZOOM_PINCH_FACTOR_MAC,
  ZOOM_PINCH_FACTOR_DEFAULT,
} from "@/lib/constants";

// Mock useCanvasContext
vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => {
    const viewportStore = useViewportStore();
    return { viewportStore };
  },
}));

// Mock platform
vi.mock("@/utils/platform", () => ({
  isMacOS: false,
}));

describe("useCanvasZoom", () => {
  setupStoreTest();

  describe("handleWheelZoom", () => {
    it("向下滾動（deltaY > 0）應縮小", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 500,
        clientY: 400,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, top: 50 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      const expectedZoom = 1 * Math.pow(2, -100 * WHEEL_DELTA_PIXEL_FACTOR);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        400,
        350,
      );
    });

    it("向上滾動（deltaY < 0）應放大", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 600,
        clientY: 300,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 50, top: 100 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      const expectedZoom = 1 * Math.pow(2, 100 * WHEEL_DELTA_PIXEL_FACTOR);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        550,
        200,
      );
    });

    it("應正確計算滑鼠相對於畫布的位置", () => {
      const viewportStore = useViewportStore();
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: -50,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 1000,
        clientY: 800,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 200, top: 150 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      expect(zoomToSpy).toHaveBeenCalledWith(expect.any(Number), 800, 650);
    });

    it("zoom 為 2 時向下滾動應正確縮放", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 2;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 300,
        clientY: 300,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      const expectedZoom = 2 * Math.pow(2, -100 * WHEEL_DELTA_PIXEL_FACTOR);

      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        300,
        300,
      );
    });

    it("zoom 為 0.5 時向上滾動應正確縮放", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 0.5;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 400,
        clientY: 500,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      const expectedZoom = 0.5 * Math.pow(2, 100 * WHEEL_DELTA_PIXEL_FACTOR);

      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        400,
        500,
      );
    });

    it("應呼叫 event.preventDefault()", () => {
      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("deltaY 為 0 時縮放比例應為 1（不縮放）", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 0,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      // deltaY === 0 時，delta = 0，Math.pow(2, 0) = 1，縮放比不變
      expect(zoomToSpy).toHaveBeenCalledWith(1, 100, 100);
    });

    it("多次滾動應累積縮放效果", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      const zoom1 = 1 * Math.pow(2, -100 * WHEEL_DELTA_PIXEL_FACTOR);
      handleWheelZoom(mockEvent);
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(zoom1, 5),
        100,
        100,
      );

      viewportStore.zoom = zoom1;

      const zoom2 = zoom1 * Math.pow(2, -100 * WHEEL_DELTA_PIXEL_FACTOR);
      handleWheelZoom(mockEvent);
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(zoom2, 5),
        100,
        100,
      );
    });

    it("應使用 currentTarget 而非 target 計算位置", () => {
      const viewportStore = useViewportStore();
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 500,
        clientY: 400,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, top: 50 }),
        },
        target: {
          getBoundingClientRect: () => ({ left: 999, top: 999 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      const expectedZoom = 1 * Math.pow(2, 100 * WHEEL_DELTA_PIXEL_FACTOR);
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        400,
        350,
      );
    });

    it("Firefox line 模式（deltaMode=1）應套用 WHEEL_DELTA_LINE_FACTOR", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 3,
        deltaX: 0,
        deltaMode: 1,
        ctrlKey: false,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      // deltaY=3, WHEEL_DELTA_LINE_FACTOR=0.05 → raw=-0.15，在 clamp 範圍 [-0.2, 0.2] 內不被截斷
      const rawDelta = -3 * WHEEL_DELTA_LINE_FACTOR;
      const clampedDelta = Math.max(-0.2, Math.min(0.2, rawDelta));
      const expectedZoom = 1 * Math.pow(2, clampedDelta);
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        100,
        100,
      );
    });

    it("page 模式（deltaMode=2）應套用 WHEEL_DELTA_PAGE_FACTOR", () => {
      const viewportStore = useViewportStore();
      viewportStore.zoom = 1;
      const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

      const { handleWheelZoom } = useCanvasZoom();

      const mockEvent = {
        deltaY: 0.1,
        deltaX: 0,
        deltaMode: 2,
        ctrlKey: false,
        clientX: 100,
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        },
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      handleWheelZoom(mockEvent);

      // deltaY=0.1, WHEEL_DELTA_PAGE_FACTOR=1 → raw=-0.1，在 clamp 範圍內不被截斷
      const rawDelta =
        -0.1 * WHEEL_DELTA_PAGE_FACTOR * ZOOM_PINCH_FACTOR_DEFAULT;
      const clampedDelta = Math.max(-0.2, Math.min(0.2, rawDelta));
      const expectedZoom = 1 * Math.pow(2, clampedDelta);
      expect(zoomToSpy).toHaveBeenCalledWith(
        expect.closeTo(expectedZoom, 5),
        100,
        100,
      );
    });

    describe("ctrlKey=true 路徑", () => {
      it("ctrlKey=true + isMacOS=true 時應使用 ZOOM_PINCH_FACTOR_MAC", async () => {
        const platformModule = await import("@/utils/platform");
        vi.mocked(platformModule).isMacOS = true;

        const viewportStore = useViewportStore();
        viewportStore.zoom = 1;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: 1,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: true,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        // ctrlKey=true + isMacOS=true → factor = ZOOM_PINCH_FACTOR_MAC
        // deltaY=1, deltaMode=0 → raw = -1 * WHEEL_DELTA_PIXEL_FACTOR * ZOOM_PINCH_FACTOR_MAC
        const rawDelta = -1 * WHEEL_DELTA_PIXEL_FACTOR * ZOOM_PINCH_FACTOR_MAC;
        const clampedDelta = Math.max(-0.2, Math.min(0.2, rawDelta));
        const expectedZoom = 1 * Math.pow(2, clampedDelta);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );

        // 恢復預設值
        vi.mocked(platformModule).isMacOS = false;
      });

      it("ctrlKey=true + isMacOS=false 時應使用 ZOOM_PINCH_FACTOR_DEFAULT", async () => {
        const platformModule = await import("@/utils/platform");
        vi.mocked(platformModule).isMacOS = false;

        const viewportStore = useViewportStore();
        viewportStore.zoom = 1;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: 100,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: true,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        // ctrlKey=true + isMacOS=false → factor = ZOOM_PINCH_FACTOR_DEFAULT = 1
        // 與 ctrlKey=false 相同的計算結果
        const rawDelta =
          -100 * WHEEL_DELTA_PIXEL_FACTOR * ZOOM_PINCH_FACTOR_DEFAULT;
        const clampedDelta = Math.max(-0.2, Math.min(0.2, rawDelta));
        const expectedZoom = 1 * Math.pow(2, clampedDelta);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );
      });

      it("ctrlKey=true + isMacOS=true 時，相同 deltaY 應產生比 isMacOS=false 更大的縮放量", async () => {
        const platformModule = await import("@/utils/platform");
        const viewportStore = useViewportStore();
        viewportStore.zoom = 1;

        const { handleWheelZoom } = useCanvasZoom();

        // isMacOS=false 的情境
        vi.mocked(platformModule).isMacOS = false;
        const zoomToSpyNonMac = vi.spyOn(viewportStore, "zoomTo");
        const mockEventNonMac = {
          deltaY: 1,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: true,
          clientX: 100,
          clientY: 100,
          currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;
        handleWheelZoom(mockEventNonMac);
        const [zoomNonMac] = zoomToSpyNonMac.mock.calls[0]!;

        // isMacOS=true 的情境
        vi.mocked(platformModule).isMacOS = true;
        zoomToSpyNonMac.mockClear();
        const mockEventMac = {
          deltaY: 1,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: true,
          clientX: 100,
          clientY: 100,
          currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;
        handleWheelZoom(mockEventMac);
        const [zoomMac] = zoomToSpyNonMac.mock.calls[0]!;

        // Mac 因為 factor 較大（15），縮放量絕對值應大於 non-Mac（1）
        expect(Math.abs(1 - zoomMac)).toBeGreaterThan(Math.abs(1 - zoomNonMac));

        // 恢復預設值
        vi.mocked(platformModule).isMacOS = false;
      });
    });

    describe("clamp 行為", () => {
      it("極大 deltaY（正值）計算的 raw delta 超出上限，應被 clamp 到 0.2", () => {
        const viewportStore = useViewportStore();
        viewportStore.zoom = 1;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: 1000,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: false,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        // raw = -1000 * 0.0008 * 1 = -0.8，超出下限 -0.2，應 clamp 到 -0.2
        const expectedZoom = 1 * Math.pow(2, -0.2);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );
      });

      it("極大負 deltaY 計算的 raw delta 超出上限，應被 clamp 到 0.2", () => {
        const viewportStore = useViewportStore();
        viewportStore.zoom = 1;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: -1000,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: false,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        // raw = -(-1000) * 0.0008 * 1 = 0.8，超出上限 0.2，應 clamp 到 0.2
        const expectedZoom = 1 * Math.pow(2, 0.2);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );
      });

      it("clamp 後縮小時的 zoom 值應為 initialZoom * 2^(-0.2)", () => {
        const viewportStore = useViewportStore();
        viewportStore.zoom = 2;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: 1000,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: false,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        const expectedZoom = 2 * Math.pow(2, -0.2);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );
      });

      it("clamp 後放大時的 zoom 值應為 initialZoom * 2^0.2", () => {
        const viewportStore = useViewportStore();
        viewportStore.zoom = 2;
        const zoomToSpy = vi.spyOn(viewportStore, "zoomTo");

        const { handleWheelZoom } = useCanvasZoom();

        const mockEvent = {
          deltaY: -1000,
          deltaX: 0,
          deltaMode: 0,
          ctrlKey: false,
          clientX: 100,
          clientY: 100,
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
          preventDefault: vi.fn(),
        } as unknown as WheelEvent;

        handleWheelZoom(mockEvent);

        const expectedZoom = 2 * Math.pow(2, 0.2);
        expect(zoomToSpy).toHaveBeenCalledWith(
          expect.closeTo(expectedZoom, 5),
          100,
          100,
        );
      });
    });
  });
});
