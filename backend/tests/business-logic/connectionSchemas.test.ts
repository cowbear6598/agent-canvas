import { describe, expect, it } from "vitest";
import {
  connectionUpdateSchema,
  connectionCreateSchema,
} from "../../src/schemas/connectionSchemas.js";
import { pasteConnectionItemSchema } from "../../src/schemas/pasteSchemas.js";

describe("connectionSchemas OpenCode model values", () => {
  it("connection:update 允許 Summary 使用 providerID/modelID 格式", () => {
    const result = connectionUpdateSchema.safeParse({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      connectionId: "550e8400-e29b-41d4-a716-446655440002",
      summaryProvider: "opencode",
      summaryModel: "openai/gpt-4o",
    });

    expect(result.success).toBe(true);
  });

  it("connection:create 仍拒絕 model 內的危險字元", () => {
    const result = connectionCreateSchema.safeParse({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      sourcePodId: "550e8400-e29b-41d4-a716-446655440002",
      sourceAnchor: "bottom",
      targetPodId: "550e8400-e29b-41d4-a716-446655440003",
      targetAnchor: "top",
      summaryProvider: "opencode",
      summaryModel: "openai/gpt-4o;rm-rf",
    });

    expect(result.success).toBe(false);
  });

  it("paste connection 允許 direct 與 summary model 一起通過驗證", () => {
    const result = pasteConnectionItemSchema.safeParse({
      originalSourcePodId: "550e8400-e29b-41d4-a716-446655440002",
      sourceAnchor: "bottom",
      originalTargetPodId: "550e8400-e29b-41d4-a716-446655440003",
      targetAnchor: "top",
      direct: true,
      summaryProvider: "opencode",
      summaryModel: "openai/gpt-4o",
    });

    expect(result.success).toBe(true);
  });

  it("connection:update 允許直角折線、有限 offset 與三個路徑節點", () => {
    const result = connectionUpdateSchema.safeParse({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      connectionId: "550e8400-e29b-41d4-a716-446655440002",
      routingMode: "orthogonal",
      routingOffset: -180,
      routingPoints: [
        { x: 100, y: -50, orthogonalRole: "source-leg" },
        { x: 250, y: 80, orthogonalRole: "lane" },
        { x: 400, y: -50, orthogonalRole: "target-leg" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.routingPoints?.[1]?.orthogonalRole).toBe("lane");
  });

  it("connection:update 拒絕未知線型與非有限 routing offset", () => {
    const base = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      connectionId: "550e8400-e29b-41d4-a716-446655440002",
    };

    expect(
      connectionUpdateSchema.safeParse({ ...base, routingMode: "curved" })
        .success,
    ).toBe(false);
    expect(
      connectionUpdateSchema.safeParse({
        ...base,
        routingOffset: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
    expect(
      connectionUpdateSchema.safeParse({
        ...base,
        routingPoints: [
          { x: 0, y: 0, orthogonalRole: "unknown-segment" },
        ],
      }).success,
    ).toBe(false);
  });

  it("connection:update 拒絕超過三個或含非有限座標的路徑節點", () => {
    const base = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      connectionId: "550e8400-e29b-41d4-a716-446655440002",
    };

    expect(
      connectionUpdateSchema.safeParse({
        ...base,
        routingPoints: Array.from({ length: 4 }, (_, index) => ({
          x: index,
          y: index,
        })),
      }).success,
    ).toBe(false);
    expect(
      connectionUpdateSchema.safeParse({
        ...base,
        routingPoints: [{ x: Number.NaN, y: 0 }],
      }).success,
    ).toBe(false);
  });
});
