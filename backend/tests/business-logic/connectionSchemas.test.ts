import { describe, expect, it } from "vitest";
import {
  connectionUpdateSchema,
  connectionCreateSchema,
} from "../../src/schemas/connectionSchemas.js";
import { pasteConnectionItemSchema } from "../../src/schemas/pasteSchemas.js";

describe("connectionSchemas OpenCode model values", () => {
  it("connection:update 允許 Summary/Branch 使用 providerID/modelID 格式", () => {
    const result = connectionUpdateSchema.safeParse({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "550e8400-e29b-41d4-a716-446655440001",
      connectionId: "550e8400-e29b-41d4-a716-446655440002",
      summaryProvider: "opencode",
      summaryModel: "openai/gpt-4o",
      branchProvider: "opencode",
      branchModel: "anthropic/claude-sonnet-4-5",
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

  it("paste connection 允許 OpenCode branchModel 的 providerID/modelID 格式", () => {
    const result = pasteConnectionItemSchema.safeParse({
      originalSourcePodId: "550e8400-e29b-41d4-a716-446655440002",
      sourceAnchor: "bottom",
      originalTargetPodId: "550e8400-e29b-41d4-a716-446655440003",
      targetAnchor: "top",
      branchProvider: "opencode",
      branchModel: "openai/gpt-4o",
    });

    expect(result.success).toBe(true);
  });
});
