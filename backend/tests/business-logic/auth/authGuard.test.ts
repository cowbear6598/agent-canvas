/**
 * authGuard 單元測試
 *
 * 覆蓋：
 * 1. public event 直接放行（AUTH_BOOTSTRAP / AUTH_UNLOCK_WORKSPACE / AUTH_UNLOCK_CANVAS）
 * 2. workspace 鎖定時，對非 public event 拋 WORKSPACE_PASSWORD_REQUIRED
 * 3. canvas scope event 指向受保護且未解鎖的 canvas 時拋 CANVAS_PASSWORD_REQUIRED
 * 4. CANVAS_SECURITY_UPDATE 屬 workspace scope——
 *    即使 canvas isProtected 且 session 未解鎖該 canvas，只要 workspace 已解鎖就不拋錯
 *    （反面：workspace 未解鎖時仍被擋）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { authGuard } from "../../../src/services/auth/authGuard.js";
import { WebSocketError } from "../../../src/middleware/wsErrorHandler.js";
import { WebSocketRequestEvents } from "../../../src/schemas/events.js";

// ── mock 邊界依賴 ──

// connectionManager：只需 getSessionId / getCanvasId
vi.mock("../../../src/services/connectionManager.js", () => ({
  connectionManager: {
    getSessionId: vi.fn(),
    getCanvasId: vi.fn(),
  },
}));

vi.mock("../../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(),
  },
}));

// authAccessService：只需 isWorkspaceAccessible / requiresCanvasUnlockAssumingWorkspace
vi.mock("../../../src/services/auth/authAccessService.js", () => ({
  authAccessService: {
    isWorkspaceAccessible: vi.fn(),
    requiresCanvasUnlockAssumingWorkspace: vi.fn(),
  },
}));

import { connectionManager } from "../../../src/services/connectionManager.js";
import { authAccessService } from "../../../src/services/auth/authAccessService.js";
import { canvasStore } from "../../../src/services/canvasStore.js";

const mockGetSessionId = connectionManager.getSessionId as ReturnType<
  typeof vi.fn
>;
const mockGetCanvasId = connectionManager.getCanvasId as ReturnType<
  typeof vi.fn
>;
const mockGetActiveCanvas = canvasStore.getActiveCanvas as ReturnType<
  typeof vi.fn
>;
const mockIsWorkspaceAccessible =
  authAccessService.isWorkspaceAccessible as ReturnType<typeof vi.fn>;
const mockRequiresCanvasUnlockAssumingWorkspace =
  authAccessService.requiresCanvasUnlockAssumingWorkspace as ReturnType<
    typeof vi.fn
  >;

const CONNECTION_ID = "conn-test-001";
const SESSION_ID = "session-test-001";
const CANVAS_ID = "canvas-test-001";

beforeEach(() => {
  vi.clearAllMocks();
  // 預設：session 存在、workspace 已解鎖、canvas 不需要解鎖
  mockGetSessionId.mockReturnValue(SESSION_ID);
  mockGetCanvasId.mockReturnValue(null);
  mockGetActiveCanvas.mockReturnValue(CANVAS_ID);
  mockIsWorkspaceAccessible.mockReturnValue(true);
  mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(false);
});

describe("AuthGuard.assertAccess", () => {
  describe("public event 直接放行", () => {
    it("AUTH_BOOTSTRAP 不論任何狀態都不應拋錯", () => {
      // workspace 鎖定，且無 session
      mockGetSessionId.mockReturnValue(null);
      mockIsWorkspaceAccessible.mockReturnValue(false);

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.AUTH_BOOTSTRAP,
          null,
        ),
      ).not.toThrow();
    });

    it("AUTH_UNLOCK_WORKSPACE 不論任何狀態都不應拋錯", () => {
      mockGetSessionId.mockReturnValue(null);
      mockIsWorkspaceAccessible.mockReturnValue(false);

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.AUTH_UNLOCK_WORKSPACE,
          null,
        ),
      ).not.toThrow();
    });

    it("AUTH_UNLOCK_CANVAS 不論任何狀態都不應拋錯", () => {
      mockGetSessionId.mockReturnValue(null);
      mockIsWorkspaceAccessible.mockReturnValue(false);

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.AUTH_UNLOCK_CANVAS,
          null,
        ),
      ).not.toThrow();
    });
  });

  describe("workspace 鎖定時拒絕非 public event", () => {
    beforeEach(() => {
      mockIsWorkspaceAccessible.mockReturnValue(false);
    });

    it("CANVAS_LIST 在 workspace 未解鎖時應拋 WORKSPACE_PASSWORD_REQUIRED", () => {
      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_LIST,
          null,
        ),
      ).toThrow(WebSocketError);

      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_LIST,
          null,
        );
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("WORKSPACE_PASSWORD_REQUIRED");
      }
    });

    it("CANVAS_SWITCH 在 workspace 未解鎖時應拋 WORKSPACE_PASSWORD_REQUIRED（不是 CANVAS_PASSWORD_REQUIRED）", () => {
      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_SWITCH,
          { canvasId: CANVAS_ID },
        );
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("WORKSPACE_PASSWORD_REQUIRED");
      }
    });

    it("CONFIG_GET 在 workspace 未解鎖時應拋 WORKSPACE_PASSWORD_REQUIRED", () => {
      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CONFIG_GET,
          null,
        );
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("WORKSPACE_PASSWORD_REQUIRED");
      }
    });
  });

  describe("canvas scope event 對受保護未解鎖 canvas 拋 CANVAS_PASSWORD_REQUIRED", () => {
    it("CANVAS_SWITCH 帶 canvasId payload 指向受保護未解鎖 canvas 時應拋 CANVAS_PASSWORD_REQUIRED", () => {
      // workspace 已解鎖、但該 canvas 受保護且未解鎖
      mockIsWorkspaceAccessible.mockReturnValue(true);
      mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(true);

      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_SWITCH,
          { canvasId: CANVAS_ID },
        );
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("CANVAS_PASSWORD_REQUIRED");
      }

      // 確認傳給 requiresCanvasUnlockAssumingWorkspace 的 canvasId 正確
      expect(mockRequiresCanvasUnlockAssumingWorkspace).toHaveBeenCalledWith(
        SESSION_ID,
        CANVAS_ID,
      );
    });

    it("CANVAS_RENAME 帶 canvasId payload 且 canvas 已解鎖時不應拋錯", () => {
      mockIsWorkspaceAccessible.mockReturnValue(true);
      mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(false);

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_RENAME,
          { canvasId: CANVAS_ID },
        ),
      ).not.toThrow();
    });

    it("CANVAS_DELETE 帶 canvasId payload 指向受保護未解鎖 canvas 時應拋 CANVAS_PASSWORD_REQUIRED", () => {
      mockIsWorkspaceAccessible.mockReturnValue(true);
      mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(true);

      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_DELETE,
          { canvasId: CANVAS_ID },
        );
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("CANVAS_PASSWORD_REQUIRED");
      }
    });
  });

  describe("CANVAS_SECURITY_UPDATE 屬 workspace scope（核心業務決策）", () => {
    it("[正面] workspace 已解鎖、canvas isProtected 但 session 未解鎖該 canvas → 不應拋錯", () => {
      // workspace 通過
      mockIsWorkspaceAccessible.mockReturnValue(true);
      // canvas 受保護且未解鎖——若 CANVAS_SECURITY_UPDATE 被誤歸入 CANVAS_EVENTS 就會拋錯
      mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(true);

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_SECURITY_UPDATE,
          { canvasId: CANVAS_ID },
        ),
      ).not.toThrow();

      // workspace scope 不應檢查 canvas 解鎖狀態
      expect(mockRequiresCanvasUnlockAssumingWorkspace).not.toHaveBeenCalled();
    });

    it("[反面] workspace 未解鎖時 CANVAS_SECURITY_UPDATE 仍應被擋，拋 WORKSPACE_PASSWORD_REQUIRED", () => {
      mockIsWorkspaceAccessible.mockReturnValue(false);

      try {
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.CANVAS_SECURITY_UPDATE,
          { canvasId: CANVAS_ID },
        );
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("WORKSPACE_PASSWORD_REQUIRED");
      }
    });
  });

  describe("未知 event 附帶 canvasId payload 的 scope fallback", () => {
    it("未知 event 帶 canvasId payload 時，應改用 active canvas 驗證而非信任 payload", () => {
      mockIsWorkspaceAccessible.mockReturnValue(true);
      mockRequiresCanvasUnlockAssumingWorkspace.mockReturnValue(true);

      try {
        authGuard.assertAccess(CONNECTION_ID, "unknown:event:with-canvas", {
          canvasId: "canvas-forged",
        });
        expect.fail("應拋出錯誤");
      } catch (e) {
        expect(e).toBeInstanceOf(WebSocketError);
        expect((e as WebSocketError).code).toBe("CANVAS_PASSWORD_REQUIRED");
      }

      expect(mockRequiresCanvasUnlockAssumingWorkspace).toHaveBeenCalledWith(
        SESSION_ID,
        CANVAS_ID,
      );
    });

    it("未知 event 不帶 canvasId payload fallback 為 workspace scope，workspace 解鎖後不應拋錯", () => {
      mockIsWorkspaceAccessible.mockReturnValue(true);

      expect(() =>
        authGuard.assertAccess(CONNECTION_ID, "unknown:event:no-canvas", null),
      ).not.toThrow();

      // workspace scope 不應觸發 canvas 解鎖檢查
      expect(mockRequiresCanvasUnlockAssumingWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("active canvas 與 payload.canvasId 不一致的安全回歸", () => {
    it("active canvas 已鎖定、payload 偽造另一個未鎖 canvasId 時，仍應以 active canvas 拒絕", () => {
      mockIsWorkspaceAccessible.mockReturnValue(true);
      mockGetActiveCanvas.mockReturnValue("canvas-locked");
      mockRequiresCanvasUnlockAssumingWorkspace.mockImplementation(
        (_sessionId, canvasId) => canvasId === "canvas-locked",
      );

      expect(() =>
        authGuard.assertAccess(
          CONNECTION_ID,
          WebSocketRequestEvents.RUN_LOAD_HISTORY,
          { canvasId: "canvas-unlocked" },
        ),
      ).toThrow(WebSocketError);

      expect(mockRequiresCanvasUnlockAssumingWorkspace).toHaveBeenCalledWith(
        SESSION_ID,
        "canvas-locked",
      );
    });
  });
});
