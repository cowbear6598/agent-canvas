export interface Repository {
  id: string;
  name: string;
  path: string;
  currentBranch?: string;
  repoMemoryEnabled: boolean;
  hasRepoMemory: boolean;
}
