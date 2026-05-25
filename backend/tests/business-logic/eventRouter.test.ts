const { mockAssertAccess, mockEmitToConnection } = vi.hoisted(() => ({
  mockAssertAccess: vi.fn(),
  mockEmitToConnection: vi.fn(),
}));

vi.mock("../../src/services/auth/authGuard.js", () => ({
  authGuard: {
    assertAccess: mockAssertAccess,
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventRouter } from "../../src/services/eventRouter.js";
import { WebSocketError } from "../../src/middleware/wsErrorHandler.js";

describe("eventRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authGuard 拒絕時應用原 request 對應的 response event 回傳錯誤", async () => {
    const handler = vi.fn();
    mockAssertAccess.mockImplementation(() => {
      throw new WebSocketError(
        "CANVAS_PASSWORD_REQUIRED",
        "Canvas password required",
      );
    });

    eventRouter.register("test:canvas:rename", handler, "test:canvas:renamed");

    await eventRouter.route("conn-1", {
      type: "test:canvas:rename",
      requestId: "req-1",
      payload: { canvasId: "canvas-locked" },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(mockEmitToConnection).toHaveBeenCalledWith(
      "conn-1",
      "test:canvas:renamed",
      {
        requestId: "req-1",
        success: false,
        error: "Canvas password required",
        code: "CANVAS_PASSWORD_REQUIRED",
      },
    );
  });
});
