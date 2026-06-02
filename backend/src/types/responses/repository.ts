import type { RepositoryNote } from "../repositoryNote.js";
import type { Repository } from "../repository.js";
import type { PodPublicView } from "../pod.js";

export interface RepositoryListResultPayload {
  requestId: string;
  success: boolean;
  repositories?: Array<
    Pick<
      Repository,
      "id" | "name" | "currentBranch" | "repoMemoryEnabled" | "hasRepoMemory"
    >
  >;
  error?: string;
}

export interface RepositoryCreatedPayload {
  requestId: string;
  success: boolean;
  repository?: Pick<
    Repository,
    "id" | "name" | "repoMemoryEnabled" | "hasRepoMemory"
  >;
  error?: string;
}

export interface RepositoryNoteCreatedPayload {
  requestId: string;
  success: boolean;
  note?: RepositoryNote;
  error?: string;
}

export interface RepositoryNoteListResultPayload {
  requestId: string;
  success: boolean;
  notes?: RepositoryNote[];
  error?: string;
}

export interface RepositoryNoteUpdatedPayload {
  requestId: string;
  success: boolean;
  note?: RepositoryNote;
  error?: string;
}

export interface RepositoryNoteDeletedPayload {
  requestId: string;
  success: boolean;
  noteId?: string;
  error?: string;
}

export interface RepositoryDeletedPayload {
  requestId: string;
  success: boolean;
  repositoryId?: string;
  deletedNoteIds?: string[];
  error?: string;
}

export interface RepositoryGitCloneProgressPayload {
  requestId: string;
  progress: number;
  message: string;
}

export interface RepositoryGitCloneResultPayload {
  requestId: string;
  success: boolean;
  repository?: Pick<
    Repository,
    "id" | "name" | "repoMemoryEnabled" | "hasRepoMemory"
  >;
  error?: string;
}

export interface RepositoryCheckGitResultPayload {
  requestId: string;
  success: boolean;
  isGit?: boolean;
  error?: string;
}

export interface RepositoryLocalBranchesResultPayload {
  requestId: string;
  success: boolean;
  branches?: string[];
  currentBranch?: string;
  error?: string;
}

export interface RepositoryDirtyCheckResultPayload {
  requestId: string;
  success: boolean;
  isDirty?: boolean;
  error?: string;
}

export interface RepositoryCheckoutBranchProgressPayload {
  requestId: string;
  progress: number;
  message: string;
  branchName: string;
}

export interface RepositoryBranchCheckedOutPayload {
  requestId: string;
  success: boolean;
  repositoryId?: string;
  branchName?: string;
  action?: "switched" | "fetched" | "created";
  error?: string;
}

export interface RepositoryBranchDeletedPayload {
  requestId: string;
  success: boolean;
  branchName?: string;
  error?: string;
}

export interface RepositoryPullLatestProgressPayload {
  requestId: string;
  progress: number;
  message: string;
}

export interface RepositoryPullLatestResultPayload {
  requestId: string;
  success: boolean;
  repositoryId?: string;
  error?: string;
}

export interface RepositoryMemoryResultPayload {
  requestId: string;
  success: boolean;
  canvasId: string;
  repositoryId?: string;
  memoryEnabled?: boolean;
  hasSummary?: boolean;
  summary?: string | null;
  summaryUpdatedAt?: string | null;
  error?: string;
}

export interface RepositoryMemoryClearedPayload {
  requestId: string;
  success: boolean;
  canvasId: string;
  repositoryId?: string;
  repository?: Pick<
    Repository,
    "id" | "name" | "repoMemoryEnabled" | "hasRepoMemory"
  >;
  pods?: Array<
    Pick<PodPublicView, "id" | "repoMemoryEnabled" | "hasRepoMemory">
  >;
  error?: string;
}

export interface RepositoryMemoryEnabledSetPayload {
  requestId: string;
  success: boolean;
  canvasId: string;
  repositoryId?: string;
  repository?: Pick<
    Repository,
    "id" | "name" | "repoMemoryEnabled" | "hasRepoMemory"
  >;
  pods?: Array<
    Pick<PodPublicView, "id" | "repoMemoryEnabled" | "hasRepoMemory">
  >;
  error?: string;
}
