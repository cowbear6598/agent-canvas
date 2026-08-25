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

      expect(result.path).toMatch(
        /^M \d+(\.\d+)?,\d+(\.\d+)? L \d+(\.\d+)?,\d+(\.\d+)? C /,
      );
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

      const controlMatch = result.path.match(/C ([\d.]+),([\d.]+)/);
      const cp1x = Number(controlMatch![1]);
      expect(cp1x).toBeGreaterThan(124);
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

      const controlMatch = result.path.match(/C ([\d.]+),([\d.]+)/);
      const cp1x = Number(controlMatch![1]);
      expect(cp1x).toBeCloseTo(224, 1);
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

    it("水平排列的 Bezier 連線應可沿垂直方向調整曲率", () => {
      const { calculatePathData } = useConnectionPath();
      const base = calculatePathData({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "bezier",
      });
      const adjusted = calculatePathData({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "bezier",
        routingOffset: -120,
      });

      expect(adjusted.routeAxis).toBe("y");
      expect(adjusted.handlePoint.y).toBeCloseTo(base.handlePoint.y - 120);
      expect(adjusted.path).not.toBe(base.path);
    });

    it("垂直排列的 Bezier 連線應可沿水平方向調整曲率", () => {
      const { calculatePathData } = useConnectionPath();
      const base = calculatePathData({
        start: { x: 200, y: 100 },
        end: { x: 200, y: 500 },
        sourceAnchor: "bottom",
        targetAnchor: "top",
        routingMode: "bezier",
      });
      const adjusted = calculatePathData({
        start: { x: 200, y: 100 },
        end: { x: 200, y: 500 },
        sourceAnchor: "bottom",
        targetAnchor: "top",
        routingMode: "bezier",
        routingOffset: 90,
      });

      expect(adjusted.routeAxis).toBe("x");
      expect(adjusted.handlePoint.x).toBeCloseTo(base.handlePoint.x + 90);
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

    it("極長連線最多產生 5 個箭頭", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();
      const arrows = calculateMultipleArrowPositions(
        {
          start: { x: -100_000, y: -100_000 },
          end: { x: 100_000, y: 100_000 },
          sourceAnchor: "right",
          targetAnchor: "left",
        },
        160,
      );

      expect(arrows).toHaveLength(5);
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
        end: { x: 300, y: 300 },
        sourceAnchor: "right",
        targetAnchor: "left",
      });
      const smallSpacing = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 100 },
          end: { x: 300, y: 300 },
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

  describe("orthogonal routing", () => {
    it("應產生只包含水平與垂直線段的 SVG path", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "orthogonal",
        routingOffset: -120,
      });

      expect(result.path).toContain("L ");
      expect(result.path).not.toContain("C ");
      expect(result.path).toBe(
        "M 100,200 L 124,200 L 124,80 L 476,80 L 476,200 L 500,200",
      );
      expect(result.routeAxis).toBe("y");
      expect(result.handlePoint.y).toBe(80);
      expect(result.bounds.top).toBe(80);
    });

    it("垂直排列的端點應以水平方向調整 routing offset", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 100, y: 500 },
        sourceAnchor: "bottom",
        targetAnchor: "top",
        routingMode: "orthogonal",
        routingOffset: 90,
      });

      expect(result.routeAxis).toBe("x");
      expect(result.handlePoint.x).toBe(190);
      expect(result.bounds.right).toBe(190);
    });

    it("路徑方向應依端點排列決定，端點直線則依 anchor 方向", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "top",
        targetAnchor: "bottom",
        routingMode: "orthogonal",
        routingOffset: -120,
      });

      expect(result.routeAxis).toBe("y");
      expect(result.path).toBe(
        "M 100,200 L 100,80 L 500,80 L 500,224 L 500,200",
      );
    });

    it("Bezier 兩端應保留固定 24px 的 anchor 直線", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 100, y: 100 },
        end: { x: 300, y: 100 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "bezier",
      });

      expect(result.path).toMatch(/^M 100,100 L 124,100 C /);
      expect(result.path).toMatch(/ 276,100 L 300,100$/);
    });

    it("箭頭應沿直角折線排列且角度為水平或垂直", () => {
      const { calculateMultipleArrowPositions } = useConnectionPath();
      const arrows = calculateMultipleArrowPositions(
        {
          start: { x: 100, y: 200 },
          end: { x: 500, y: 200 },
          sourceAnchor: "right",
          targetAnchor: "left",
          routingMode: "orthogonal",
          routingOffset: -120,
        },
        80,
      );

      expect(arrows.length).toBeGreaterThan(1);
      for (const arrow of arrows) {
        expect(Math.abs(arrow.angle) % 90).toBe(0);
      }
    });

    it("Bezier 應平滑穿過最多三個路徑節點", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 0, y: 100 },
        end: { x: 500, y: 100 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "bezier",
        routingPoints: [
          { x: 150, y: 20 },
          { x: 300, y: 180 },
          { x: 400, y: 40 },
        ],
      });

      expect(result.path.match(/ C /g)).toHaveLength(4);
      expect(result.path).toContain("150,20");
      expect(result.path).toContain("300,180");
      expect(result.path).toContain("400,40");
    });

    it("多個直角控制點應維持共用主通道，不形成階梯", () => {
      const { calculatePathData } = useConnectionPath();
      const result = calculatePathData({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "orthogonal",
        routingPoints: [
          { x: 300, y: 80, orthogonalRole: "lane" },
          { x: 400, y: 140, orthogonalRole: "target-leg" },
        ],
      });

      expect(result.path).toBe(
        "M 100,200 L 124,200 L 124,80 L 400,80 L 400,200 L 500,200",
      );
      expect(result.path).not.toContain("L 400,140");
    });

    it("舊版無角色控制點應推斷成 ㄇ 形控制角色", () => {
      const { calculatePathData, calculateRoutingControlPoints } =
        useConnectionPath();
      const params = {
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right" as const,
        targetAnchor: "left" as const,
        routingMode: "orthogonal" as const,
        routingPoints: [
          { x: 300, y: 80 },
          { x: 400, y: 140 },
        ],
      };

      expect(calculatePathData(params).path).toBe(
        "M 100,200 L 124,200 L 124,80 L 400,80 L 400,200 L 500,200",
      );
      expect(
        calculateRoutingControlPoints(params).map(
          (point) => point.orthogonalRole,
        ),
      ).toEqual(["lane", "target-leg"]);
    });

    it("新增把手會隨既有節點增加，達三個後停止提供", () => {
      const { calculateInsertionHandles } = useConnectionPath();
      const base = {
        start: { x: 0, y: 100 },
        end: { x: 500, y: 100 },
        sourceAnchor: "right" as const,
        targetAnchor: "left" as const,
        routingMode: "bezier" as const,
      };

      expect(calculateInsertionHandles(base)).toHaveLength(1);
      expect(
        calculateInsertionHandles({
          ...base,
          routingPoints: [{ x: 250, y: 20 }],
        }),
      ).toHaveLength(2);
      expect(
        calculateInsertionHandles({
          ...base,
          routingPoints: [
            { x: 175, y: 20 },
            { x: 325, y: 180 },
          ],
        }),
      ).toHaveLength(1);
      expect(
        calculateInsertionHandles({
          ...base,
          routingPoints: [
            { x: 125, y: 20 },
            { x: 250, y: 180 },
            { x: 375, y: 20 },
          ],
        }),
      ).toHaveLength(0);
    });

    it("ㄇ形直角線會在三段線的中心提供新增把手", () => {
      const { calculateInsertionHandles } = useConnectionPath();
      const handles = calculateInsertionHandles({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "orthogonal",
        routingOffset: -120,
      });

      expect(handles).toHaveLength(3);
      expect(handles.map((handle) => handle.point)).toEqual([
        { x: 124, y: 140, orthogonalRole: "source-leg" },
        { x: 300, y: 80, orthogonalRole: "lane" },
        { x: 476, y: 140, orthogonalRole: "target-leg" },
      ]);
      expect(handles.map((handle) => handle.dragAxis)).toEqual(["x", "y", "x"]);
    });

    it("水平邊已有控制點時，剩餘控制點應位於左右垂直邊中心", () => {
      const { calculateInsertionHandles } = useConnectionPath();
      const handles = calculateInsertionHandles({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "orthogonal",
        routingPoints: [{ x: 300, y: 80 }],
      });

      expect(handles).toEqual([
        {
          point: {
            x: 124,
            y: 140,
            orthogonalRole: "source-leg",
          },
          insertIndex: 0,
          dragAxis: "x",
        },
        {
          point: {
            x: 476,
            y: 140,
            orthogonalRole: "target-leg",
          },
          insertIndex: 1,
          dragAxis: "x",
        },
      ]);
    });

    it("單一直角線段只在邊中心提供一個新增把手", () => {
      const { calculateInsertionHandles } = useConnectionPath();
      const handles = calculateInsertionHandles({
        start: { x: 100, y: 200 },
        end: { x: 500, y: 200 },
        sourceAnchor: "right",
        targetAnchor: "left",
        routingMode: "orthogonal",
      });

      expect(handles).toEqual([
        {
          point: { x: 300, y: 200, orthogonalRole: "lane" },
          insertIndex: 0,
          dragAxis: "y",
        },
      ]);
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
