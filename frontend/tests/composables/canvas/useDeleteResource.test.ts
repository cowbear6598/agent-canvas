import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDeleteResource } from "@/composables/canvas/useDeleteResource";

describe("useDeleteResource", () => {
  let mockStores: {
    repositoryStore: {
      isItemInUse: ReturnType<typeof vi.fn>;
      deleteRepository: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockStores = {
      repositoryStore: {
        isItemInUse: vi.fn().mockReturnValue(false),
        deleteRepository: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it("開啟刪除 modal 時會設定 deleteTarget", () => {
    const composable = useDeleteResource(mockStores as any);

    composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

    expect(composable.showDeleteModal.value).toBe(true);
    expect(composable.deleteTarget.value).toEqual({
      type: "repository",
      id: "repo-1",
      name: "My Repo",
    });
  });

  it("會根據 repositoryStore.isItemInUse 回傳使用中狀態", () => {
    mockStores.repositoryStore.isItemInUse.mockReturnValue(true);
    const composable = useDeleteResource(mockStores as any);

    composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

    expect(composable.isDeleteTargetInUse.value).toBe(true);
  });

  it("確認刪除時呼叫 deleteRepository", async () => {
    const composable = useDeleteResource(mockStores as any);
    composable.handleOpenDeleteModal("repository", "repo-1", "My Repo");

    await composable.handleConfirmDelete();

    expect(mockStores.repositoryStore.deleteRepository).toHaveBeenCalledWith(
      "repo-1",
    );
    expect(composable.showDeleteModal.value).toBe(false);
    expect(composable.deleteTarget.value).toBeNull();
  });
});
