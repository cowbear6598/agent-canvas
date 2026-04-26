import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDeleteResource } from "@/composables/canvas/useDeleteResource";

describe("useDeleteResource", () => {
  let mockStores: {
    repositoryStore: {
      isItemInUse: ReturnType<typeof vi.fn>;
      deleteRepository: ReturnType<typeof vi.fn>;
    };
    commandStore: {
      isItemInUse: ReturnType<typeof vi.fn>;
      deleteCommand: ReturnType<typeof vi.fn>;
      deleteGroup: ReturnType<typeof vi.fn>;
    };
    mcpServerStore: {
      isItemInUse: ReturnType<typeof vi.fn>;
      deleteMcpServer: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockStores = {
      repositoryStore: {
        isItemInUse: vi.fn().mockReturnValue(false),
        deleteRepository: vi.fn().mockResolvedValue(undefined),
      },
      commandStore: {
        isItemInUse: vi.fn().mockReturnValue(false),
        deleteCommand: vi.fn().mockResolvedValue(undefined),
        deleteGroup: vi.fn().mockResolvedValue({ success: true }),
      },
      mcpServerStore: {
        isItemInUse: vi.fn().mockReturnValue(false),
        deleteMcpServer: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  describe("handleOpenDeleteModal - 開啟刪除確認 Modal", () => {
    it("開啟刪除 Modal 時應設定 deleteTarget 並顯示 Modal", () => {
      const composable = useDeleteResource(mockStores as any);

      composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

      expect(composable.showDeleteModal.value).toBe(true);
      expect(composable.deleteTarget.value).toEqual({
        type: "repository",
        id: "repo-1",
        name: "My Repo",
      });
    });
  });

  describe("handleOpenDeleteGroupModal - 開啟群組刪除確認 Modal", () => {
    it("開啟群組刪除 Modal 時 type 應為 GroupType", () => {
      const composable = useDeleteResource(mockStores as any);

      composable.handleOpenDeleteGroupModal(
        "commandGroup",
        "group-1",
        "My Group",
      );

      expect(composable.showDeleteModal.value).toBe(true);
      expect(composable.deleteTarget.value?.type).toBe("commandGroup");
      expect(composable.deleteTarget.value?.id).toBe("group-1");
      expect(composable.deleteTarget.value?.name).toBe("My Group");
    });
  });

  describe("isDeleteTargetInUse - 是否被使用中", () => {
    it("沒有 deleteTarget 時應回傳 false", () => {
      const composable = useDeleteResource(mockStores as any);

      expect(composable.isDeleteTargetInUse.value).toBe(false);
    });

    it("group 類型永遠不算被使用中", () => {
      const composable = useDeleteResource(mockStores as any);

      composable.handleOpenDeleteGroupModal(
        "commandGroup",
        "group-1",
        "My Group",
      );

      expect(composable.isDeleteTargetInUse.value).toBe(false);
    });

    it("repository 未被使用時應回傳 false", () => {
      const composable = useDeleteResource(mockStores as any);
      mockStores.repositoryStore.isItemInUse.mockReturnValue(false);

      composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

      expect(composable.isDeleteTargetInUse.value).toBe(false);
    });
  });

  describe("handleConfirmDelete - 確認刪除", () => {
    it("沒有 deleteTarget 時不應執行任何操作", async () => {
      const composable = useDeleteResource(mockStores as any);

      await composable.handleConfirmDelete();

      expect(
        mockStores.repositoryStore.deleteRepository,
      ).not.toHaveBeenCalled();
    });

    it("確認刪除 repository 後應呼叫 deleteRepository", async () => {
      const composable = useDeleteResource(mockStores as any);
      composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

      await composable.handleConfirmDelete();

      expect(mockStores.repositoryStore.deleteRepository).toHaveBeenCalledWith(
        "repo-1",
      );
    });

    it("確認刪除 mcpServer 後應呼叫 deleteMcpServer", async () => {
      const composable = useDeleteResource(mockStores as any);
      composable.handleOpenDeleteModal("mcpServer", "mcp-1", "My MCP");

      await composable.handleConfirmDelete();

      expect(mockStores.mcpServerStore.deleteMcpServer).toHaveBeenCalledWith(
        "mcp-1",
      );
    });

    it("確認刪除 commandGroup 後應呼叫 commandStore.deleteGroup", async () => {
      const composable = useDeleteResource(mockStores as any);
      composable.handleOpenDeleteGroupModal(
        "commandGroup",
        "cmd-group-1",
        "My CMD Group",
      );

      await composable.handleConfirmDelete();

      expect(mockStores.commandStore.deleteGroup).toHaveBeenCalledWith(
        "cmd-group-1",
      );
    });

    it("刪除失敗時不應關閉 Modal", async () => {
      const composable = useDeleteResource(mockStores as any);
      mockStores.commandStore.deleteGroup.mockResolvedValue({
        success: false,
        error: "刪除失敗",
      });
      composable.handleOpenDeleteGroupModal(
        "commandGroup",
        "group-1",
        "My Group",
      );

      await composable.handleConfirmDelete();

      expect(composable.showDeleteModal.value).toBe(true);
      expect(composable.deleteTarget.value).not.toBeNull();
    });
  });

  describe("closeDeleteModal - 關閉刪除 Modal", () => {
    it("關閉後 showDeleteModal 應為 false", () => {
      const composable = useDeleteResource(mockStores as any);
      composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

      composable.closeDeleteModal();

      expect(composable.showDeleteModal.value).toBe(false);
    });

    it("關閉後 deleteTarget 應被清空", () => {
      const composable = useDeleteResource(mockStores as any);
      composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

      composable.closeDeleteModal();

      expect(composable.deleteTarget.value).toBeNull();
    });
  });
});
