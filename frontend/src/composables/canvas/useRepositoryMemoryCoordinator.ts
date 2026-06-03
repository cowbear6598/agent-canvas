import { usePodStore } from "@/stores/pod/podStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";

type RepositoryStore = ReturnType<typeof useRepositoryStore>;
type RepositoryMemoryResult = Awaited<
  ReturnType<RepositoryStore["getRepoMemory"]>
>;

export function useRepositoryMemoryCoordinator(): {
  setRepoMemoryEnabled: (
    repositoryId: string,
    memoryEnabled: boolean,
  ) => Promise<void>;
  getRepoMemory: (repositoryId: string) => Promise<RepositoryMemoryResult>;
  clearRepoMemory: (repositoryId: string) => Promise<void>;
} {
  const repositoryStore = useRepositoryStore();
  const podStore = usePodStore();

  async function setRepoMemoryEnabled(
    repositoryId: string,
    memoryEnabled: boolean,
  ): Promise<void> {
    const result = await repositoryStore.setRepoMemoryEnabled(
      repositoryId,
      memoryEnabled,
    );
    if (!result.success) return;

    for (const pod of result.pods) {
      podStore.updatePod(pod);
    }
  }

  async function getRepoMemory(
    repositoryId: string,
  ): Promise<RepositoryMemoryResult> {
    const result = await repositoryStore.getRepoMemory(repositoryId);
    if (!result.success) return result;

    podStore.setRepositoryMemoryState(repositoryId, {
      hasRepoMemory: result.hasSummary,
      repoMemoryEnabled: result.memoryEnabled,
    });
    return result;
  }

  async function clearRepoMemory(repositoryId: string): Promise<void> {
    const result = await repositoryStore.clearRepoMemory(repositoryId);
    if (!result.success) return;

    for (const pod of result.pods) {
      podStore.updatePod(pod);
    }
  }

  return {
    setRepoMemoryEnabled,
    getRepoMemory,
    clearRepoMemory,
  };
}
