import { describe, it, expect } from "vitest";
import { setupStoreTest } from "../helpers/testSetup";
import { useClipboardStore } from "@/stores/clipboardStore";
import type {
  CopiedPod,
  CopiedRepositoryNote,
  CopiedSubAgentNote,
  CopiedCommandNote,
  CopiedMcpServerNote,
  CopiedConnection,
} from "@/types";

describe("clipboardStore", () => {
  setupStoreTest();

  describe("初始狀態", () => {
    it("所有 copied 陣列應為空", () => {
      const store = useClipboardStore();

      expect(store.copiedPods).toEqual([]);
      expect(store.copiedRepositoryNotes).toEqual([]);
      expect(store.copiedSubAgentNotes).toEqual([]);
      expect(store.copiedCommandNotes).toEqual([]);
      expect(store.copiedMcpServerNotes).toEqual([]);
      expect(store.copiedConnections).toEqual([]);
    });
  });

  describe("isEmpty getter", () => {
    it("全空時應為 true", () => {
      const store = useClipboardStore();

      expect(store.isEmpty).toBe(true);
    });

    it("有 copiedPods 時應為 false", () => {
      const store = useClipboardStore();
      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      store.setCopy([mockPod], [], [], [], [], []);

      expect(store.isEmpty).toBe(false);
    });

    it("有 copiedRepositoryNotes 時應為 false", () => {
      const store = useClipboardStore();
      const mockNote: CopiedRepositoryNote = {
        repositoryId: "repo-1",
        name: "Test Repository",
        x: 100,
        y: 200,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      store.setCopy([], [mockNote], [], [], [], []);

      expect(store.isEmpty).toBe(false);
    });

    it("有 copiedSubAgentNotes 時應為 false", () => {
      const store = useClipboardStore();
      const mockNote: CopiedSubAgentNote = {
        id: "note-1",
        subAgentId: "sub-agent-1",
        name: "Test SubAgent",
        x: 100,
        y: 200,
        boundToPodId: null,
        originalPosition: null,
      };

      store.setCopy([], [], [mockNote], [], [], []);

      expect(store.isEmpty).toBe(false);
    });

    it("有 copiedCommandNotes 時應為 false", () => {
      const store = useClipboardStore();
      const mockNote: CopiedCommandNote = {
        commandId: "command-1",
        name: "Test Command",
        x: 100,
        y: 200,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      store.setCopy([], [], [], [mockNote], [], []);

      expect(store.isEmpty).toBe(false);
    });

    it("有 copiedMcpServerNotes 時應為 false", () => {
      const store = useClipboardStore();
      const mockNote: CopiedMcpServerNote = {
        id: "note-1",
        mcpServerId: "mcp-server-1",
        name: "Test MCP Server",
        x: 100,
        y: 200,
        boundToPodId: null,
        originalPosition: null,
      };

      store.setCopy([], [], [], [], [mockNote], []);

      expect(store.isEmpty).toBe(false);
    });

    it("有 copiedConnections 時應為 false", () => {
      const store = useClipboardStore();
      const mockConnection: CopiedConnection = {
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
      };

      store.setCopy([], [], [], [], [], [mockConnection]);

      expect(store.isEmpty).toBe(false);
    });

    it("有多種類型的資料時應為 false", () => {
      const store = useClipboardStore();
      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };
      const mockConnection: CopiedConnection = {
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
      };

      store.setCopy([mockPod], [], [], [], [], [mockConnection]);

      expect(store.isEmpty).toBe(false);
    });
  });

  describe("setCopy", () => {
    it("應設定所有 6 個陣列", () => {
      const store = useClipboardStore();

      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      const mockRepositoryNote: CopiedRepositoryNote = {
        repositoryId: "repo-1",
        name: "Test Repository",
        x: 200,
        y: 300,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      const mockSubAgentNote: CopiedSubAgentNote = {
        id: "note-3",
        subAgentId: "sub-agent-1",
        name: "Test SubAgent",
        x: 250,
        y: 350,
        boundToPodId: null,
        originalPosition: null,
      };

      const mockCommandNote: CopiedCommandNote = {
        commandId: "command-1",
        name: "Test Command",
        x: 300,
        y: 400,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      const mockMcpServerNote: CopiedMcpServerNote = {
        id: "note-4",
        mcpServerId: "mcp-server-1",
        name: "Test MCP Server",
        x: 350,
        y: 450,
        boundToPodId: null,
        originalPosition: null,
      };

      const mockConnection: CopiedConnection = {
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
      };

      store.setCopy(
        [mockPod],
        [mockRepositoryNote],
        [mockSubAgentNote],
        [mockCommandNote],
        [mockMcpServerNote],
        [mockConnection],
      );

      expect(store.copiedPods).toEqual([mockPod]);
      expect(store.copiedRepositoryNotes).toEqual([mockRepositoryNote]);
      expect(store.copiedSubAgentNotes).toEqual([mockSubAgentNote]);
      expect(store.copiedCommandNotes).toEqual([mockCommandNote]);
      expect(store.copiedMcpServerNotes).toEqual([mockMcpServerNote]);
      expect(store.copiedConnections).toEqual([mockConnection]);
    });

    it("應能設定空陣列", () => {
      const store = useClipboardStore();

      store.setCopy([], [], [], [], [], []);

      expect(store.copiedPods).toEqual([]);
      expect(store.copiedRepositoryNotes).toEqual([]);
      expect(store.copiedSubAgentNotes).toEqual([]);
      expect(store.copiedCommandNotes).toEqual([]);
      expect(store.copiedMcpServerNotes).toEqual([]);
      expect(store.copiedConnections).toEqual([]);
    });

    it("應能覆蓋之前的資料", () => {
      const store = useClipboardStore();

      const mockPod1: CopiedPod = {
        id: "pod-1",
        name: "Test Pod 1",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      const mockPod2: CopiedPod = {
        id: "pod-2",
        name: "Test Pod 2",
        x: 300,
        y: 400,
        rotation: 45,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      store.setCopy([mockPod1], [], [], [], [], []);
      expect(store.copiedPods).toEqual([mockPod1]);

      store.setCopy([mockPod2], [], [], [], [], []);
      expect(store.copiedPods).toEqual([mockPod2]);
    });

    it("應能設定多個項目的陣列", () => {
      const store = useClipboardStore();

      const mockPods: CopiedPod[] = [
        {
          id: "pod-1",
          name: "Test Pod 1",
          x: 100,
          y: 200,
          rotation: 0,
          provider: "claude",
          providerConfig: { model: "opus" },
        },
        {
          id: "pod-2",
          name: "Test Pod 2",
          x: 300,
          y: 400,
          rotation: 45,
          provider: "claude",
          providerConfig: { model: "opus" },
        },
      ];

      store.setCopy(mockPods, [], [], [], [], []);

      expect(store.copiedPods).toHaveLength(2);
      expect(store.copiedPods).toEqual(mockPods);
    });
  });

  describe("clear", () => {
    it("應清空所有陣列", () => {
      const store = useClipboardStore();

      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      store.setCopy([mockPod], [], [], [], [], []);
      expect(store.copiedPods).toHaveLength(1);

      store.clear();

      expect(store.copiedPods).toEqual([]);
      expect(store.copiedRepositoryNotes).toEqual([]);
      expect(store.copiedSubAgentNotes).toEqual([]);
      expect(store.copiedCommandNotes).toEqual([]);
      expect(store.copiedMcpServerNotes).toEqual([]);
      expect(store.copiedConnections).toEqual([]);
    });

    it("應使 isEmpty 回傳 true", () => {
      const store = useClipboardStore();

      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      store.setCopy([mockPod], [], [], [], [], []);
      expect(store.isEmpty).toBe(false);

      store.clear();

      expect(store.isEmpty).toBe(true);
    });
  });

  describe("getCopiedData", () => {
    it("應回傳所有 6 個陣列的資料", () => {
      const store = useClipboardStore();

      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      const mockRepositoryNote: CopiedRepositoryNote = {
        repositoryId: "repo-1",
        name: "Test Repository",
        x: 200,
        y: 300,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      const mockSubAgentNote: CopiedSubAgentNote = {
        id: "note-3",
        subAgentId: "sub-agent-1",
        name: "Test SubAgent",
        x: 250,
        y: 350,
        boundToPodId: null,
        originalPosition: null,
      };

      const mockCommandNote: CopiedCommandNote = {
        commandId: "command-1",
        name: "Test Command",
        x: 300,
        y: 400,
        boundToOriginalPodId: null,
        originalPosition: null,
      };

      const mockMcpServerNote: CopiedMcpServerNote = {
        id: "note-4",
        mcpServerId: "mcp-server-1",
        name: "Test MCP Server",
        x: 350,
        y: 450,
        boundToPodId: null,
        originalPosition: null,
      };

      const mockConnection: CopiedConnection = {
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
      };

      store.setCopy(
        [mockPod],
        [mockRepositoryNote],
        [mockSubAgentNote],
        [mockCommandNote],
        [mockMcpServerNote],
        [mockConnection],
      );

      const result = store.getCopiedData();

      expect(result).toEqual({
        pods: [mockPod],
        repositoryNotes: [mockRepositoryNote],
        subAgentNotes: [mockSubAgentNote],
        commandNotes: [mockCommandNote],
        mcpServerNotes: [mockMcpServerNote],
        connections: [mockConnection],
      });
    });

    it("應回傳空陣列當沒有資料時", () => {
      const store = useClipboardStore();

      const result = store.getCopiedData();

      expect(result).toEqual({
        pods: [],
        repositoryNotes: [],
        subAgentNotes: [],
        commandNotes: [],
        mcpServerNotes: [],
        connections: [],
      });
    });

    it("應回傳當前 store 狀態的快照", () => {
      const store = useClipboardStore();

      const mockPod: CopiedPod = {
        id: "pod-1",
        name: "Test Pod",
        x: 100,
        y: 200,
        rotation: 0,
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      store.setCopy([mockPod], [], [], [], [], []);

      const result1 = store.getCopiedData();
      expect(result1.pods).toHaveLength(1);

      store.clear();

      const result2 = store.getCopiedData();
      expect(result2.pods).toHaveLength(0);
    });
  });
});
