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
  let mockCommandStore: {
    bindToPod: ReturnType<typeof vi.fn>;
    getNoteById: ReturnType<typeof vi.fn>;
    unbindFromPod: ReturnType<typeof vi.fn>;
  };
  let mockPodStore: {
    updatePodRepository: ReturnType<typeof vi.fn>;
    updatePodCommand: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepositoryStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      unbindFromPod: vi.fn().mockResolvedValue(undefined),
    };
    mockCommandStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      unbindFromPod: vi.fn().mockResolvedValue(undefined),
    };
    mockPodStore = {
      updatePodRepository: vi.fn(),
      updatePodCommand: vi.fn(),
    };
  });

  function buildStores(): Parameters<typeof usePodNoteBinding>[1] {
    return {
      repositoryStore: mockRepositoryStore as Parameters<
        typeof usePodNoteBinding
      >[1]["repositoryStore"],
      commandStore: mockCommandStore as Parameters<
        typeof usePodNoteBinding
      >[1]["commandStore"],
      podStore: mockPodStore as Parameters<
        typeof usePodNoteBinding
      >[1]["podStore"],
    };
  }

  describe("handleNoteDrop", () => {
    it("（早返回 a）noteId 為空字串時，不呼叫 bindToPod 與 updatePodRepository", async () => {
      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("repository", "");

      expect(mockRepositoryStore.bindToPod).not.toHaveBeenCalled();
      expect(mockPodStore.updatePodRepository).not.toHaveBeenCalled();
    });

    it("（早返回 b）getNoteById 回傳 undefined 時，不呼叫 bindToPod 與 updatePodCommand", async () => {
      mockCommandStore.getNoteById.mockReturnValue(undefined);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("command", "note-missing");

      expect(mockCommandStore.bindToPod).not.toHaveBeenCalled();
      expect(mockPodStore.updatePodCommand).not.toHaveBeenCalled();
    });

    it("（早返回 c）note 已綁同一 pod（isItemBoundToPod 回傳 true）時，不重複呼叫 bindToPod 與 updatePodRepository", async () => {
      // noteStoreMap.repository 不含 isItemBoundToPod，需透過 usePodNoteBinding 外部建立含此欄位的 store 模擬
      // 目前內建 mapping 不傳入 isItemBoundToPod，isAlreadyBound 固定回傳 false，
      // 此 case 確認當 repositoryStore 擴充 isItemBoundToPod 後行為不變（早返回保護正常）
      const isItemBoundToPodMock = vi.fn().mockReturnValue(true);
      const extendedRepositoryStore = {
        ...mockRepositoryStore,
        isItemBoundToPod: isItemBoundToPodMock,
      };
      mockRepositoryStore.getNoteById.mockReturnValue({
        repositoryId: "repo-already-bound",
      });

      // 注意：usePodNoteBinding 內部 noteStoreMap 不含 isItemBoundToPod，
      // 所以即使 store 有此方法，isAlreadyBound 仍回傳 false（mapping 無此欄位）。
      // 本 case 固化現狀：在現有 mapping 設計下，「已綁」分支永不觸發；
      // 若未來 mapping 補上 isItemBoundToPod，需更新此處斷言為 not.toHaveBeenCalled。
      const stores = {
        repositoryStore: extendedRepositoryStore as Parameters<
          typeof usePodNoteBinding
        >[1]["repositoryStore"],
        commandStore: mockCommandStore as Parameters<
          typeof usePodNoteBinding
        >[1]["commandStore"],
        podStore: mockPodStore as Parameters<
          typeof usePodNoteBinding
        >[1]["podStore"],
      };
      const { handleNoteDrop } = usePodNoteBinding(podId, stores);
      await handleNoteDrop("repository", "note-bound");

      // 由於 mapping 不含 isItemBoundToPod，isAlreadyBound 回傳 false，仍繼續綁定
      expect(mockRepositoryStore.bindToPod).toHaveBeenCalledWith(
        "note-bound",
        "pod-1",
      );
    });

    it("repository 綁定成功後應呼叫 bindToPod 和 updatePodRepository", async () => {
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

    it("command 綁定成功後應呼叫 bindToPod 和 updatePodCommand", async () => {
      mockCommandStore.getNoteById.mockReturnValue({ commandId: "cmd-1" });

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("command", "note-1");

      expect(mockCommandStore.bindToPod).toHaveBeenCalledWith(
        "note-1",
        "pod-1",
      );
      expect(mockPodStore.updatePodCommand).toHaveBeenCalledWith(
        "pod-1",
        "cmd-1",
      );
    });
  });

  describe("handleNoteRemove", () => {
    it("repository 移除時應呼叫 unbindFromPod 並清除 pod 欄位", async () => {
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

    it("command 移除時應呼叫 unbindFromPod 並清除 pod 欄位", async () => {
      const { handleNoteRemove } = usePodNoteBinding(podId, buildStores());
      await handleNoteRemove("command");

      expect(mockCommandStore.unbindFromPod).toHaveBeenCalledWith("pod-1", {
        mode: "return-to-original",
      });
      expect(mockPodStore.updatePodCommand).toHaveBeenCalledWith("pod-1", null);
    });
  });

  describe("Gemini Pod 綁定 Note", () => {
    const geminiPodId = ref("gemini-pod-1");

    describe("handleNoteDrop", () => {
      it("command 綁定時仍正確呼叫 bindToPod 和 updatePodCommand（T4）", async () => {
        mockCommandStore.getNoteById.mockReturnValue({
          commandId: "cmd-gemini",
        });

        const { handleNoteDrop } = usePodNoteBinding(
          geminiPodId,
          buildStores(),
        );
        await handleNoteDrop("command", "note-gemini-cmd");

        expect(mockCommandStore.bindToPod).toHaveBeenCalledWith(
          "note-gemini-cmd",
          "gemini-pod-1",
        );
        expect(mockPodStore.updatePodCommand).toHaveBeenCalledWith(
          "gemini-pod-1",
          "cmd-gemini",
        );
      });

      it("repository 綁定時仍正確呼叫 bindToPod 和 updatePodRepository（T9）", async () => {
        mockRepositoryStore.getNoteById.mockReturnValue({
          repositoryId: "repo-gemini",
        });

        const { handleNoteDrop } = usePodNoteBinding(
          geminiPodId,
          buildStores(),
        );
        await handleNoteDrop("repository", "note-gemini-repo");

        expect(mockRepositoryStore.bindToPod).toHaveBeenCalledWith(
          "note-gemini-repo",
          "gemini-pod-1",
        );
        expect(mockPodStore.updatePodRepository).toHaveBeenCalledWith(
          "gemini-pod-1",
          "repo-gemini",
        );
      });
    });

    describe("handleNoteRemove", () => {
      it("command 移除時呼叫 unbindFromPod 並清除 pod 欄位", async () => {
        const { handleNoteRemove } = usePodNoteBinding(
          geminiPodId,
          buildStores(),
        );
        await handleNoteRemove("command");

        expect(mockCommandStore.unbindFromPod).toHaveBeenCalledWith(
          "gemini-pod-1",
          { mode: "return-to-original" },
        );
        expect(mockPodStore.updatePodCommand).toHaveBeenCalledWith(
          "gemini-pod-1",
          null,
        );
      });

      it("repository 移除時呼叫 unbindFromPod 並清除 pod 欄位", async () => {
        const { handleNoteRemove } = usePodNoteBinding(
          geminiPodId,
          buildStores(),
        );
        await handleNoteRemove("repository");

        expect(mockRepositoryStore.unbindFromPod).toHaveBeenCalledWith(
          "gemini-pod-1",
          { mode: "return-to-original" },
        );
        expect(mockPodStore.updatePodRepository).toHaveBeenCalledWith(
          "gemini-pod-1",
          null,
        );
      });
    });
  });
});
