import type { Repository, RepositoryNote } from "@/types";
import { createNoteStore } from "./createNoteStore";
import type { NoteStoreContext, TypedNoteStore } from "./createNoteStore";
import {
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import { useToast } from "@/composables/useToast";
import { generateRequestId } from "@/services/utils";
import { t } from "@/i18n";
import type {
  RepositoryCreatePayload,
  RepositoryCreatedPayload,
  RepositoryCheckGitPayload,
  RepositoryCheckGitResultPayload,
  RepositoryWorktreeCreatePayload,
  RepositoryWorktreeCreatedPayload,
  RepositoryGetLocalBranchesPayload,
  RepositoryLocalBranchesResultPayload,
  RepositoryCheckDirtyPayload,
  RepositoryDirtyCheckResultPayload,
  RepositoryCheckoutBranchPayload,
  RepositoryDeleteBranchPayload,
  RepositoryBranchDeletedPayload,
  RepositoryPullLatestPayload,
} from "@/types/websocket";

interface RepositoryStoreCustomActions {
  createRepository(name: string): Promise<{
    success: boolean;
    repository?: { id: string; name: string };
    error?: string;
  }>;
  deleteRepository(repositoryId: string): Promise<void>;
  loadRepositories(): Promise<void>;
  checkIsGit(repositoryId: string): Promise<boolean>;
  createWorktree(
    repositoryId: string,
    worktreeName: string,
    sourceNotePosition: { x: number; y: number },
  ): Promise<{ success: boolean; error?: string }>;
  getLocalBranches(repositoryId: string): Promise<{
    success: boolean;
    branches?: string[];
    currentBranch?: string;
    worktreeBranches?: string[];
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
  isWorktree(repositoryId: string): boolean;
}

function createRepositoryCustomActions(): RepositoryStoreCustomActions {
  const { executeAction: executeRepositoryAction } = useCanvasWebSocketAction();
  const { showSuccessToast, showErrorToast } = useToast();

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

    async createWorktree(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
      worktreeName: string,
      sourceNotePosition: { x: number; y: number },
    ): Promise<{ success: boolean; error?: string }> {
      const result = await executeRepositoryAction<
        RepositoryWorktreeCreatePayload,
        RepositoryWorktreeCreatedPayload
      >(
        {
          requestEvent: WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
          responseEvent: WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
          payload: { repositoryId, worktreeName },
        },
        {
          errorCategory: "Repository",
          errorAction: t("store.repository.worktreeCreateFailed"),
          errorMessage: t("store.repository.worktreeCreateFailed"),
        },
      );

      if (!result.success) return result;

      if (!result.data.success) {
        const error = result.data.error || t("store.repository.worktreeCreateFailed");
        showErrorToast("Repository", t("store.repository.worktreeCreateFailed"), error);
        return { success: false, error };
      }

      if (result.data.repository) {
        this.availableItems.push(result.data.repository);

        await this.createNote(
          result.data.repository.id,
          sourceNotePosition.x + 150,
          sourceNotePosition.y + 80,
        );
      }

      showSuccessToast("Repository", t("store.repository.worktreeCreateSuccess"), worktreeName);
      return { success: true };
    },

    async getLocalBranches(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): Promise<{
      success: boolean;
      branches?: string[];
      currentBranch?: string;
      worktreeBranches?: string[];
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
        worktreeBranches: result.data.worktreeBranches,
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
        showSuccessToast("Git", t("store.repository.deleteBranchSuccess"), branchName);
      } else if (result.data.error) {
        showErrorToast("Git", t("store.repository.deleteBranchFailed"), result.data.error);
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

    isWorktree(
      this: NoteStoreContext<Repository>,
      repositoryId: string,
    ): boolean {
      const repository = this.availableItems.find(
        (item: Repository) => item.id === repositoryId,
      );
      return (
        repository?.parentRepoId !== undefined &&
        repository?.parentRepoId !== null &&
        repository?.parentRepoId !== ""
      );
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
