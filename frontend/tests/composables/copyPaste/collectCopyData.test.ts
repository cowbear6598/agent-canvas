import { describe, it, expect } from "vitest";
import {
  collectBoundNotesFromStore,
  collectBoundNotes,
  collectSelectedPods,
  collectRelatedConnections,
  createUnboundNoteCollector,
} from "@/composables/canvas/copyPaste/collectCopyData";
import type { SelectableElement } from "@/types";

describe("collectCopyData", () => {
  describe("collectBoundNotesFromStore", () => {
    it("只回傳 boundToPodId 符合的 note", () => {
      const store = {
        notes: [
          { id: "n1", boundToPodId: "pod-1", name: "Note 1" },
          { id: "n2", boundToPodId: "pod-2", name: "Note 2" },
          { id: "n3", boundToPodId: "pod-1", name: "Note 3" },
        ],
      };

      const result = collectBoundNotesFromStore("pod-1", store, (note) => note);

      expect(result).toHaveLength(2);
      expect(result.map((n) => n.id)).toEqual(["n1", "n3"]);
    });

    it("store 為空時應回傳空陣列", () => {
      const store = { notes: [] };

      const result = collectBoundNotesFromStore("pod-1", store, (note) => note);

      expect(result).toEqual([]);
    });
  });

  describe("collectSelectedPods", () => {
    it('selectedElements 中只處理 type === "pod" 的元素', () => {
      const pods = [
        {
          id: "pod-1",
          name: "Pod 1",
          color: "#fff",
          x: 0,
          y: 0,
          rotation: 0,
          skillIds: [],
          subAgentIds: [],
          repositoryId: null,
          commandId: null,
          provider: "claude" as const,
          providerConfig: { model: "opus" },
        },
      ];

      const selectedElements: SelectableElement[] = [
        { type: "pod", id: "pod-1" },
        { type: "skillNote", id: "note-1" },
      ];

      const result = collectSelectedPods(selectedElements, pods as any);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("pod-1");
    });

    it("Codex Pod 複製後 CopiedPod 應保留 provider=codex 與 providerConfig.model", () => {
      const pods = [
        {
          id: "pod-codex",
          name: "Codex Pod",
          x: 100,
          y: 200,
          rotation: 0,
          skillIds: [],
          subAgentIds: [],
          repositoryId: null,
          commandId: null,
          provider: "codex" as const,
          providerConfig: { model: "gpt-5.4" },
        },
      ];

      const selectedElements: SelectableElement[] = [
        { type: "pod", id: "pod-codex" },
      ];

      const result = collectSelectedPods(selectedElements, pods as any);

      expect(result).toHaveLength(1);
      expect(result[0]!.provider).toBe("codex");
      expect(result[0]!.providerConfig.model).toBe("gpt-5.4");
    });

    it("非預設 model 的 Claude Pod 複製後 CopiedPod 應保留正確 providerConfig.model", () => {
      const customModel = "claude-3-5-sonnet-20241022";
      const pods = [
        {
          id: "pod-custom",
          name: "Custom Model Pod",
          x: 50,
          y: 50,
          rotation: 0,
          skillIds: [],
          subAgentIds: [],
          repositoryId: null,
          commandId: null,
          provider: "claude" as const,
          providerConfig: { model: customModel },
        },
      ];

      const selectedElements: SelectableElement[] = [
        { type: "pod", id: "pod-custom" },
      ];

      const result = collectSelectedPods(selectedElements, pods as any);

      expect(result).toHaveLength(1);
      expect(result[0]!.provider).toBe("claude");
      expect(result[0]!.providerConfig.model).toBe(customModel);
    });

    it("同時選取 Claude Pod 與 Codex Pod，各自保留正確 provider 與 providerConfig", () => {
      const pods = [
        {
          id: "pod-claude",
          name: "Claude Pod",
          x: 0,
          y: 0,
          rotation: 0,
          skillIds: [],
          subAgentIds: [],
          repositoryId: null,
          commandId: null,
          provider: "claude" as const,
          providerConfig: { model: "opus" },
        },
        {
          id: "pod-codex",
          name: "Codex Pod",
          x: 200,
          y: 200,
          rotation: 0,
          skillIds: [],
          subAgentIds: [],
          repositoryId: null,
          commandId: null,
          provider: "codex" as const,
          providerConfig: { model: "gpt-5.4" },
        },
      ];

      const selectedElements: SelectableElement[] = [
        { type: "pod", id: "pod-claude" },
        { type: "pod", id: "pod-codex" },
      ];

      const result = collectSelectedPods(selectedElements, pods as any);

      expect(result).toHaveLength(2);
      const claudeResult = result.find((p) => p.id === "pod-claude");
      const codexResult = result.find((p) => p.id === "pod-codex");
      expect(claudeResult!.provider).toBe("claude");
      expect(claudeResult!.providerConfig.model).toBe("opus");
      expect(codexResult!.provider).toBe("codex");
      expect(codexResult!.providerConfig.model).toBe("gpt-5.4");
    });
  });

  describe("collectRelatedConnections", () => {
    const connections = [
      {
        id: "conn-1",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
        sourceAnchor: "bottom",
        targetAnchor: "top",
        triggerMode: "auto",
      },
      {
        id: "conn-2",
        sourcePodId: "pod-1",
        targetPodId: "pod-3",
        sourceAnchor: "right",
        targetAnchor: "left",
        triggerMode: "auto",
      },
    ];

    it("只複製兩端 Pod 都被選中的 Connection", () => {
      const selectedPodIds = new Set(["pod-1", "pod-2"]);

      const result = collectRelatedConnections(
        selectedPodIds,
        connections as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.sourcePodId).toBe("pod-1");
      expect(result[0]!.targetPodId).toBe("pod-2");
    });

    it("只有單端 Pod 被選中時不應複製該 Connection", () => {
      const selectedPodIds = new Set(["pod-1"]);

      const result = collectRelatedConnections(
        selectedPodIds,
        connections as any,
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("collectBoundNotes - mcpServerNote", () => {
    it("應收集 mcpServerNote 並用 boundToPodId 綁定", () => {
      const stores = {
        skillStore: { notes: [] },
        repositoryStore: { notes: [] },
        subAgentStore: { notes: [] },
        commandStore: { notes: [] },
        mcpServerStore: {
          notes: [
            {
              id: "mcp-note-1",
              mcpServerId: "mcp-1",
              name: "MCP Note",
              x: 10,
              y: 20,
              boundToPodId: "pod-1",
              originalPosition: null,
            },
            {
              id: "mcp-note-2",
              mcpServerId: "mcp-2",
              name: "MCP Note 2",
              x: 30,
              y: 40,
              boundToPodId: "pod-2",
              originalPosition: null,
            },
          ],
        },
      };

      const result = collectBoundNotes("pod-1", stores);

      expect(result.mcpServerNotes).toHaveLength(1);
      expect(result.mcpServerNotes[0]!.mcpServerId).toBe("mcp-1");
      expect(result.mcpServerNotes[0]!.boundToPodId).toBe("pod-1");
    });
  });

  describe("createUnboundNoteCollector", () => {
    it("note 不存在時應回傳 null", () => {
      const store = { notes: [] };
      const collector = createUnboundNoteCollector(store, (note) => note);

      const result = collector("non-existent-id");

      expect(result).toBeNull();
    });

    it("note 存在且未綁定時應回傳 mapFn 結果", () => {
      const note = { id: "note-1", boundToPodId: null, name: "Test Note" };
      const store = { notes: [note] };
      const collector = createUnboundNoteCollector(store, (n) => ({
        id: n.id,
        name: n.name,
      }));

      const result = collector("note-1");

      expect(result).toEqual({ id: "note-1", name: "Test Note" });
    });

    it("note 存在但已綁定時應回傳 null", () => {
      const note = { id: "note-1", boundToPodId: "pod-1", name: "Test Note" };
      const store = { notes: [note] };
      const collector = createUnboundNoteCollector(store, (n) => n);

      const result = collector("note-1");

      expect(result).toBeNull();
    });
  });
});
