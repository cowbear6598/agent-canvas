import type { Repository, RepositoryNote } from "@/types";
import { createNoteStore } from "./createNoteStore";
import type { NoteStoreContext, TypedNoteStore } from "./createNoteStore";
import {
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import { getActiveCanvasIdOrWarn, requireActiveCanvas } from "@/utils/canvasGuard";
import { useToast } from "@/composables/useToast";
import { generateRequestId } from "@/services/utils";
import { t } from "@/i18n";
import type {
  RepositoryCreatePayload,
  RepositoryCreatedPayload,
  RepositoryCheckGitPayload,
  RepositoryCheckGitResultPayload,
  RepositoryGetLocalBranchesPayload,
  RepositoryLocalBranchesResultPayload,
  RepositoryCheckDirtyPayload,
  RepositoryDirtyCheckResultPayload,
  RepositoryCheckoutBranchPayload,
  RepositoryDeleteBranchPayload,
  RepositoryBranchDeletedPayload,
  RepositoryPullLatestPayload,
  RepositoryGetMemoryPayload,
  RepositorySetMemoryEnabledPayload,
  RepositoryClearMemoryPayload,
  RepositoryMemoryResultPayload,
  RepositoryMemoryEnabledSetPayload,
  RepositoryMemoryClearedPayload,
} from "@/types/websocket";
import { usePodStore } from "@/stores/pod/podStore";

function setRepositoryMemoryState(
  repositories: Repository[],
  repositoryId: string,
  state: {
    hasRepoMemory?: boolean;
    repoMemoryEnabled?: boolean;
  },
): void {
  const repository = repositories.find((item) => item.id === repositoryId);
  if (repository) {
    if (state.hasRepoMemory !== undefined) {
      repository.hasRepoMemory = state.hasRepoMemory;
    }
    if (state.repoMemoryEnabled !== undefined) {
      repository.repoMemoryEnabled = state.repoMemoryEnabled;
    }
  }
}

interface RepositoryStoreCustomActions {
  createRepository(name: string): Promise<{
    success: boolean;
    repository?: { id: string; name: string };
    error?: string;
  }>;
  updateCurrentBranch(repositoryId: string, branchName: string): void;
  deleteRepository(repositoryId: string): Promise<void>;
  loadRepositories(): Promise<void>;
  ensureRepositoriesLoaded(): Promise<void>;
  checkIsGit(repositoryId: string): Promise<boolean>;
  getLocalBranches(repositoryId: string): Promise<{
    success: boolean;
    branches?: string[];
    currentBranch?: string;
    error?: string;
  }>;
  checkDirty(
    repositoryId: string,
  ): Promise<{ success: boolean; isDirty?: boolean; error?: string }>;
  checkoutBranch(
    repositoryId: string,
    branchName: string,
    force?: boolean,
  ): Promise<{ requestId: string }>;
  deleteBranch(
    repositoryId: string,
    branchName: string,
  ): Promise<{ success: boolean; branchName?: string; error?: string }>;
  pullLatest(repositoryId: string): Promise<{ requestId: string }>;
  getRepoMemory(repositoryId: string): Promise<{
    success: boolean;
    memoryEnabled?: boolean;
    hasSummary?: boolean;
    summary?: string | null;
    summaryUpdatedAt?: string | null;
    error?: string;
  }>;
  setRepoMemoryEnabled(
    repositoryId: string,
    memoryEnabled: boolean,
  ): Promise<void>;
  clearRepoMemory(repositoryId: string): Promise<void>;
  setRepoMemoryState(
    repositoryId: string,
    state: {
      hasRepoMemory?: boolean;
      repoMemoryEnabled?: boolean;
    },
  ): void;
}

function createRepositoryCustomActions(): RepositoryStoreCustomActions {
  const { executeAction: executeRepositoryAction } = useCanvasWebSocketAction();
  const { showSuccessToast, showErrorToast } = useToast();
  let loadedCanvasId: string | null = null;
  let loadPromise: Promise<void> | null = null;

  return {
    async createRepository(
      this: NoteStoreContext<Repository>,
      name: string,
    ): Promise<{
      success: boolean;
      repository?: { id: string; name: string };
      error?: string;
    }> {
      const result = await executeRepositoryAction<
        RepositoryCreatePayload,
        RepositoryCreatedPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CREATE,
          responseEvent: WebSocketResponseEvents.REPOSITORY_CREATED,
          payload: { name },
        },
        {
          errorCategory: "Repository",
          errorAction: t("common.error.create"),
          errorMessage: t("store.repository.createFailed"),
        },
      );

      if (!result.success) return result;

      if (!result.data.repository) {
        const error = result.data.error || t("store.repository.createFailed");
        showErrorToast("Repository", t("common.error.create"), error);
        return { success: false, error };
      }

      this.availableItems.push(result.data.repository);
      showSuccessToast("Repository", t("store.repository.createSuccess"), name);
      return { success: true, repository: result.data.repository };
    },

    async deleteRepository(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<void> {
      return this.deleteItem(repositoryId);
    },

    async loadRepositories(this: NoteStoreContext<Repository>): Promise<void> {
      return this.loadItems();
    },

    async ensureRepositoriesLoaded(
      this: NoteStoreContext<Repository>,
    ): Promise<void> {
      const canvasId = getActiveCanvasIdOrWarn("repository");
      if (!canvasId) {
        return;
      }

      if (loadedCanvasId === canvasId) {
        return;
      }

      if (loadPromise) {
        return loadPromise;
      }

      loadPromise = this.loadItems()
        .then(() => {
          loadedCanvasId = canvasId;
        })
        .finally(() => {
          loadPromise = null;
        });

      return loadPromise;
    },

    async checkIsGit(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<boolean> {
      const result = await executeRepositoryAction<
        RepositoryCheckGitPayload,
        RepositoryCheckGitResultPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CHECK_GIT,
          responseEvent: WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
          payload: { repositoryId },
        },
        {
          errorCategory: "Repository",
          errorAction: t("store.repository.checkGitFailed"),
          errorMessage: t("store.repository.checkGitFailed"),
        },
      );

      if (!result.success || !result.data.success) return false;

      const existingRepository = this.availableItems.find(
        (item: Repository) => item.id === repositoryId,
      );
      if (existingRepository) {
        existingRepository.isGit = result.data.isGit;
      }

      return result.data.isGit;
    },

    async getLocalBranches(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<{
      success: boolean;
      branches?: string[];
      currentBranch?: string;
      error?: string;
    }> {
      const result = await executeRepositoryAction<
        RepositoryGetLocalBranchesPayload,
        RepositoryLocalBranchesResultPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
          responseEvent:
            WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
          payload: { repositoryId },
        },
        {
          errorCategory: "Git",
          errorAction: t("store.repository.getBranchesFailed"),
          errorMessage: t("store.repository.getBranchesFailed"),
        },
      );

      if (!result.success) return result;

      return {
        success: result.data.success,
        branches: result.data.branches,
        currentBranch: result.data.currentBranch,
        error: result.data.error,
      };
    },

    async checkDirty(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<{ success: boolean; isDirty?: boolean; error?: string }> {
      const result = await executeRepositoryAction<
        RepositoryCheckDirtyPayload,
        RepositoryDirtyCheckResultPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CHECK_DIRTY,
          responseEvent: WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT,
          payload: { repositoryId },
        },
        {
          errorCategory: "Git",
          errorAction: t("store.repository.checkDirtyFailed"),
          errorMessage: t("store.repository.checkDirtyFailed"),
        },
      );

      if (!result.success) return result;

      return {
        success: result.data.success,
        isDirty: result.data.isDirty,
        error: result.data.error,
      };
    },

    async checkoutBranch(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      branchName: string,
      force: boolean = false,
    ): Promise<{ requestId: string }> {
      const canvasId = requireActiveCanvas();
      const requestId = generateRequestId();

      websocketClient.emit<RepositoryCheckoutBranchPayload>(
        WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
        {
          requestId,
          canvasId,
          repositoryId,
          branchName,
          force,
        },
      );

      return { requestId };
    },

    async deleteBranch(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      branchName: string,
    ): Promise<{ success: boolean; branchName?: string; error?: string }> {
      const result = await executeRepositoryAction<
        RepositoryDeleteBranchPayload,
        RepositoryBranchDeletedPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_DELETE_BRANCH,
          responseEvent: WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
          payload: { repositoryId, branchName, force: true },
        },
        {
          errorCategory: "Git",
          errorAction: t("store.repository.deleteBranchFailed"),
          errorMessage: t("store.repository.deleteBranchFailed"),
        },
      );

      if (!result.success) return result;

      if (result.data.success) {
        showSuccessToast(
          "Git",
          t("store.repository.deleteBranchSuccess"),
          branchName,
        );
      } else if (result.data.error) {
        showErrorToast(
          "Git",
          t("store.repository.deleteBranchFailed"),
          result.data.error,
        );
      }

      return {
        success: result.data.success,
        branchName: result.data.branchName,
        error: result.data.error,
      };
    },

    async pullLatest(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<{ requestId: string }> {
      const canvasId = requireActiveCanvas();
      const requestId = generateRequestId();

      websocketClient.emit<RepositoryPullLatestPayload>(
        WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
        {
          requestId,
          canvasId,
          repositoryId,
        },
      );

      return { requestId };
    },

    async setRepoMemoryEnabled(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      memoryEnabled: boolean,
    ): Promise<void> {
      const result = await executeRepositoryAction<
        RepositorySetMemoryEnabledPayload,
        RepositoryMemoryEnabledSetPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_SET_MEMORY_ENABLED,
          responseEvent:
            WebSocketResponseEvents.REPOSITORY_MEMORY_ENABLED_SET,
          payload: { repositoryId, memoryEnabled },
        },
        {
          errorCategory: "Repository",
          errorAction: t(
            memoryEnabled
              ? "canvas.podContextMenu.repoMemoryEnableFailed"
              : "canvas.podContextMenu.repoMemoryDisableFailed",
          ),
          errorMessage: t(
            memoryEnabled
              ? "canvas.podContextMenu.repoMemoryEnableFailedDesc"
              : "canvas.podContextMenu.repoMemoryDisableFailedDesc",
          ),
        },
      );

      if (!result.success) {
        return;
      }

      if (!result.data.success) {
        showErrorToast(
          "Repository",
          t(
            memoryEnabled
              ? "canvas.podContextMenu.repoMemoryEnableFailed"
              : "canvas.podContextMenu.repoMemoryDisableFailed",
          ),
          t(
            memoryEnabled
              ? "canvas.podContextMenu.repoMemoryEnableFailedDesc"
              : "canvas.podContextMenu.repoMemoryDisableFailedDesc",
          ),
        );
        return;
      }

      const resolvedRepositoryId =
        result.data.repository?.id ?? result.data.repositoryId ?? repositoryId;
      setRepositoryMemoryState(this.availableItems, resolvedRepositoryId, {
        hasRepoMemory: result.data.repository?.hasRepoMemory,
        repoMemoryEnabled: result.data.repository?.repoMemoryEnabled,
      });
      for (const pod of result.data.pods ?? []) {
        usePodStore().updatePod(pod);
      }

      showSuccessToast(
        "Repository",
        t(
          memoryEnabled
            ? "canvas.podContextMenu.repoMemoryEnabled"
            : "canvas.podContextMenu.repoMemoryDisabled",
        ),
      );
    },

    async getRepoMemory(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<{
      success: boolean;
      memoryEnabled?: boolean;
      hasSummary?: boolean;
      summary?: string | null;
      summaryUpdatedAt?: string | null;
      error?: string;
    }> {
      const result = await executeRepositoryAction<
        RepositoryGetMemoryPayload,
        RepositoryMemoryResultPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_GET_MEMORY,
          responseEvent: WebSocketResponseEvents.REPOSITORY_MEMORY_RESULT,
          payload: { repositoryId },
        },
        {
          errorCategory: "Repository",
          errorAction: t("common.error.load"),
          errorMessage: t("common.error.load"),
        },
      );

      if (!result.success || !result.data.success) {
        const errorMessage = result.success
          ? (result.data.error ?? t("common.error.load"))
          : t("common.error.load");
        showErrorToast("Repository", t("common.error.load"), errorMessage);
        return {
          success: false,
          error: errorMessage,
        };
      }

      setRepositoryMemoryState(this.availableItems, repositoryId, {
        hasRepoMemory: result.data.hasSummary,
        repoMemoryEnabled: result.data.memoryEnabled,
      });
      usePodStore().setRepositoryMemoryState(repositoryId, {
        hasRepoMemory: result.data.hasSummary,
        repoMemoryEnabled: result.data.memoryEnabled,
      });

      return {
        success: true,
        memoryEnabled: result.data.memoryEnabled,
        hasSummary: result.data.hasSummary,
        summary: result.data.summary,
        summaryUpdatedAt: result.data.summaryUpdatedAt,
      };
    },

    async clearRepoMemory(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<void> {
      const result = await executeRepositoryAction<
        RepositoryClearMemoryPayload,
        RepositoryMemoryClearedPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_CLEAR_MEMORY,
          responseEvent: WebSocketResponseEvents.REPOSITORY_MEMORY_CLEARED,
          payload: { repositoryId },
        },
        {
          errorCategory: "Repository",
          errorAction: t("store.repository.clearRepoMemoryFailed"),
          errorMessage: t("store.repository.clearRepoMemoryFailed"),
        },
      );

      if (!result.success) {
        return;
      }

      if (!result.data.success) {
        showErrorToast(
          "Repository",
          t("store.repository.clearRepoMemoryFailed"),
          result.data.error ?? t("store.repository.clearRepoMemoryFailed"),
        );
        return;
      }

      const resolvedRepositoryId =
        result.data.repository?.id ?? result.data.repositoryId ?? repositoryId;
      setRepositoryMemoryState(this.availableItems, resolvedRepositoryId, {
        hasRepoMemory: false,
        repoMemoryEnabled: result.data.repository?.repoMemoryEnabled,
      });
      for (const pod of result.data.pods ?? []) {
        usePodStore().updatePod(pod);
      }

      showSuccessToast(
        "Repository",
        t("store.repository.clearRepoMemorySuccess"),
        this.availableItems.find(
          (item: Repository) => item.id === resolvedRepositoryId,
        )?.name,
      );
    },

    updateCurrentBranch(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      branchName: string,
    ): void {
      const item = this.availableItems.find(
        (r: Repository) => r.id === repositoryId,
      );
      if (item) {
        item.currentBranch = branchName;
      }
    },

    setRepoMemoryState(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      state: {
        hasRepoMemory?: boolean;
        repoMemoryEnabled?: boolean;
      },
    ): void {
      setRepositoryMemoryState(this.availableItems, repositoryId, state);
    },
  };
}

const store = createNoteStore<Repository, RepositoryNote>({
  storeName: "repository",
  relationship: "one-to-one",
  responseItemsKey: "repositories",
  itemIdField: "repositoryId",
  events: {
    listItems: {
      request: WebSocketRequestEvents.REPOSITORY_LIST,
      response: WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_LIST,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_UPDATE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.REPOSITORY_NOTE_DELETE,
      response: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_REPOSITORY,
    response: WebSocketResponseEvents.POD_REPOSITORY_BOUND,
  },
  unbindEvents: {
    request: WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
    response: WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.REPOSITORY_DELETE,
    response: WebSocketResponseEvents.REPOSITORY_DELETED,
  },
  createNotePayload: (item: Repository) => ({
    repositoryId: item.id,
  }),
  customActions: createRepositoryCustomActions(),
});

export const useRepositoryStore = store as TypedNoteStore<
  typeof store,
  RepositoryStoreCustomActions
>;
