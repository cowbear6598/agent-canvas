import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { useEditModal } from "@/composables/canvas/useEditModal";

describe("useEditModal", () => {
  const mockViewportStore = {
    offset: { x: 0, y: 0 },
    zoom: 1,
  };

  let mockCommandStore: {
    readCommand: ReturnType<typeof vi.fn>;
    createCommand: ReturnType<typeof vi.fn>;
    updateCommand: ReturnType<typeof vi.fn>;
    createNote: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
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
          commandStore: mockCommandStore as any,
          viewportStore: mockViewportStore,
        },
        lastMenuPosition,
      ),
      lastMenuPosition,
    };
  }

  describe("handleOpenCreateModal - 開啟建立 Modal", () => {
    it("開啟 command 建立 Modal 時應設定正確 resourceType", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateModal("command", "建立 Command");

      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("create");
      expect(composable.editModal.value.title).toBe("建立 Command");
      expect(composable.editModal.value.resourceType).toBe("command");
      expect(composable.editModal.value.showContent).toBe(true);
    });
  });

  describe("handleOpenCreateGroupModal - 開啟建立群組 Modal", () => {
    it("開啟群組建立 Modal 時 showContent 應為 false", () => {
      const { composable } = createComposable();
      composable.handleOpenCreateGroupModal("commandGroup", "建立群組");

      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("create");
      expect(composable.editModal.value.resourceType).toBe("commandGroup");
      expect(composable.editModal.value.showContent).toBe(false);
    });
  });

  describe("handleOpenEditModal - 開啟編輯 Modal", () => {
    it("開啟 command 編輯 Modal 時應讀取資料並設定初始值", async () => {
      const { composable } = createComposable();
      await composable.handleOpenEditModal("command", "cmd-1");

      expect(mockCommandStore.readCommand).toHaveBeenCalledWith("cmd-1");
      expect(composable.editModal.value.visible).toBe(true);
      expect(composable.editModal.value.mode).toBe("edit");
      expect(composable.editModal.value.title).toBe("編輯 Command");
      expect(composable.editModal.value.initialName).toBe("My Command");
      expect(composable.editModal.value.initialContent).toBe("content");
    });

    it("讀取資料失敗時不應開啟 Modal", async () => {
      const { composable } = createComposable();
      mockCommandStore.readCommand.mockResolvedValue(null);

      await composable.handleOpenEditModal("command", "cmd-not-found");

      expect(composable.editModal.value.visible).toBe(false);
    });

    it("開啟 command 編輯 Modal 時標題應包含 Command", async () => {
      const { composable } = createComposable();
      await composable.handleOpenEditModal("command", "cmd-1");

      expect(composable.editModal.value.title).toBe("編輯 Command");
    });
  });

  describe("handleCreateEditSubmit（edit mode）- 更新資源", () => {
    it("更新 command 後應關閉 Modal", async () => {
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
        name: "name",
        content: "cmd content",
      });

      expect(mockCommandStore.updateCommand).toHaveBeenCalledWith(
        "cmd-1",
        "cmd content",
      );
      expect(composable.editModal.value.visible).toBe(false);
    });
  });

  describe("handleCreateEditSubmit（create mode）- 建立資源", () => {
    it("建立 command 後應呼叫 createNote 並關閉 Modal", async () => {
      const { composable } = createComposable({ x: 100, y: 200 });
      composable.handleOpenCreateModal("command", "建立");

      await composable.handleCreateEditSubmit({
        name: "My Command",
        content: "cmd content",
      });

      expect(mockCommandStore.createCommand).toHaveBeenCalledWith(
        "My Command",
        "cmd content",
      );
      expect(mockCommandStore.createNote).toHaveBeenCalledWith(
        "cmd-new",
        100,
        200,
      );
      expect(composable.editModal.value.visible).toBe(false);
    });

    it("建立群組時應呼叫 createGroup 而非 createNote", async () => {
      const { composable } = createComposable();
      composable.handleOpenCreateGroupModal("commandGroup", "建立群組");

      await composable.handleCreateEditSubmit({
        name: "My Group",
        content: "",
      });

      expect(mockCommandStore.createGroup).toHaveBeenCalledWith("My Group");
      expect(mockCommandStore.createNote).not.toHaveBeenCalled();
      expect(composable.editModal.value.visible).toBe(false);
    });

    it("沒有 lastMenuPosition 時不應建立 Note", async () => {
      const { composable, lastMenuPosition } = createComposable();
      lastMenuPosition.value = null;
      composable.handleOpenCreateModal("command", "建立 Command");

      await composable.handleCreateEditSubmit({
        name: "Command",
        content: "content",
      });

      expect(mockCommandStore.createCommand).toHaveBeenCalled();
      expect(mockCommandStore.createNote).not.toHaveBeenCalled();
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
      composable.handleOpenCreateModal("command", "建立");
      expect(composable.editModal.value.visible).toBe(true);

      composable.closeEditModal();

      expect(composable.editModal.value.visible).toBe(false);
    });
  });
});
