import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { usePodNoteBinding } from "@/composables/pod/usePodNoteBinding";

describe("usePodNoteBinding", () => {
  const podId = ref("pod-1");

  let mockRepositoryStore: {
    bindToPod: ReturnType<typeof vi.fn>;
    getNoteById: ReturnType<typeof vi.fn>;
    unbindFromPod: ReturnType<typeof vi.fn>;
  };
  let mockPodStore: {
    updatePodRepository: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepositoryStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      unbindFromPod: vi.fn().mockResolvedValue(undefined),
    };
    mockPodStore = {
      updatePodRepository: vi.fn(),
    };
  });

  function buildStores(): Parameters<typeof usePodNoteBinding>[1] {
    return {
      repositoryStore: mockRepositoryStore as any,
      podStore: mockPodStore as any,
    };
  }

  it("noteId 為空時不綁定", async () => {
    const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
    await handleNoteDrop("repository", "");

    expect(mockRepositoryStore.bindToPod).not.toHaveBeenCalled();
    expect(mockPodStore.updatePodRepository).not.toHaveBeenCalled();
  });

  it("找不到 note 時不綁定", async () => {
    mockRepositoryStore.getNoteById.mockReturnValue(undefined);

    const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
    await handleNoteDrop("repository", "note-missing");

    expect(mockRepositoryStore.bindToPod).not.toHaveBeenCalled();
    expect(mockPodStore.updatePodRepository).not.toHaveBeenCalled();
  });

  it("repository 綁定成功後同步 pod.repositoryId", async () => {
    mockRepositoryStore.getNoteById.mockReturnValue({
      repositoryId: "repo-1",
    });

    const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
    await handleNoteDrop("repository", "note-1");

    expect(mockRepositoryStore.bindToPod).toHaveBeenCalledWith(
      "note-1",
      "pod-1",
    );
    expect(mockPodStore.updatePodRepository).toHaveBeenCalledWith(
      "pod-1",
      "repo-1",
    );
  });

  it("移除 repository note 時清空 pod.repositoryId", async () => {
    const { handleNoteRemove } = usePodNoteBinding(podId, buildStores());
    await handleNoteRemove("repository");

    expect(mockRepositoryStore.unbindFromPod).toHaveBeenCalledWith("pod-1", {
      mode: "return-to-original",
    });
    expect(mockPodStore.updatePodRepository).toHaveBeenCalledWith(
      "pod-1",
      null,
    );
  });
});
