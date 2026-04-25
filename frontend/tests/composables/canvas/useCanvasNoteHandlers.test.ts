import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { useCanvasNoteHandlers } from "@/composables/canvas/useCanvasNoteHandlers";
import type { McpServerConfig } from "@/types";

vi.mock("@/composables/canvas/useNoteEventHandlers", () => ({
  useNoteEventHandlers: () => ({
    handleDragEnd: vi.fn(),
    handleDragMove: vi.fn(),
    handleDragComplete: vi.fn(),
  }),
}));

function createNoteStore(overrides: Record<string, unknown> = {}) {
  return {
    isDraggingNote: false,
    isOverTrash: false,
    notes: [] as unknown[],
    createNote: vi.fn(),
    updateNotePositionLocal: vi.fn(),
    updateNotePosition: vi.fn().mockResolvedValue(undefined),
    setIsOverTrash: vi.fn(),
    setNoteAnimating: vi.fn(),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    getNoteById: vi.fn(),
    typedNotes: [] as Array<Record<string, unknown>>,
    typedAvailableItems: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function createOptions(overrides: Record<string, unknown> = {}) {
  const podStore = {
    podCount: 0,
    typeMenu: { position: null as { x: number; y: number } | null },
  };
  const viewportStore = { offset: { x: 0, y: 0 }, zoom: 1 };
  const skillStore = createNoteStore();
  const subAgentStore = createNoteStore();
  const repositoryStore = createNoteStore();
  const commandStore = createNoteStore();
  const mcpServerStore = createNoteStore({
    readMcpServer: vi.fn().mockResolvedValue(null),
  });
  const trashZoneRef = ref(null);
  const handleOpenEditModal = vi.fn().mockResolvedValue(undefined);
  const mcpServerModal = ref({
    visible: false,
    mode: "create" as "create" | "edit",
    mcpServerId: "",
    initialName: "",
    initialConfig: undefined as McpServerConfig | undefined,
  });

  return {
    podStore,
    viewportStore,
    skillStore,
    subAgentStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
    trashZoneRef,
    handleOpenEditModal,
    mcpServerModal,
    ...overrides,
  };
}

describe("useCanvasNoteHandlers", () => {
  describe("showTrashZone", () => {
    it("任一 store 有 isDraggingNote 時為 true", () => {
      const options = createOptions();
      options.skillStore.isDraggingNote = true;

      const { showTrashZone } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      expect(showTrashZone.value).toBe(true);
    });

    it("所有 store 的 isDraggingNote 都為 false 時為 false", () => {
      const options = createOptions();

      const { showTrashZone } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      expect(showTrashZone.value).toBe(false);
    });
  });

  describe("isCanvasEmpty", () => {
    it("podCount 為 0 且所有 notes 皆空時為 true", () => {
      const options = createOptions();

      const { isCanvasEmpty } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      expect(isCanvasEmpty.value).toBe(true);
    });

    it("podCount 不為 0 時為 false", () => {
      const options = createOptions();
      options.podStore.podCount = 1;

      const { isCanvasEmpty } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      expect(isCanvasEmpty.value).toBe(false);
    });

    it("任一 store 有 notes 時為 false", () => {
      const options = createOptions();
      options.skillStore.notes = [{ id: "note-1" }];

      const { isCanvasEmpty } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      expect(isCanvasEmpty.value).toBe(false);
    });
  });

  describe("handleNoteDoubleClick", () => {
    it("subAgent 類型應呼叫 handleOpenEditModal", async () => {
      const options = createOptions();
      options.subAgentStore.typedNotes = [{ id: "note-1", subAgentId: "sa-1" }];

      const { handleNoteDoubleClick } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      await handleNoteDoubleClick({
        noteId: "note-1",
        noteType: "subAgent",
      });

      expect(options.handleOpenEditModal).toHaveBeenCalledWith(
        "subAgent",
        "sa-1",
      );
    });

    it("mcpServer 類型應讀取資料並設定 modal", async () => {
      const mockMcpServerData = {
        name: "My MCP",
        config: { command: "npx", args: ["-y", "server"] } as McpServerConfig,
      };
      const options = createOptions();
      options.mcpServerStore.typedNotes = [
        { id: "note-1", mcpServerId: "mcp-1" },
      ];
      (
        options.mcpServerStore as ReturnType<typeof createNoteStore> & {
          readMcpServer: ReturnType<typeof vi.fn>;
        }
      ).readMcpServer.mockResolvedValue(mockMcpServerData);

      const { handleNoteDoubleClick } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      await handleNoteDoubleClick({ noteId: "note-1", noteType: "mcpServer" });

      expect(options.mcpServerModal.value.visible).toBe(true);
      expect(options.mcpServerModal.value.mode).toBe("edit");
      expect(options.mcpServerModal.value.mcpServerId).toBe("mcp-1");
      expect(options.mcpServerModal.value.initialName).toBe("My MCP");
    });
  });

  describe("createNoteHandler", () => {
    it("沒有 typeMenu.position 時不應呼叫 createNote", () => {
      const options = createOptions();
      options.podStore.typeMenu.position = null;

      const { handleCreateSkillNote } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      handleCreateSkillNote("sk-1");

      expect(options.skillStore.createNote).not.toHaveBeenCalled();
    });

    it("有 typeMenu.position 時應呼叫 createNote", () => {
      const options = createOptions();
      options.podStore.typeMenu.position = { x: 100, y: 200 };

      const { handleCreateSkillNote } = useCanvasNoteHandlers(
        options as unknown as Parameters<typeof useCanvasNoteHandlers>[0],
      );

      handleCreateSkillNote("skill-1");

      expect(options.skillStore.createNote).toHaveBeenCalled();
    });
  });
});
