import { describe, it, expect } from "vitest";
import { useAnchorDetection } from "@/composables/useAnchorDetection";
import { createMockPod } from "../helpers/factories";

describe("useAnchorDetection", () => {
  const { getAnchorPositions, detectTargetAnchor } = useAnchorDetection();

  describe("getAnchorPositions", () => {
    it("計算無旋轉 Pod 的錨點座標", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const anchors = getAnchorPositions(pod);

      expect(anchors).toHaveLength(4);
      expect(anchors).toEqual([
        { podId: "pod-1", anchor: "top", x: 212, y: 100 },
        { podId: "pod-1", anchor: "bottom", x: 212, y: 212 },
        { podId: "pod-1", anchor: "left", x: 100, y: 156 },
        { podId: "pod-1", anchor: "right", x: 324, y: 156 },
      ]);
    });

    it("計算有旋轉 Pod 的錨點座標 (90度)", () => {
      const pod = createMockPod({ id: "pod-2", x: 100, y: 100, rotation: 90 });
      const anchors = getAnchorPositions(pod);

      expect(anchors).toHaveLength(4);

      const topAnchor = anchors.find((a) => a.anchor === "top");
      const bottomAnchor = anchors.find((a) => a.anchor === "bottom");
      const leftAnchor = anchors.find((a) => a.anchor === "left");
      const rightAnchor = anchors.find((a) => a.anchor === "right");

      expect(topAnchor?.x).toBeCloseTo(268, 0);
      expect(topAnchor?.y).toBeCloseTo(156, 0);
      expect(bottomAnchor?.x).toBeCloseTo(156, 0);
      expect(bottomAnchor?.y).toBeCloseTo(156, 0);
      expect(leftAnchor?.x).toBeCloseTo(212, 0);
      expect(leftAnchor?.y).toBeCloseTo(44, 0);
      expect(rightAnchor?.x).toBeCloseTo(212, 0);
      expect(rightAnchor?.y).toBeCloseTo(268, 0);
    });

    it("計算有旋轉 Pod 的錨點座標 (45度)", () => {
      const pod = createMockPod({ id: "pod-3", x: 0, y: 0, rotation: 45 });
      const anchors = getAnchorPositions(pod);

      expect(anchors).toHaveLength(4);

      const topAnchor = anchors.find((a) => a.anchor === "top");
      expect(topAnchor?.podId).toBe("pod-3");
      expect(topAnchor?.x).toBeCloseTo(151.598, 1);
      expect(topAnchor?.y).toBeCloseTo(16.402, 1);
    });
  });

  describe("detectTargetAnchor", () => {
    it("偵測到目標錨點 (距離 ≤ 20px)", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 400, y: 100, rotation: 0 });
      const pods = [pod1, pod2];

      const point = { x: 512, y: 105 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-2");
      expect(result?.anchor).toBe("top");
      expect(result?.x).toBe(512);
      expect(result?.y).toBe(100);
    });

    it("未偵測到 (滑鼠離所有錨點太遠)", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 400, y: 100, rotation: 0 });
      const pods = [pod1, pod2];

      const point = { x: 1000, y: 1000 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).toBeNull();
    });

    it("排除來源 Pod (sourcePodId 對應的 Pod 不參與偵測)", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pods = [pod1];

      const point = { x: 212, y: 100 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).toBeNull();
    });

    it("多個 Pod 偵測到最先匹配的", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 400, y: 100, rotation: 0 });
      const pod3 = createMockPod({ id: "pod-3", x: 700, y: 100, rotation: 0 });
      const pods = [pod1, pod2, pod3];

      const point = { x: 512, y: 100 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-2");
      expect(result?.anchor).toBe("top");
    });

    it("偵測到 bottom 錨點", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 100, y: 400, rotation: 0 });
      const pods = [pod1, pod2];

      const point = { x: 212, y: 505 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-2");
      expect(result?.anchor).toBe("bottom");
      expect(result?.y).toBe(512);
    });

    it("偵測到 left 錨點", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 400, y: 100, rotation: 0 });
      const pods = [pod1, pod2];

      const point = { x: 410, y: 156 };
      const result = detectTargetAnchor(point, pods, "pod-1");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-2");
      expect(result?.anchor).toBe("left");
      expect(result?.x).toBe(400);
    });

    it("偵測到 right 錨點", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pod2 = createMockPod({ id: "pod-2", x: 400, y: 100, rotation: 0 });
      const pods = [pod1, pod2];

      const point = { x: 320, y: 156 };
      const result = detectTargetAnchor(point, pods, "pod-other");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-1");
      expect(result?.anchor).toBe("right");
    });

    it("邊界測試：距離剛好 20px 應該偵測到", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pods = [pod];

      const topAnchor = { x: 212, y: 100 };
      const point = { x: topAnchor.x + 20, y: topAnchor.y };
      const result = detectTargetAnchor(point, pods, "pod-other");

      expect(result).not.toBeNull();
      expect(result?.podId).toBe("pod-1");
      expect(result?.anchor).toBe("top");
    });

    it("邊界測試：距離超過 20px 應該偵測不到", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100, rotation: 0 });
      const pods = [pod];

      const topAnchor = { x: 212, y: 100 };
      const point = { x: topAnchor.x + 21, y: topAnchor.y };
      const result = detectTargetAnchor(point, pods, "pod-other");

      expect(result).toBeNull();
    });
  });
});
