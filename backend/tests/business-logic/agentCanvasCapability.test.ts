import {
  createAgentCanvasCapability,
  verifyAgentCanvasCapability,
} from "../../src/services/agentAccess/agentCanvasCapability.js";

describe("Agent Canvas MCP capability", () => {
  it("簽發綁定 canvas、pod、run 與執行權限的短效 Token", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const token = createAgentCanvasCapability(
      { canvasId: "canvas-a", podId: "pod-a", runId: "run-a" },
      now,
    );
    const scope = verifyAgentCanvasCapability(token, now + 1);

    expect(scope).toMatchObject({
      canvasId: "canvas-a",
      podId: "pod-a",
      runId: "run-a",
      permission: "execute",
      issuedAt: now,
    });
    expect(scope.expiresAt).toBeGreaterThan(now);
  });

  it("拒絕竄改與過期 Token", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const token = createAgentCanvasCapability(
      { canvasId: "canvas-a", podId: "pod-a", runId: "run-a" },
      now,
    );
    expect(() => verifyAgentCanvasCapability(`${token}x`, now + 1)).toThrow();
    expect(() =>
      verifyAgentCanvasCapability(token, now + 12 * 60 * 60 * 1000),
    ).toThrow("已過期");
  });
});
