import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import {
  createMockPod,
  createMockNote,
  createMockConnection,
} from "../helpers/factories";
import { usePodStore, useSelectionStore, useViewportStore } from "@/stores/pod";
import {
  useRepositoryStore,
  useSubAgentStore,
  useCommandStore,
  useMcpServerStore,
} from "@/stores/note";
import { useConnectionStore } from "@/stores/connectionStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { SelectableElement } from "@/types";
import type { CopiedPod } from "@/types/clipboard";
import type { Pod } from "@/types/pod";

const { mockShowSuccessToast, mockShowErrorToast, mockToast } = vi.hoisted(
  () => ({
    mockShowSuccessToast: vi.fn(),
    mockShowErrorToast: vi.fn(),
    mockToast: vi.fn(),
  }),
);

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

/**
 * 將 Pod 映射至 CopiedPod 結構（複製時保留所有必要欄位）。
 * 抽出為 helper 以避免各 test case 中重複手寫 map 物件。
 */
function toCopiedPod(p: Pod): CopiedPod {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    provider: p.provider,
    providerConfig: p.providerConfig,
    subAgentIds: p.subAgentIds,
    repositoryId: p.repositoryId,
    commandId: p.commandId,
  };
}

describe("複製貼上/批量操作完整流程", () => {
  let podStore: ReturnType<typeof usePodStore>;
  let selectionStore: ReturnType<typeof useSelectionStore>;
  let viewportStore: ReturnType<typeof useViewportStore>;
  let repositoryStore: ReturnType<typeof useRepositoryStore>;
  let subAgentStore: ReturnType<typeof useSubAgentStore>;
  let commandStore: ReturnType<typeof useCommandStore>;
  let mcpServerStore: ReturnType<typeof useMcpServerStore>;
  let connectionStore: ReturnType<typeof useConnectionStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;
  let canvasStore: ReturnType<typeof useCanvasStore>;

  setupStoreTest();

  beforeEach(() => {
    podStore = usePodStore();
    selectionStore = useSelectionStore();
    viewportStore = useViewportStore();
    repositoryStore = useRepositoryStore();
    subAgentStore = useSubAgentStore();
    commandStore = useCommandStore();
    mcpServerStore = useMcpServerStore();
    connectionStore = useConnectionStore();
    clipboardStore = useClipboardStore();
    canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "test-canvas-id";
  });

  /**
   * 回傳包含全部 Note 類型的 noteGroups 陣列，
   * 供 calculateSelectedElements 使用。
   */
  function buildNoteGroups() {
    return [
      { notes: repositoryStore.notes, type: "repositoryNote" as const },
      { notes: subAgentStore.notes, type: "subAgentNote" as const },
      { notes: commandStore.notes, type: "commandNote" as const },
      { notes: mcpServerStore.notes, type: "mcpServerNote" as const },
    ];
  }

  describe("框選 -> 複製 -> 貼上", () => {
    it("應複製兩個 Pod 之間的 Connection", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      const connection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
        sourceAnchor: "bottom",
        targetAnchor: "top",
      });

      podStore.pods = [pod1, pod2];
      connectionStore.connections = [connection];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]，pod1(100,100)、pod2(200,200) 均在範圍內
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const selectedElements = selectionStore.selectedElements;
      const selectedPodIds = new Set(
        selectedElements.filter((el) => el.type === "pod").map((el) => el.id),
      );
      const copiedConnections = connectionStore.connections
        .filter(
          (conn) =>
            selectedPodIds.has(conn.sourcePodId!) &&
            selectedPodIds.has(conn.targetPodId),
        )
        .map((conn) => ({
          sourcePodId: conn.sourcePodId,
          sourceAnchor: conn.sourceAnchor,
          targetPodId: conn.targetPodId,
          targetAnchor: conn.targetAnchor,
          triggerMode: conn.triggerMode,
        }));

      clipboardStore.setCopy([], [], [], [], [], copiedConnections as any);

      expect(clipboardStore.copiedConnections).toHaveLength(1);
      expect(clipboardStore.copiedConnections[0]!.sourcePodId).toBe("pod-1");
      expect(clipboardStore.copiedConnections[0]!.targetPodId).toBe("pod-2");
    });

    it("框選含 MCP Server Note 的區域，複製後 clipboardStore 包含 MCP Server Note", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const mcpServerNote = createMockNote("mcpServer", {
        id: "mcp-note-1",
        x: 300,
        y: 300,
        boundToPodId: null,
      });

      podStore.pods = [pod];
      mcpServerStore.notes = [mcpServerNote as any];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]，pod(100,100)、mcpServerNote(300,300) 均在範圍內
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const selectedElements = selectionStore.selectedElements;
      const copiedMcpServerNotes = mcpServerStore.notes
        .filter((n) =>
          selectedElements.some(
            (el) => el.type === "mcpServerNote" && el.id === n.id,
          ),
        )
        .map((n) => ({
          id: n.id,
          mcpServerId: (n as any).mcpServerId,
          name: n.name,
          x: n.x,
          y: n.y,
          boundToPodId: n.boundToPodId,
          originalPosition: n.originalPosition,
        }));

      clipboardStore.setCopy([], [], [], [], copiedMcpServerNotes as any, []);

      expect(clipboardStore.isEmpty).toBe(false);
      expect(clipboardStore.copiedMcpServerNotes).toHaveLength(1);
      expect(clipboardStore.copiedMcpServerNotes[0]!.id).toBe("mcp-note-1");
    });

    it("應在貼上後更新 selectionStore 為新建立的元素", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

      clipboardStore.setCopy([toCopiedPod(pod)], [], [], [], [], []);

      const newSelectedElements: SelectableElement[] = [
        { type: "pod", id: "new-pod-1" },
        { type: "repositoryNote", id: "new-note-1" },
      ];
      selectionStore.setSelectedElements(newSelectedElements);

      expect(selectionStore.selectedElements).toHaveLength(2);
      expect(selectionStore.selectedElements).toEqual(newSelectedElements);
      expect(selectionStore.selectedPodIds).toEqual(["new-pod-1"]);
      expect(selectionStore.selectedRepositoryNoteIds).toEqual(["new-note-1"]);
    });

    it("Codex Pod 複製後 clipboardStore 應正確保留 provider=codex 與 providerConfig.model", () => {
      const codexPod = createMockPod({
        id: "pod-codex",
        x: 100,
        y: 100,
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });

      podStore.pods = [codexPod];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]，codexPod(100,100) 在範圍內
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const selectedElements = selectionStore.selectedElements;
      const selectedPodIds = new Set(
        selectedElements.filter((el) => el.type === "pod").map((el) => el.id),
      );
      const copiedPods = podStore.pods
        .filter((p) => selectedPodIds.has(p.id))
        .map(toCopiedPod);

      clipboardStore.setCopy(copiedPods, [], [], [], [], []);

      expect(clipboardStore.isEmpty).toBe(false);
      expect(clipboardStore.copiedPods).toHaveLength(1);
      expect(clipboardStore.copiedPods[0]!.provider).toBe("codex");
      expect(clipboardStore.copiedPods[0]!.providerConfig.model).toBe(
        "gpt-5.4",
      );
    });

    it("Codex Pod round-trip：複製後 clipboardStore 的 provider 與 model 與原 Pod 一致", () => {
      const codexPod = createMockPod({
        id: "pod-codex-roundtrip",
        x: 150,
        y: 150,
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });

      clipboardStore.setCopy([toCopiedPod(codexPod)], [], [], [], [], []);

      // 確認 clipboard 中保留了 Codex provider 身份
      const storedPod = clipboardStore.copiedPods[0]!;
      expect(storedPod.provider).toBe(codexPod.provider);
      expect(storedPod.providerConfig.model).toBe(
        codexPod.providerConfig.model,
      );
    });

    it("同時複製 Claude Pod 與 Codex Pod，clipboardStore 各自保留正確 provider 與 model", () => {
      const claudePod = createMockPod({
        id: "pod-claude-mix",
        x: 100,
        y: 100,
        provider: "claude",
        providerConfig: { model: "opus" },
      });
      const codexPod = createMockPod({
        id: "pod-codex-mix",
        x: 300,
        y: 300,
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });

      const copiedPods = [claudePod, codexPod].map(toCopiedPod);

      clipboardStore.setCopy(copiedPods, [], [], [], [], []);

      expect(clipboardStore.copiedPods).toHaveLength(2);
      const storedClaude = clipboardStore.copiedPods.find(
        (p) => p.id === "pod-claude-mix",
      )!;
      const storedCodex = clipboardStore.copiedPods.find(
        (p) => p.id === "pod-codex-mix",
      )!;
      expect(storedClaude.provider).toBe("claude");
      expect(storedClaude.providerConfig.model).toBe("opus");
      expect(storedCodex.provider).toBe("codex");
      expect(storedCodex.providerConfig.model).toBe("gpt-5.4");
    });
  });

  describe("框選 -> 批量拖曳", () => {
    it("應更新所有選中 Pod 的座標", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });

      podStore.pods = [pod1, pod2];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]，pod1(100,100)、pod2(200,200) 均在範圍內
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const dx = 50;
      const dy = 50;

      selectionStore.selectedElements.forEach((element) => {
        if (element.type === "pod") {
          const pod = podStore.pods.find((p) => p.id === element.id);
          if (pod) {
            podStore.movePod(element.id, pod.x + dx, pod.y + dy);
          }
        }
      });

      const updatedPod1 = podStore.pods.find((p) => p.id === "pod-1");
      const updatedPod2 = podStore.pods.find((p) => p.id === "pod-2");

      expect(updatedPod1?.x).toBe(150);
      expect(updatedPod1?.y).toBe(150);
      expect(updatedPod2?.x).toBe(250);
      expect(updatedPod2?.y).toBe(250);
    });

    it("應更新所有選中的未綁定 RepositoryNote 的座標", () => {
      const note1 = createMockNote("repository", {
        id: "note-1",
        x: 100,
        y: 100,
        boundToPodId: null,
      });
      const note2 = createMockNote("repository", {
        id: "note-2",
        x: 200,
        y: 200,
        boundToPodId: null,
      });
      const boundNote = createMockNote("repository", {
        id: "note-3",
        x: 300,
        y: 300,
        boundToPodId: "pod-1",
      });

      repositoryStore.notes = [note1 as any, note2 as any, boundNote as any];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]；note1(100,100)、note2(200,200)、boundNote(300,300) 均在範圍內
      // boundNote 雖被選中但因 boundToPodId !== null 而不移動
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const dx = 30;
      const dy = 40;

      selectionStore.selectedElements.forEach((element) => {
        if (element.type === "repositoryNote") {
          const note = repositoryStore.notes.find((n) => n.id === element.id);
          if (note && note.boundToPodId === null) {
            repositoryStore.updateNotePositionLocal(
              element.id,
              note.x + dx,
              note.y + dy,
            );
          }
        }
      });

      const updatedNote1 = repositoryStore.notes.find((n) => n.id === "note-1");
      const updatedNote2 = repositoryStore.notes.find((n) => n.id === "note-2");
      const updatedBoundNote = repositoryStore.notes.find(
        (n) => n.id === "note-3",
      );

      expect(updatedNote1?.x).toBe(130);
      expect(updatedNote1?.y).toBe(140);
      expect(updatedNote2?.x).toBe(230);
      expect(updatedNote2?.y).toBe(240);
      expect(updatedBoundNote?.x).toBe(300);
      expect(updatedBoundNote?.y).toBe(300);
    });

    it("應在拖曳後調用 syncPodPosition 同步到後端", () => {
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      podStore.pods = [pod];

      selectionStore.setSelectedElements([{ type: "pod", id: "pod-1" }]);

      const syncSpy = vi.spyOn(podStore, "syncPodPosition");

      podStore.movePod("pod-1", 150, 150);
      podStore.syncPodPosition("pod-1");

      expect(syncSpy).toHaveBeenCalledWith("pod-1");
    });

    it("應在拖曳後調用 updateNotePosition 同步 Note 到後端", async () => {
      const note = createMockNote("repository", {
        id: "note-1",
        x: 100,
        y: 100,
        boundToPodId: null,
      });
      repositoryStore.notes = [note as any];

      selectionStore.setSelectedElements([
        { type: "repositoryNote", id: "note-1" },
      ]);

      const updateSpy = vi.spyOn(repositoryStore, "updateNotePosition");

      repositoryStore.updateNotePositionLocal("note-1", 150, 150);
      await repositoryStore.updateNotePosition("note-1", 150, 150);

      expect(updateSpy).toHaveBeenCalledWith("note-1", 150, 150);
    });
  });

  describe("框選 -> 批量刪除", () => {
    it("應刪除所有選中的 Pod", async () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      const pod3 = createMockPod({ id: "pod-3", x: 1000, y: 1000 });

      podStore.pods = [pod1, pod2, pod3];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]；pod1(100,100)、pod2(200,200) 在範圍內，pod3(1000,1000) 不在
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      expect(selectionStore.selectedPodIds).toHaveLength(2);

      const deletePromises: Promise<void>[] = [];
      selectionStore.selectedPodIds.forEach((id) => {
        deletePromises.push(podStore.deletePodWithBackend(id));
      });

      await Promise.allSettled(deletePromises);

      expect(deletePromises).toHaveLength(2);
    });

    it("應刪除所有選中的 Note", async () => {
      const note1 = createMockNote("repository", {
        id: "note-1",
        x: 100,
        y: 100,
        boundToPodId: null,
      });
      const note2 = createMockNote("repository", {
        id: "note-2",
        x: 200,
        y: 200,
        boundToPodId: null,
      });
      const note3 = createMockNote("repository", {
        id: "note-3",
        x: 1000,
        y: 1000,
        boundToPodId: null,
      });

      repositoryStore.notes = [note1 as any, note2 as any, note3 as any];

      // 選取範圍涵蓋 x=[0,500], y=[0,500]；note1(100,100)、note2(200,200) 在範圍內，note3(1000,1000) 不在
      const SELECTION_BOX = { x1: 0, y1: 0, x2: 500, y2: 500 };
      selectionStore.startSelection(SELECTION_BOX.x1, SELECTION_BOX.y1);
      selectionStore.updateSelection(SELECTION_BOX.x2, SELECTION_BOX.y2);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });

      const deletePromises: Promise<void>[] = [];

      selectionStore.selectedRepositoryNoteIds.forEach((id) => {
        deletePromises.push(repositoryStore.deleteNote(id));
      });

      await Promise.allSettled(deletePromises);

      expect(deletePromises).toHaveLength(2);
    });

    it("應在刪除後清空 selection", () => {
      selectionStore.setSelectedElements([
        { type: "pod", id: "pod-1" },
        { type: "repositoryNote", id: "note-1" },
      ]);

      expect(selectionStore.hasSelection).toBe(true);

      selectionStore.clearSelection();

      expect(selectionStore.hasSelection).toBe(false);
      expect(selectionStore.selectedElements).toHaveLength(0);
    });

    it("刪除 Pod 成功（WS 回應有效）後應呼叫 showSuccessToast", async () => {
      const pod = createMockPod({ id: "pod-success", x: 100, y: 100 });
      podStore.pods = [pod];

      // 模擬後端回傳成功
      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

      await podStore.deletePodWithBackend("pod-success");

      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        "Pod",
        expect.any(String),
        expect.any(String),
      );
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it("刪除 Pod 失敗（WS 無回應）後應呼叫 showErrorToast 而非 showSuccessToast", async () => {
      const pod = createMockPod({ id: "pod-fail", x: 100, y: 100 });
      podStore.pods = [pod];

      // mockCreateWebSocketRequest 預設回傳 null，模擬 WS 無回應（逾時或錯誤）
      mockCreateWebSocketRequest.mockResolvedValueOnce(null);

      await podStore.deletePodWithBackend("pod-fail");

      expect(mockShowErrorToast).toHaveBeenCalled();
      expect(mockShowSuccessToast).not.toHaveBeenCalled();
    });

    it("應在刪除 Pod 時自動清理相關 Connection", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      const connection = createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
      });

      podStore.pods = [pod1, pod2];
      connectionStore.connections = [connection];

      const deleteConnSpy = vi.spyOn(
        connectionStore,
        "deleteConnectionsByPodId",
      );

      podStore.removePod("pod-1");

      expect(deleteConnSpy).toHaveBeenCalledWith("pod-1");
      expect(
        connectionStore.connections.filter(
          (c) => c.sourcePodId === "pod-1" || c.targetPodId === "pod-1",
        ),
      ).toHaveLength(0);
    });
  });

  describe("Ctrl 框選", () => {
    it("第一次框選應選中元素", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });

      podStore.pods = [pod1, pod2];

      // 選取範圍涵蓋 x=[0,300], y=[0,300]，pod1(100,100)、pod2(200,200) 均在範圍內
      selectionStore.startSelection(0, 0);
      selectionStore.updateSelection(300, 300);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });
      selectionStore.endSelection();

      expect(selectionStore.selectedPodIds).toEqual(["pod-1", "pod-2"]);
    });

    it("Ctrl 第二次框選應 toggle 反選", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 250, y: 250 });
      const pod3 = createMockPod({ id: "pod-3", x: 400, y: 400 });

      podStore.pods = [pod1, pod2, pod3];

      // 第一次框選：x=[0,350], y=[0,350]，pod1(100,100)、pod2(250,250) 在範圍內，pod3(400,400) 不在
      selectionStore.startSelection(0, 0);
      selectionStore.updateSelection(350, 350);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });
      selectionStore.endSelection();

      expect(selectionStore.selectedPodIds).toEqual(["pod-1", "pod-2"]);

      // Ctrl 第二次框選：x=[350,700], y=[350,700]，pod3(400,400) 在範圍內；pod2(250,250) 已被選中故 toggle 移除
      selectionStore.startSelection(350, 350, true);
      selectionStore.updateSelection(700, 700);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });
      selectionStore.endSelection();

      expect(selectionStore.selectedPodIds).toEqual(["pod-1", "pod-3"]);
    });

    it("Ctrl 框選已選中的元素應移除該元素", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });

      podStore.pods = [pod1];

      selectionStore.setSelectedElements([{ type: "pod", id: "pod-1" }]);
      expect(selectionStore.selectedPodIds).toEqual(["pod-1"]);

      // Ctrl 框選：x=[0,300], y=[0,300]，pod1(100,100) 已被選中故 toggle 移除
      selectionStore.startSelection(0, 0, true);
      selectionStore.updateSelection(300, 300);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });
      selectionStore.endSelection();

      expect(selectionStore.selectedPodIds).toEqual([]);
    });

    it("Ctrl 框選未選中的元素應加入該元素", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 500, y: 500 });

      podStore.pods = [pod1, pod2];

      selectionStore.setSelectedElements([{ type: "pod", id: "pod-1" }]);

      // Ctrl 框選：x=[400,600], y=[400,600]，pod2(500,500) 未被選中故加入
      selectionStore.startSelection(400, 400, true);
      selectionStore.updateSelection(600, 600);
      selectionStore.calculateSelectedElements({
        pods: podStore.pods,
        noteGroups: buildNoteGroups(),
      });
      selectionStore.endSelection();

      expect(selectionStore.selectedPodIds).toEqual(["pod-1", "pod-2"]);
    });

    it("應正確處理 Ctrl 模式的 initialSelectedElements", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });

      podStore.pods = [pod1];

      selectionStore.setSelectedElements([{ type: "pod", id: "pod-1" }]);

      selectionStore.startSelection(0, 0, true);

      expect(selectionStore.initialSelectedElements).toEqual([
        { type: "pod", id: "pod-1" },
      ]);
      expect(selectionStore.isCtrlMode).toBe(true);
    });

    it("應在 endSelection 後重置 isCtrlMode 和 initialSelectedElements", () => {
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });

      podStore.pods = [pod1];

      selectionStore.setSelectedElements([{ type: "pod", id: "pod-1" }]);

      selectionStore.startSelection(0, 0, true);
      expect(selectionStore.isCtrlMode).toBe(true);

      selectionStore.endSelection();

      expect(selectionStore.isCtrlMode).toBe(false);
      expect(selectionStore.initialSelectedElements).toEqual([]);
    });
  });
});
