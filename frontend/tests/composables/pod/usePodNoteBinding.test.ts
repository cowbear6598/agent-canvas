import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { usePodNoteBinding } from "@/composables/pod/usePodNoteBinding";

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe("usePodNoteBinding", () => {
  const podId = ref("pod-1");

  let mockSkillStore: {
    bindToPod: ReturnType<typeof vi.fn>;
    getNoteById: ReturnType<typeof vi.fn>;
    isItemBoundToPod: ReturnType<typeof vi.fn>;
  };
  let mockSubAgentStore: {
    bindToPod: ReturnType<typeof vi.fn>;
    getNoteById: ReturnType<typeof vi.fn>;
    isItemBoundToPod: ReturnType<typeof vi.fn>;
  };
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
  let mockMcpServerStore: {
    bindToPod: ReturnType<typeof vi.fn>;
    getNoteById: ReturnType<typeof vi.fn>;
    isItemBoundToPod: ReturnType<typeof vi.fn>;
  };
  let mockPodStore: {
    updatePodRepository: ReturnType<typeof vi.fn>;
    updatePodCommand: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      isItemBoundToPod: vi.fn(() => false),
    };
    mockSubAgentStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      isItemBoundToPod: vi.fn(() => false),
    };
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
    mockMcpServerStore = {
      bindToPod: vi.fn().mockResolvedValue(undefined),
      getNoteById: vi.fn(),
      isItemBoundToPod: vi.fn(() => false),
    };
    mockPodStore = {
      updatePodRepository: vi.fn(),
      updatePodCommand: vi.fn(),
    };
  });

  function buildStores(): Parameters<typeof usePodNoteBinding>[1] {
    return {
      skillStore: mockSkillStore as Parameters<
        typeof usePodNoteBinding
      >[1]["skillStore"],
      subAgentStore: mockSubAgentStore as Parameters<
        typeof usePodNoteBinding
      >[1]["subAgentStore"],
      repositoryStore: mockRepositoryStore as Parameters<
        typeof usePodNoteBinding
      >[1]["repositoryStore"],
      commandStore: mockCommandStore as Parameters<
        typeof usePodNoteBinding
      >[1]["commandStore"],
      mcpServerStore: mockMcpServerStore as Parameters<
        typeof usePodNoteBinding
      >[1]["mcpServerStore"],
      podStore: mockPodStore as Parameters<
        typeof usePodNoteBinding
      >[1]["podStore"],
    };
  }

  describe("handleNoteDrop", () => {
    it("note 不存在時應直接 return，不呼叫 bindToPod", async () => {
      mockSkillStore.getNoteById.mockReturnValue(undefined);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("skill", "note-99");

      expect(mockSkillStore.bindToPod).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("skill 重複綁定時應顯示 toast 並不呼叫 bindToPod", async () => {
      mockSkillStore.getNoteById.mockReturnValue({ skillId: "skill-1" });
      mockSkillStore.isItemBoundToPod.mockReturnValue(true);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("skill", "note-1");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "已存在，無法插入",
          description: "此 Skill 已綁定到此 Pod",
        }),
      );
      expect(mockSkillStore.bindToPod).not.toHaveBeenCalled();
    });

    it("subAgent 重複綁定時應顯示 toast 並不呼叫 bindToPod", async () => {
      mockSubAgentStore.getNoteById.mockReturnValue({ subAgentId: "sub-1" });
      mockSubAgentStore.isItemBoundToPod.mockReturnValue(true);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("subAgent", "note-1");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "已存在，無法插入",
          description: "此 SubAgent 已綁定到此 Pod",
        }),
      );
      expect(mockSubAgentStore.bindToPod).not.toHaveBeenCalled();
    });

    it("mcpServer 重複綁定時應顯示 toast 並不呼叫 bindToPod", async () => {
      mockMcpServerStore.getNoteById.mockReturnValue({ mcpServerId: "mcp-1" });
      mockMcpServerStore.isItemBoundToPod.mockReturnValue(true);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("mcpServer", "note-1");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "已存在，無法插入",
          description: "此 MCP Server 已綁定到此 Pod",
        }),
      );
      expect(mockMcpServerStore.bindToPod).not.toHaveBeenCalled();
    });

    it("skill 綁定成功後應呼叫 bindToPod（skill 無 updatePodField）", async () => {
      mockSkillStore.getNoteById.mockReturnValue({ skillId: "skill-1" });
      mockSkillStore.isItemBoundToPod.mockReturnValue(false);

      const { handleNoteDrop } = usePodNoteBinding(podId, buildStores());
      await handleNoteDrop("skill", "note-1");

      expect(mockSkillStore.bindToPod).toHaveBeenCalledWith("note-1", "pod-1");
      expect(mockToast).not.toHaveBeenCalled();
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

    it("skill（無 unbindFromPod）移除時應直接 return，不拋出錯誤", async () => {
      const { handleNoteRemove } = usePodNoteBinding(podId, buildStores());
      await expect(handleNoteRemove("skill")).resolves.not.toThrow();

      expect(mockSkillStore.bindToPod).not.toHaveBeenCalled();
    });
  });
});
