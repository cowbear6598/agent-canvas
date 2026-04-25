import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { useEditModal } from "@/composables/canvas/useEditModal";

describe("useEditModal", () => {
  const mockViewportStore = {
    offset: { x: 0, y: 0 },
    zoom: 1,
  };

  let mockSubAgentStore: {
    readSubAgent: ReturnType<typeof vi.fn>;
    createSubAgent: ReturnType<typeof vi.fn>;
    updateSubAgent: ReturnType<typeof vi.fn>;
    createNote: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
  };

  let mockCommandStore: {
    readCommand: ReturnType<typeof vi.fn>;
    createCommand: ReturnType<typeof vi.fn>;
    updateCommand: ReturnType<typeof vi.fn>;
    createNote: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSubAgentStore = {
      readSubAgent: vi.fn().mockResolvedValue({
        id: "sa-1",
        name: "My Agent",
        content: "content",
      }),
      createSubAgent: vi
        .fn()
        .mockResolvedValue({ success: true, subAgent: { id: "sa-new" } }),
      updateSubAgent: vi.fn().mockResolvedValue({ success: true }),
      createNote: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn().mockResolvedValue({ success: true }),
    };

    mockCommandStore = {
      readCommand: vi.fn().mockResolvedValue({
        id: "cmd-1",
        name: "My Command",
        content: "content",
      }),
      createCommand: vi
        .fn()
        .mockResolvedValue({ success: true, command: { id: "cmd-new" } }),
      updateCommand: vi.fn().mockResolvedValue({ success: true }),
      createNote: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  function createComposable(menuPosition = { x: 100, y: 200 }) {
    const lastMenuPosition = ref<{ x: number; y: number } | null>(menuPosition);
    return {
      composable: useEditModal(
        {
          subAgentStore: mockSubAgentStore as any,
          commandStore: mockCommandStore as any,
          viewportStore: mockViewportStore,
        },
        lastMenuPosition,
      ),
      lastMenuPosition,
    };
  }

  describe("handleOpenCreateModal - 開啟建立 Modal", () => {
    it("開啟 subAgent 建立 Modal 時應設定正確初始狀態", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateModal("subAgent", "建立 SubAgent");

      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("create");
      expect(composable.editModal.value.title).toBe("建立 SubAgent");
      expect(composable.editModal.value.resourceType).toBe("subAgent");
      expect(composable.editModal.value.initialName).toBe("");
      expect(composable.editModal.value.initialContent).toBe("");
      expect(composable.editModal.value.showContent).toBe(true);
    });

    it("開啟 command 建立 Modal 時應設定正確 resourceType", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateModal("command", "建立 Command");

      expect(composable.editModal.value.resourceType).toBe("command");
      expect(composable.editModal.value.showContent).toBe(true);
    });
  });

  describe("handleOpenCreateGroupModal - 開啟建立群組 Modal", () => {
    it("開啟群組建立 Modal 時 showContent 應為 false", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateGroupModal("subAgentGroup", "建立群組");

      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("create");
      expect(composable.editModal.value.resourceType).toBe("subAgentGroup");
      expect(composable.editModal.value.showContent).toBe(false);
    });
  });

  describe("handleOpenEditModal - 開啟編輯 Modal", () => {
    it("開啟 subAgent 編輯 Modal 時應讀取資料並設定初始值", async () => {
      const { composable } = createComposable();
      await composable.handleOpenEditModal("subAgent", "sa-1");

      expect(mockSubAgentStore.readSubAgent).toHaveBeenCalledWith("sa-1");
      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("edit");
      expect(composable.editModal.value.title).toBe("編輯 SubAgent");
      expect(composable.editModal.value.initialName).toBe("My Agent");
      expect(composable.editModal.value.initialContent).toBe("content");
    });

    it("讀取資料失敗時不應開啟 Modal", async () => {
      const { composable } = createComposable();
      mockSubAgentStore.readSubAgent.mockResolvedValue(null);

      await composable.handleOpenEditModal("subAgent", "sa-not-found");

      expect(composable.editModal.value.visible).toBe(false);
    });

    it("開啟 command 編輯 Modal 時標題應包含 Command", async () => {
      const { composable } = createComposable();
      await composable.handleOpenEditModal("command", "cmd-1");

      expect(composable.editModal.value.title).toBe("編輯 Command");
    });
  });

  describe("handleCreateEditSubmit（edit mode）- 更新資源", () => {
    it("更新 subAgent 後應關閉 Modal", async () => {
      const { composable } = createComposable();
      composable.editModal.value = {
        visible: true,
        mode: "edit",
        title: "",
        initialName: "",
        initialContent: "",
        resourceType: "subAgent",
        itemId: "sa-1",
        showContent: true,
      };

      await composable.handleCreateEditSubmit({
        name: "name",
        content: "agent content",
      });

      expect(mockSubAgentStore.updateSubAgent).toHaveBeenCalledWith(
        "sa-1",
        "agent content",
      );
      expect(composable.editModal.value.visible).toBe(false);
    });
  });

  describe("handleCreateEditSubmit（create mode）- 建立資源", () => {
    it("建立 subAgent 後應呼叫 createNote 並關閉 Modal", async () => {
      const { composable } = createComposable({ x: 100, y: 200 });
      composable.handleOpenCreateModal("subAgent", "建立");

      await composable.handleCreateEditSubmit({
        name: "My Agent",
        content: "agent content",
      });

      expect(mockSubAgentStore.createSubAgent).toHaveBeenCalledWith(
        "My Agent",
        "agent content",
      );
      expect(mockSubAgentStore.createNote).toHaveBeenCalledWith(
        "sa-new",
        100,
        200,
      );
      expect(composable.editModal.value.visible).toBe(false);
    });

    it("建立群組時應呼叫 createGroup 而非 createNote", async () => {
      const { composable } = createComposable();
      composable.handleOpenCreateGroupModal("subAgentGroup", "建立群組");

      await composable.handleCreateEditSubmit({
        name: "My Group",
        content: "",
      });

      expect(mockSubAgentStore.createGroup).toHaveBeenCalledWith("My Group");
      expect(mockSubAgentStore.createNote).not.toHaveBeenCalled();
      expect(composable.editModal.value.visible).toBe(false);
    });

    it("建立 command 群組時應呼叫 commandStore.createGroup", async () => {
      const { composable } = createComposable();
      composable.handleOpenCreateGroupModal("commandGroup", "建立指令群組");

      await composable.handleCreateEditSubmit({
        name: "CMD Group",
        content: "",
      });

      expect(mockCommandStore.createGroup).toHaveBeenCalledWith("CMD Group");
    });

    it("沒有 lastMenuPosition 時不應建立 Note", async () => {
      const { composable, lastMenuPosition } = createComposable();
      lastMenuPosition.value = null;
      composable.handleOpenCreateModal("subAgent", "建立 SubAgent");

      await composable.handleCreateEditSubmit({
        name: "Agent",
        content: "content",
      });

      expect(mockSubAgentStore.createSubAgent).toHaveBeenCalled();
      expect(mockSubAgentStore.createNote).not.toHaveBeenCalled();
    });
  });

  describe("handleCreateEditSubmit - 統一提交", () => {
    it("edit mode 應呼叫 handleUpdate", async () => {
      const { composable } = createComposable();
      composable.editModal.value = {
        visible: true,
        mode: "edit",
        title: "",
        initialName: "",
        initialContent: "",
        resourceType: "command",
        itemId: "cmd-1",
        showContent: true,
      };

      await composable.handleCreateEditSubmit({
        name: "cmd",
        content: "new content",
      });

      expect(mockCommandStore.updateCommand).toHaveBeenCalledWith(
        "cmd-1",
        "new content",
      );
    });

    it("create mode 應呼叫 handleCreate", async () => {
      const { composable } = createComposable();
      composable.handleOpenCreateModal("command", "建立指令");

      await composable.handleCreateEditSubmit({
        name: "New Cmd",
        content: "cmd content",
      });

      expect(mockCommandStore.createCommand).toHaveBeenCalledWith(
        "New Cmd",
        "cmd content",
      );
    });
  });

  describe("closeEditModal - 關閉 Modal", () => {
    it("關閉 Modal 後 visible 應為 false", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateModal("subAgent", "建立");
      expect(composable.editModal.value.visible).toBe(true);

      composable.closeEditModal();

      expect(composable.editModal.value.visible).toBe(false);
    });
  });
});
