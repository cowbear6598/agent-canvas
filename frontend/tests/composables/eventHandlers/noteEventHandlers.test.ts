import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
// TODO Phase 4: useMcpServerStore 重構後補回
import { getNoteEventListeners } from "@/composables/eventHandlers/noteEventHandlers";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("noteEventHandlers", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  function findHandler(event: string) {
    const listeners = getNoteEventListeners();
    return listeners.find((l) => l.event === event)!.handler;
  }

  describe("getNoteEventListeners", () => {
    it("應回傳正確數量的 listener", () => {
      const result = getNoteEventListeners();
      expect(result.length).toBe(5);
    });
  });

  describe("handleRepositoryBranchChanged（skipCanvasCheck: true）", () => {
    it("branchName 合法時應更新 repository 的 currentBranch", () => {
      const store = useRepositoryStore();
      // 直接寫入 availableItems，updateCurrentBranch 使用 this.availableItems 查找
      const mockItem = { id: "repo-1", name: "repo", currentBranch: "main" };
      store.availableItems = [mockItem as unknown];

      findHandler("repository:branch:changed")({
        repositoryId: "repo-1",
        branchName: "feature/test",
      });

      expect(mockItem.currentBranch).toBe("feature/test");
    });

    it("branchName 包含不合法字元時不應更新", () => {
      const store = useRepositoryStore();
      const mockItem = { id: "repo-1", name: "repo", currentBranch: "main" };
      store.availableItems = [mockItem as unknown];

      findHandler("repository:branch:changed")({
        repositoryId: "repo-1",
        branchName: "bad branch name!",
      });

      expect(mockItem.currentBranch).toBe("main");
    });
  });

  // TODO Phase 4: handleMcpServerDeleted 測試重構後補回

  describe("其他 note 類型的 canvasId 防護", () => {
    it("repository:note:created - canvasId 不匹配時不應執行", () => {
      const store = useRepositoryStore();
      const spy = vi.spyOn(store, "addNoteFromEvent");

      findHandler("repository-note:created")({
        canvasId: "other-canvas",
        note: { id: "rn-1" },
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("command note listeners 已移除", () => {
      const listeners = getNoteEventListeners();

      expect(listeners.some((l) => l.event === "command-note:created")).toBe(
        false,
      );
    });

    // TODO Phase 4: mcp-server:note:created canvasId 防護測試重構後補回
  });
});
