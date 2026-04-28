import { describe, it, expect } from "vitest";
import { webSocketMockFactory } from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import { createMockRepository } from "../helpers/factories";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCanvasStore } from "@/stores/canvasStore";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast（store 內部會呼叫，需隔離邊界）
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

describe("repositoryStore（根層 — 補充測試）", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  describe("updateCurrentBranch", () => {
    it("應更新指定 repository 的 currentBranch", () => {
      const store = useRepositoryStore();
      const repo = createMockRepository({
        id: "repo-1",
        currentBranch: "main",
      });
      store.availableItems = [repo];

      store.updateCurrentBranch("repo-1", "develop");

      expect(
        (store.availableItems[0] as ReturnType<typeof createMockRepository>)
          .currentBranch,
      ).toBe("develop");
    });

    it("repository 不存在時不應拋出錯誤", () => {
      const store = useRepositoryStore();
      store.availableItems = [];

      expect(() =>
        store.updateCurrentBranch("non-existent", "develop"),
      ).not.toThrow();
    });

    it("應只更新符合 id 的 repository，不影響其他項目", () => {
      const store = useRepositoryStore();
      const repo1 = createMockRepository({
        id: "repo-1",
        currentBranch: "main",
      });
      const repo2 = createMockRepository({
        id: "repo-2",
        currentBranch: "feature",
      });
      store.availableItems = [repo1, repo2];

      store.updateCurrentBranch("repo-1", "develop");

      type RepoWithBranch = ReturnType<typeof createMockRepository>;
      expect((store.availableItems[0] as RepoWithBranch).currentBranch).toBe(
        "develop",
      );
      expect((store.availableItems[1] as RepoWithBranch).currentBranch).toBe(
        "feature",
      );
    });

    it("多次呼叫應覆蓋為最新 branch 名稱", () => {
      const store = useRepositoryStore();
      const repo = createMockRepository({
        id: "repo-1",
        currentBranch: "main",
      });
      store.availableItems = [repo];

      store.updateCurrentBranch("repo-1", "develop");
      store.updateCurrentBranch("repo-1", "hotfix");

      type RepoWithBranch = ReturnType<typeof createMockRepository>;
      expect((store.availableItems[0] as RepoWithBranch).currentBranch).toBe(
        "hotfix",
      );
    });
  });
});
