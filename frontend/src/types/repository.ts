import type { BaseNote } from "./note";

export type GitPlatform = "github" | "gitlab" | "other";

export interface GitUrlParseResult {
  platform: GitPlatform;
  owner: string | null;
  repoName: string | null;
  isValid: boolean;
}

export interface Repository {
  id: string;
  name: string;
  isGit?: boolean;
  repoMemoryEnabled?: boolean;
  currentBranch?: string;
  hasRepoMemory?: boolean;
}

export interface RepositoryNote extends BaseNote {
  repositoryId: string;
}
