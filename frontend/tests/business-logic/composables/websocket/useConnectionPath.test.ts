import { describe, it, expect } from "vitest";
import { useConnectionPath } from "@/composables/useConnectionPath";
import type { AnchorPosition } from "@/types/connection";

describe("useConnectionPath", () => {
  describe("calculatePathData", () => {
    it("path 應為 SVG Bezier 曲線格式（M ... C ...）", () => {
      const { calculatePathData } = useConnectionPath();

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result.path).toMatch(/^M \d+(\.\d+)?,\d+(\.\d+)? C /);
      expect(result.path).toContain("M ");
      expect(result.path).toContain(" C ");
    });

    it("midPoint 應在起點和終點之間", () => {
      const { calculatePathData } = useConnectionPath();
      const startX = 100;
      const startY = 100;
      const endX = 300;
      const endY = 200;

      const result = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      // midPoint 的 x 應在 startX 和 endX 之間（考慮 Bezier 曲線可能略超出直線範圍）
      expect(result.midPoint.x).toBeGreaterThanOrEqual(
        Math.min(startX, endX) - 50,
      );
      expect(result.midPoint.x).toBeLessThanOrEqual(
        Math.max(startX, endX) + 50,
      );

      // midPoint 的 y 應在 startY 和 endY 之間（考慮 Bezier 曲線可能略超出直線範圍）
      expect(result.midPoint.y).toBeGreaterThanOrEqual(
        Math.min(startY, endY) - 50,
      );
      expect(result.midPoint.y).toBeLessThanOrEqual(
        Math.max(startY, endY) + 50,
      );
    });

    it("不同 anchor 組合應產生不同 control points（top/bottom）", () => {
      const { calculatePathData } = useConnectionPath();
      const startX = 200;
      const startY = 200;
      const endX = 400;
      const endY = 300;

      const topBottom = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "top",
        targetAnchor: "bottom",
      });
      const bottomTop = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "bottom",
        targetAnchor: "top",
      });

      // 不同 anchor 組合應產生不同 path
      expect(topBottom.path).not.toBe(bottomTop.path);

      // 驗證 control points 不同（透過 path 字串）
      const topBottomCoords = topBottom.path.match(/[\d.]+/g)?.map(Number);
      const bottomTopCoords = bottomTop.path.match(/[\d.]+/g)?.map(Number);

      // cp1y 和 cp2y 應該不同（因為 anchor 方向不同）
      expect(topBottomCoords![3]).not.toBe(bottomTopCoords![3]); // cp1y
    });

    it("不同 anchor 組合應產生不同 control points（left/right）", () => {
      const { calculatePathData } = useConnectionPath();
      const startX = 200;
      const startY = 200;
      const endX = 400;
      const endY = 300;

      const leftRight = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "left",
        targetAnchor: "right",
      });
      const rightLeft = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      // 不同 anchor 組合應產生不同 path
      expect(leftRight.path).not.toBe(rightLeft.path);

      // 驗證 control points 不同（透過 path 字串）
      const leftRightCoords = leftRight.path.match(/[\d.]+/g)?.map(Number);
      const rightLeftCoords = rightLeft.path.match(/[\d.]+/g)?.map(Number);

      // cp1x 和 cp2x 應該不同（因為 anchor 方向不同）
      expect(leftRightCoords![2]).not.toBe(rightLeftCoords![2]); // cp1x
    });

    it("起點和終點相同時不應崩潰", () => {
      const { calculatePathData } = useConnectionPath();

      expect(() => {
        calculatePathData({
          start: { x: 100, y: 100 },
          end: { x: 100, y: 100 },
          sourceAnchor: "right",
          targetAnchor: "left",
        });
      }).not.toThrow();
    });

    it("起點和終點相同時應回傳合法資料", () => {
      const { calculatePathData } = useConnectionPath();

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 100, y: 100 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result.path).toBeTruthy();
      expect(result.midPoint.x).toBe(100);
      expect(result.midPoint.y).toBe(100);
      expect(isNaN(result.angle)).toBe(false);
    });

    it("offset 計算應為 min(distance * 0.3, 100)（短距離）", () => {
      const { calculatePathData } = useConnectionPath();
      // 距離 = sqrt((200-100)^2 + (200-100)^2) = sqrt(20000) ≈ 141.4
      // offset = min(141.4 * 0.3, 100) = min(42.4, 100) = 42.4

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 200, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      // 驗證 path 中的 control points 有應用 offset
      // 由於 anchor 是 right/left，offset 應該影響 x 座標
      expect(result.path).toMatch(/C /);

      // path 的格式為 "M startX,startY C cp1x,cp1y cp2x,cp2y endX,endY"
      const coords = result.path.match(/[\d.]+/g)?.map(Number);
      expect(coords!.length).toBe(8); // 4 個點，每點 x, y

      // cp1x (右側 anchor) 應該是 startX + offset ≈ 100 + 42.4 = 142.4
      const cp1x = coords![2];
      expect(cp1x).toBeGreaterThan(100);
      expect(cp1x).toBeLessThan(200);
    });

    it("offset 計算應為 min(distance * 0.3, 100)（長距離）", () => {
      const { calculatePathData } = useConnectionPath();
      // 距離 = sqrt((1000-100)^2 + (1000-100)^2) = sqrt(1620000) ≈ 1272.8
      // offset = min(1272.8 * 0.3, 100) = min(381.8, 100) = 100

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 1000, y: 1000 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      const coords = result.path.match(/[\d.]+/g)?.map(Number);

      // cp1x (右側 anchor) 應該是 startX + offset = 100 + 100 = 200
      const cp1x = coords![2];
      expect(cp1x).toBeCloseTo(200, 1);
    });

    it("所有 anchor 位置應正確計算 offset（top）", () => {
      const { calculatePathData } = useConnectionPath();

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 300 },
        sourceAnchor: "top",
        targetAnchor: "bottom",
      });
      const coords = result.path.match(/[\d.]+/g)?.map(Number);

      // top anchor: cp1y 應該是 startY - offset
      const cp1y = coords![3];
      expect(cp1y).toBeLessThan(100);
    });

    it("所有 anchor 位置應正確計算 offset（bottom）", () => {
      const { calculatePathData } = useConnectionPath();

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 300 },
        sourceAnchor: "bottom",
        targetAnchor: "top",
      });
      const coords = result.path.match(/[\d.]+/g)?.map(Number);

      // bottom anchor: cp1y 應該是 startY + offset
      const cp1y = coords![3];
      expect(cp1y).toBeGreaterThan(100);
    });

    it("angle 應在 -180 到 180 度之間", () => {
      const { calculatePathData } = useConnectionPath();

      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result.angle).toBeGreaterThanOrEqual(-180);
      expect(result.angle).toBeLessThanOrEqual(180);
    });
  });

  describe("calculateMultipleArrowPositions", () => {
    it("應至少回傳 1 個箭頭位置", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const result = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 150, y: 150 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("箭頭數量應隨距離增加", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const shortDistance = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 200, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });
      const longDistance = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 1000, y: 1000 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(longDistance.length).toBeGreaterThan(shortDistance.length);
    });

    it("箭頭數量計算應為 max(1, floor(estimatedLength / spacing))", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();
      // 距離 = sqrt((300-100)^2 + (200-100)^2) = sqrt(50000) ≈ 223.6
      // estimatedLength = 223.6 * 1.2 = 268.3
      // arrowCount = max(1, floor(268.3 / 80)) = max(1, 3) = 3

      const result = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 100 },
          end: { x: 300, y: 200 },
          sourceAnchor: "right",
          targetAnchor: "left",
        },
        80,
      );

      expect(result.length).toBe(3);
    });

    it("自訂 spacing 應影響箭頭數量（較小 spacing）", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const defaultSpacing = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 500, y: 500 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });
      const smallSpacing = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 100 },
          end: { x: 500, y: 500 },
          sourceAnchor: "right",
          targetAnchor: "left",
        },
        40,
      );

      expect(smallSpacing.length).toBeGreaterThan(defaultSpacing.length);
    });

    it("自訂 spacing 應影響箭頭數量（較大 spacing）", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const defaultSpacing = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 500, y: 500 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });
      const largeSpacing = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 100 },
          end: { x: 500, y: 500 },
          sourceAnchor: "right",
          targetAnchor: "left",
        },
        200,
      );

      expect(largeSpacing.length).toBeLessThan(defaultSpacing.length);
    });

    it("預設 spacing 應為 80", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const defaultSpacing = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 500, y: 500 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });
      const explicitSpacing = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 100 },
          end: { x: 500, y: 500 },
          sourceAnchor: "right",
          targetAnchor: "left",
        },
        80,
      );

      expect(defaultSpacing.length).toBe(explicitSpacing.length);
    });

    it("箭頭位置應在起點和終點之間", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();
      const startX = 100;
      const startY = 100;
      const endX = 300;
      const endY = 200;

      const result = calculateMultipleArrowPositions({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      for (const arrow of result) {
        // 箭頭 x 應在起點和終點之間（考慮 Bezier 曲線可能略超出）
        expect(arrow.x).toBeGreaterThanOrEqual(Math.min(startX, endX) - 100);
        expect(arrow.x).toBeLessThanOrEqual(Math.max(startX, endX) + 100);

        // 箭頭 y 應在起點和終點之間（考慮 Bezier 曲線可能略超出）
        expect(arrow.y).toBeGreaterThanOrEqual(Math.min(startY, endY) - 100);
        expect(arrow.y).toBeLessThanOrEqual(Math.max(startY, endY) + 100);
      }
    });

    it("箭頭 angle 應在 -180 到 180 度之間", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const result = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      for (const arrow of result) {
        expect(arrow.angle).toBeGreaterThanOrEqual(-180);
        expect(arrow.angle).toBeLessThanOrEqual(180);
      }
    });

    it("超短距離應只回傳 1 個箭頭", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();
      // 距離 = sqrt(10^2 + 10^2) ≈ 14.1
      // estimatedLength = 14.1 * 1.2 = 16.9
      // arrowCount = max(1, floor(16.9 / 80)) = max(1, 0) = 1

      const result = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 110, y: 110 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result.length).toBe(1);
    });

    it("起點和終點相同時應回傳 1 個箭頭", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const result = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 100, y: 100 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      expect(result.length).toBe(1);
      expect(result[0]?.x).toBe(100);
      expect(result[0]?.y).toBe(100);
    });

    it("不同 anchor 組合應產生不同的箭頭位置", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const topBottom = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 300 },
        sourceAnchor: "top",
        targetAnchor: "bottom",
      });
      const leftRight = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 300 },
        sourceAnchor: "left",
        targetAnchor: "right",
      });

      // 至少第一個箭頭的位置應該不同（因為 Bezier 曲線路徑不同）
      expect(topBottom[0]?.x).not.toBeCloseTo(leftRight[0]!.x, 1);
    });

    it("箭頭應均勻分佈在曲線上", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();

      const result = calculateMultipleArrowPositions({
        start: { x: 100, y: 100 },
        end: { x: 500, y: 500 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });

      // 箭頭數量至少 2 個才能測試分佈
      if (result.length >= 2) {
        // 驗證箭頭之間有間距（不是全部擠在同一點）
        const uniqueX = new Set(result.map((arrow) => Math.round(arrow.x)));
        const uniqueY = new Set(result.map((arrow) => Math.round(arrow.y)));

        expect(uniqueX.size).toBeGreaterThan(1);
        expect(uniqueY.size).toBeGreaterThan(1);
      }
    });
  });

  describe("整合測試", () => {
    it("calculatePathData 和 calculateMultipleArrowPositions 應使用相同的 control points", () => {
      const { calculatePathData, calculateMultipleArrowPositions } =
        useConnectionPath();
      const startX = 100;
      const startY = 100;
      const endX = 300;
      const endY = 200;
      const sourceAnchor: AnchorPosition = "right";
      const targetAnchor: AnchorPosition = "left";

      const pathData = calculatePathData({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor,
        targetAnchor,
      });
      const arrows = calculateMultipleArrowPositions({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        sourceAnchor,
        targetAnchor,
      });

      // 箭頭應該分佈在 path 定義的曲線上
      // 驗證至少有一個箭頭接近 midPoint
      const midPoint = pathData.midPoint;
      const closestArrow = arrows.reduce((closest, arrow) => {
        const currentDist = Math.sqrt(
          Math.pow(arrow.x - midPoint.x, 2) + Math.pow(arrow.y - midPoint.y, 2),
        );
        const closestDist = Math.sqrt(
          Math.pow(closest.x - midPoint.x, 2) +
            Math.pow(closest.y - midPoint.y, 2),
        );
        return currentDist < closestDist ? arrow : closest;
      });

      // 最接近的箭頭應該離 midPoint 不太遠（容差 100px）
      const distance = Math.sqrt(
        Math.pow(closestArrow.x - midPoint.x, 2) +
          Math.pow(closestArrow.y - midPoint.y, 2),
      );
      expect(distance).toBeLessThan(100);
    });
  });
});
