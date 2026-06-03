import type { Pod } from "@/types";

type RepositoryMemoryState = {
  hasRepoMemory?: boolean;
  repoMemoryEnabled?: boolean;
};

type RepositoryMemorySyncHandlers = {
  applyRepositoryMemoryState: (
    repositoryId: string,
    state: RepositoryMemoryState,
  ) => void;
  applyPods: (pods: Pod[]) => void;
};

let handlers: RepositoryMemorySyncHandlers | null = null;

export function registerRepositoryMemorySyncHandlers(
  nextHandlers: RepositoryMemorySyncHandlers,
): void {
  handlers = nextHandlers;
}

export function syncRepositoryMemoryStateToPods(
  repositoryId: string,
  state: RepositoryMemoryState,
): void {
  handlers?.applyRepositoryMemoryState(repositoryId, state);
}

export function syncRepositoryPodsToPodStore(pods: Pod[]): void {
  if (pods.length === 0) return;
  handlers?.applyPods(pods);
}
