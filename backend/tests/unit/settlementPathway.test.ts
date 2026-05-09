import { describe, it, expect } from "vitest";
import { resolveSettlementPathway } from "../../src/services/workflow/workflowHelpers.js";

describe("resolveSettlementPathway", () => {
  it("auto → auto", () => {
    expect(resolveSettlementPathway("auto")).toBe("auto");
  });

  it("branch → auto（在 settle 階段歸類為 auto）", () => {
    expect(resolveSettlementPathway("branch")).toBe("auto");
  });

  it("direct → direct", () => {
    expect(resolveSettlementPathway("direct")).toBe("direct");
  });
});
