import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { mockWebSocketClient } from "@tests/helpers/mockWebSocket";
import { useSecurityStore } from "@/stores/securityStore";

const { getWorkspaceAccessStateMock, unlockWorkspaceMock } = vi.hoisted(() => ({
  getWorkspaceAccessStateMock: vi.fn(),
  unlockWorkspaceMock: vi.fn(),
}));

vi.mock("@/services/securityApi", () => ({
  getWorkspaceAccessState: getWorkspaceAccessStateMock,
  unlockWorkspace: unlockWorkspaceMock,
  unlockCanvas: vi.fn(),
}));

vi.mock("@/services/websocket", () => ({
  websocketClient: mockWebSocketClient,
  WebSocketResponseEvents: {
    AUTH_SESSION_RESET: "auth:session:reset",
    AUTH_CANVAS_ACCESS_RESET: "auth:canvas:access:reset",
    CANVAS_SECURITY_UPDATED: "canvas:security:updated",
  },
}));

describe("securityStore", () => {
  setupStoreTest();

  it("LAN/http 風險提示不會把解鎖操作鎖死", async () => {
    getWorkspaceAccessStateMock.mockResolvedValueOnce({
      hasWorkspacePassword: true,
      workspaceUnlocked: false,
      unlockedCanvasIds: [],
      transportSecurity: {
        isTls: false,
        isLanHost: true,
        showInsecureTransportWarning: true,
      },
    });
    const store = useSecurityStore();

    await store.bootstrapAccess();

    expect(store.showTransportRiskWarning).toBe(true);
    expect(store.isPasswordTransportBlocked).toBe(false);
  });

  it("unlockWorkspace 缺少 reconnectGrant 時使用目前語系錯誤", async () => {
    unlockWorkspaceMock.mockResolvedValueOnce({ success: true });
    const store = useSecurityStore();

    await expect(store.unlockWorkspace("password")).rejects.toThrow(
      "缺少重新連線授權",
    );

    expect(store.lastUnlockError).toBe("缺少重新連線授權");
    expect(mockWebSocketClient.forceReconnectWithGrant).not.toHaveBeenCalled();
  });
});
