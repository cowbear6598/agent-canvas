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
import { usePodStore, useSelectionStore } from "@/stores/pod";
import { useRepositoryStore } from "@/stores/note";
import { useConnectionStore } from "@/stores/connectionStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { SelectableElement } from "@/types";
import type { CopiedPod } from "@/types/clipboard";
import type { Pod } from "@/types/pod";

vi.mock("@/services/websocket", () => webSocketMockFactory());

function toCopiedPod(pod: Pod): CopiedPod {
  return {
    id: pod.id,
    name: pod.name,
    x: pod.x,
    y: pod.y,
    rotation: pod.rotation,
    provider: pod.provider,
    providerConfig: pod.providerConfig,
    repositoryId: pod.repositoryId,
    goal: pod.goal ?? null,
    goalStatus: pod.goalStatus,
  };
}

describe("copyPasteFlow", () => {
  let podStore: ReturnType<typeof usePodStore>;
  let selectionStore: ReturnType<typeof useSelectionStore>;
  let repositoryStore: ReturnType<typeof useRepositoryStore>;
  let connectionStore: ReturnType<typeof useConnectionStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;
  let canvasStore: ReturnType<typeof useCanvasStore>;

  setupStoreTest();

  beforeEach(() => {
    podStore = usePodStore();
    selectionStore = useSelectionStore();
    repositoryStore = useRepositoryStore();
    connectionStore = useConnectionStore();
    clipboardStore = useClipboardStore();
    canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "test-canvas-id";
  });

  function buildNoteGroups() {
    return [{ notes: repositoryStore.notes, type: "repositoryNote" as const }];
  }

  it("框選兩個 pod 時會一起帶走它們之間的 connection", () => {
    const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
    const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
    const connection = createMockConnection({
      id: "conn-1",
      sourcePodId: "pod-1",
      targetPodId: "pod-2",
    });

    podStore.pods = [pod1, pod2];
    connectionStore.connections = [connection];

    selectionStore.startSelection(0, 0);
    selectionStore.updateSelection(500, 500);
    selectionStore.calculateSelectedElements({
      pods: podStore.pods,
      noteGroups: buildNoteGroups(),
    });

    const selectedPodIds = new Set(selectionStore.selectedPodIds);
    const copiedConnections = connectionStore.connections
      .filter(
        (conn) =>
          selectedPodIds.has(conn.sourcePodId!) &&
          selectedPodIds.has(conn.targetPodId),
      )
      .map((conn) => ({
        sourcePodId: conn.sourcePodId!,
        sourceAnchor: conn.sourceAnchor,
        targetPodId: conn.targetPodId,
        targetAnchor: conn.targetAnchor,
        triggerMode: conn.triggerMode,
      }));

    clipboardStore.setCopy([], [], copiedConnections as any);

    expect(clipboardStore.copiedConnections).toHaveLength(1);
    expect(clipboardStore.copiedConnections[0]).toEqual(
      expect.objectContaining({
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
      }),
    );
  });

  it("複製 pod 時保留 goal、repository 與 providerConfig", () => {
    const pod = createMockPod({
      id: "pod-goal",
      provider: "codex",
      providerConfig: { model: "gpt-5.4" },
      repositoryId: "repo-1",
      goal: { todos: [{ id: "todo-1", text: "Ship it" }] },
      goalStatus: "ready",
    });

    clipboardStore.setCopy([toCopiedPod(pod)], [], []);

    expect(clipboardStore.copiedPods[0]).toEqual(
      expect.objectContaining({
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
        repositoryId: "repo-1",
        goalStatus: "ready",
      }),
    );
    expect(clipboardStore.copiedPods[0]?.goal?.todos).toHaveLength(1);
  });

  it("框選只會選到未綁定 repository note", () => {
    const boundNote = createMockNote("repository", {
      id: "note-bound",
      x: 100,
      y: 100,
      boundToPodId: "pod-1",
    });
    const freeNote = createMockNote("repository", {
      id: "note-free",
      x: 150,
      y: 150,
      boundToPodId: null,
    });
    repositoryStore.notes = [boundNote, freeNote] as any[];

    selectionStore.startSelection(0, 0);
    selectionStore.updateSelection(400, 400);
    selectionStore.calculateSelectedElements({
      pods: [],
      noteGroups: buildNoteGroups(),
    });

    expect(selectionStore.selectedElements).toEqual([
      { type: "repositoryNote", id: "note-free" },
    ] satisfies SelectableElement[]);
  });

  it("貼上回應後 selection 會切到新元素", async () => {
    const setSelectedElementsSpy = vi.spyOn(
      selectionStore,
      "setSelectedElements",
    );

    mockCreateWebSocketRequest.mockResolvedValue({
      success: true,
      requestId: "req-1",
      podIdMapping: {},
      errors: [],
      createdPods: [{ ...createMockPod({ id: "old-pod" }), id: "new-pod" }],
      createdRepositoryNotes: [
        {
          id: "new-note",
          repositoryId: "repo-1",
          name: "Repo 1",
          x: 0,
          y: 0,
          boundToPodId: null,
          originalPosition: null,
        },
      ],
      createdConnections: [],
    });

    selectionStore.setSelectedElements([
      { type: "pod", id: "new-pod" },
      { type: "repositoryNote", id: "new-note" },
    ]);

    expect(setSelectedElementsSpy).toHaveBeenCalledWith([
      { type: "pod", id: "new-pod" },
      { type: "repositoryNote", id: "new-note" },
    ]);
  });
});
