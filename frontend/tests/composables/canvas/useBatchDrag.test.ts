import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod, createMockNote } from "../../helpers/factories";
import { useBatchDrag } from "@/composables/canvas/useBatchDrag";
import type { Pod, RepositoryNote } from "@/types";

const mockPodStore = {
  pods: [] as Pod[],
  movePod: vi.fn((podId: string, x: number, y: number) => {
    const pod = mockPodStore.pods.find((p) => p.id === podId);
    if (pod) {
      pod.x = x;
      pod.y = y;
    }
  }),
  syncPodPosition: vi.fn(),
};

const mockViewportStore = {
  zoom: 1,
};

const mockSelectionStore = {
  hasSelection: false,
  selectedElements: [] as Array<{ type: string; id: string }>,
  isElementSelected: vi.fn((type: string, id: string): boolean => {
    return mockSelectionStore.selectedElements.some(
      (el) => el.type === type && el.id === id,
    );
  }),
};

const mockRepositoryStore = {
  notes: [] as RepositoryNote[],
  updateNotePositionLocal: vi.fn((noteId: string, x: number, y: number) => {
    const note = mockRepositoryStore.notes.find((n) => n.id === noteId);
    if (note) {
      note.x = x;
      note.y = y;
    }
  }),
  updateNotePosition: vi.fn(),
};

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    podStore: mockPodStore,
    viewportStore: mockViewportStore,
    selectionStore: mockSelectionStore,
    repositoryStore: mockRepositoryStore,
  }),
}));

describe("useBatchDrag", () => {
  setupStoreTest();

  beforeEach(() => {
    mockPodStore.pods = [];
    mockPodStore.movePod.mockClear();
    mockPodStore.syncPodPosition.mockClear();
    mockViewportStore.zoom = 1;
    mockSelectionStore.hasSelection = false;
    mockSelectionStore.selectedElements = [];
    mockSelectionStore.isElementSelected.mockClear();
    mockRepositoryStore.notes = [];
    mockRepositoryStore.updateNotePositionLocal.mockClear();
    mockRepositoryStore.updateNotePosition.mockClear();
  });

  afterEach(() => {
    document.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("拖曳 pod 會更新座標並同步到後端", async () => {
    const { startBatchDrag } = useBatchDrag();
    const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
    mockPodStore.pods = [pod];
    mockSelectionStore.hasSelection = true;
    mockSelectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];

    startBatchDrag(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );

    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 150, clientY: 150 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPodStore.movePod).toHaveBeenCalledWith("pod-1", 150, 150);
    expect(mockPodStore.syncPodPosition).toHaveBeenCalledWith("pod-1");
  });

  it("拖曳 repository note 會更新本地與後端位置", async () => {
    const { startBatchDrag } = useBatchDrag();
    const note = createMockNote("repository", {
      id: "note-1",
      x: 100,
      y: 100,
      boundToPodId: null,
    }) as RepositoryNote;
    mockRepositoryStore.notes = [note];
    mockSelectionStore.hasSelection = true;
    mockSelectionStore.selectedElements = [
      { type: "repositoryNote", id: "note-1" },
    ];

    startBatchDrag(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      }),
    );

    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockRepositoryStore.updateNotePositionLocal).toHaveBeenCalledWith(
      "note-1",
      150,
      150,
    );
    expect(mockRepositoryStore.updateNotePosition).toHaveBeenCalledWith(
      "note-1",
      150,
      150,
    );
  });

  it("已綁定的 repository note 不應移動", () => {
    const { startBatchDrag } = useBatchDrag();
    const note = createMockNote("repository", {
      id: "note-1",
      x: 100,
      y: 100,
      boundToPodId: "pod-1",
    }) as RepositoryNote;
    mockRepositoryStore.notes = [note];
    mockSelectionStore.hasSelection = true;
    mockSelectionStore.selectedElements = [
      { type: "repositoryNote", id: "note-1" },
    ];

    startBatchDrag(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 50, clientY: 50 }),
    );

    expect(mockRepositoryStore.updateNotePositionLocal).not.toHaveBeenCalled();
  });

  it("isElementSelected 只檢查 pod 與 repository note", () => {
    const { isElementSelected } = useBatchDrag();
    mockSelectionStore.selectedElements = [
      { type: "pod", id: "pod-1" },
      { type: "repositoryNote", id: "note-1" },
    ];

    expect(isElementSelected("pod", "pod-1")).toBe(true);
    expect(isElementSelected("repositoryNote", "note-1")).toBe(true);
    expect(isElementSelected("pod", "pod-2")).toBe(false);
  });
});
