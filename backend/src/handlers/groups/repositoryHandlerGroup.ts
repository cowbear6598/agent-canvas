import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  repositoryListSchema,
  repositoryCreateSchema,
  repositoryNoteCreateSchema,
  repositoryNoteListSchema,
  repositoryNoteUpdateSchema,
  repositoryNoteDeleteSchema,
  podBindRepositorySchema,
  podUnbindRepositorySchema,
  repositoryDeleteSchema,
  repositoryGitCloneSchema,
  repositoryCheckGitSchema,
  repositoryWorktreeCreateSchema,
  repositoryGetLocalBranchesSchema,
  repositoryCheckDirtySchema,
  repositoryCheckoutBranchSchema,
  repositoryDeleteBranchSchema,
  repositoryPullLatestSchema,
} from '../../schemas';
import {
  handleRepositoryList,
  handleRepositoryCreate,
  repositoryNoteHandlers,
  handlePodBindRepository,
  handlePodUnbindRepository,
  handleRepositoryDelete,
} from '../repositoryHandlers.js';
import {
  handleRepositoryGitClone,
  handleRepositoryCheckGit,
  handleRepositoryWorktreeCreate,
  handleRepositoryGetLocalBranches,
  handleRepositoryCheckDirty,
  handleRepositoryCheckoutBranch,
  handleRepositoryDeleteBranch,
  handleRepositoryPullLatest,
} from '../repositoryGitHandlers.js';
import { createHandlerGroup } from './createHandlerGroup.js';

export const repositoryHandlerGroup = createHandlerGroup({
  name: 'repository',
  handlers: [
    {
      event: WebSocketRequestEvents.REPOSITORY_LIST,
      handler: handleRepositoryList,
      schema: repositoryListSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_CREATE,
      handler: handleRepositoryCreate,
      schema: repositoryCreateSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_CREATED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_NOTE_CREATE,
      handler: repositoryNoteHandlers.handleNoteCreate,
      schema: repositoryNoteCreateSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_NOTE_LIST,
      handler: repositoryNoteHandlers.handleNoteList,
      schema: repositoryNoteListSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_NOTE_UPDATE,
      handler: repositoryNoteHandlers.handleNoteUpdate,
      schema: repositoryNoteUpdateSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_NOTE_DELETE,
      handler: repositoryNoteHandlers.handleNoteDelete,
      schema: repositoryNoteDeleteSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
    },
    {
      event: WebSocketRequestEvents.POD_BIND_REPOSITORY,
      handler: handlePodBindRepository,
      schema: podBindRepositorySchema,
      responseEvent: WebSocketResponseEvents.POD_REPOSITORY_BOUND,
    },
    {
      event: WebSocketRequestEvents.POD_UNBIND_REPOSITORY,
      handler: handlePodUnbindRepository,
      schema: podUnbindRepositorySchema,
      responseEvent: WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_DELETE,
      handler: handleRepositoryDelete,
      schema: repositoryDeleteSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_DELETED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_GIT_CLONE,
      handler: handleRepositoryGitClone,
      schema: repositoryGitCloneSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_CHECK_GIT,
      handler: handleRepositoryCheckGit,
      schema: repositoryCheckGitSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_WORKTREE_CREATE,
      handler: handleRepositoryWorktreeCreate,
      schema: repositoryWorktreeCreateSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_GET_LOCAL_BRANCHES,
      handler: handleRepositoryGetLocalBranches,
      schema: repositoryGetLocalBranchesSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_CHECK_DIRTY,
      handler: handleRepositoryCheckDirty,
      schema: repositoryCheckDirtySchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_CHECKOUT_BRANCH,
      handler: handleRepositoryCheckoutBranch,
      schema: repositoryCheckoutBranchSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_DELETE_BRANCH,
      handler: handleRepositoryDeleteBranch,
      schema: repositoryDeleteBranchSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED,
    },
    {
      event: WebSocketRequestEvents.REPOSITORY_PULL_LATEST,
      handler: handleRepositoryPullLatest,
      schema: repositoryPullLatestSchema,
      responseEvent: WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT,
    },
  ],
});
