import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";

vi.mock("@/services/websocket/WebSocketClient", () => ({
  websocketClient: mockWebSocketClient,
}));

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "req-no-timeout"),
}));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

describe("createWebSocketRequest", () => {
  beforeEach(() => {
    resetMockWebSocket();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("timeout 為 null 時應持續等待後端回應", async () => {
    const request = createWebSocketRequest<
      { requestId: string; githubRepo: string },
      { requestId: string; success: boolean }
    >({
      requestEvent: "plugin:install",
      responseEvent: "plugin:installed",
      payload: { githubRepo: "0x0funky/agent-sprite-forge" },
      timeout: null,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    simulateEvent("plugin:installed", {
      requestId: "req-no-timeout",
      success: true,
    });

    await expect(request).resolves.toEqual({
      requestId: "req-no-timeout",
      success: true,
    });
  });
});
