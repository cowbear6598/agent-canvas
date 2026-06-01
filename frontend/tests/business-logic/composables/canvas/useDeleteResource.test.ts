import { describe, expect, it, vi } from "vitest";

import { useDeleteResource } from "@/composables/canvas/useDeleteResource";

function createRepositoryStore(overrides: {
  inUse?: boolean;
  hasRepoMemory?: boolean;
} = {}) {
  return {
    isItemInUse: vi.fn(() => overrides.inUse ?? false),
    typedAvailableItems: [
      {
        id: "repo-1",
        hasRepoMemory: overrides.hasRepoMemory ?? false,
      },
    ],
    deleteRepository: vi.fn(async () => undefined),
  };
}

describe("useDeleteResource", () => {
  it("repository 有 memory 時，第一次確認刪除應開啟 memory 二次確認", async () => {
    const repositoryStore = createRepositoryStore({ hasRepoMemory: true });
    const resource = useDeleteResource({
      repositoryStore,
    });

    resource.handleOpenDeleteModal("repository", "repo-1", "Repo 1");
    await resource.handleConfirmDelete();

    expect(resource.showDeleteModal.value).toBe(false);
    expect(resource.showDeleteMemoryModal.value).toBe(true);
    expect(repositoryStore.deleteRepository).not.toHaveBeenCalled();
  });

  it("repository 被 pod 使用時，應直接關閉刪除流程且不進入 memory 二次確認", async () => {
    const repositoryStore = createRepositoryStore({
      inUse: true,
      hasRepoMemory: true,
    });
    const resource = useDeleteResource({
      repositoryStore,
    });

    resource.handleOpenDeleteModal("repository", "repo-1", "Repo 1");
    await resource.handleConfirmDelete();

    expect(resource.showDeleteModal.value).toBe(false);
    expect(resource.showDeleteMemoryModal.value).toBe(false);
    expect(resource.deleteTarget.value).toBeNull();
    expect(repositoryStore.deleteRepository).not.toHaveBeenCalled();
  });

  it("進入 memory 二次確認後，確認刪除應真正刪除 repository", async () => {
    const repositoryStore = createRepositoryStore({ hasRepoMemory: true });
    const resource = useDeleteResource({
      repositoryStore,
    });

    resource.handleOpenDeleteModal("repository", "repo-1", "Repo 1");
    await resource.handleConfirmDelete();
    await resource.handleConfirmDeleteWithMemory();

    expect(repositoryStore.deleteRepository).toHaveBeenCalledWith("repo-1");
    expect(resource.showDeleteModal.value).toBe(false);
    expect(resource.showDeleteMemoryModal.value).toBe(false);
    expect(resource.deleteTarget.value).toBeNull();
  });
});
