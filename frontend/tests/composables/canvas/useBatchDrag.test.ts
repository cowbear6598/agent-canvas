import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod, createMockNote } from "../../helpers/factories";
import { useBatchDrag } from "@/composables/canvas/useBatchDrag";
import type { Pod } from "@/types";
import type { RepositoryNote, SubAgentNote, CommandNote } from "@/types";

// Mock useCanvasContext
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

const mockSubAgentStore = {
  notes: [] as SubAgentNote[],
  updateNotePositionLocal: vi.fn((noteId: string, x: number, y: number) => {
    const note = mockSubAgentStore.notes.find((n) => n.id === noteId);
    if (note) {
      note.x = x;
      note.y = y;
    }
  }),
  updateNotePosition: vi.fn(),
};

const mockCommandStore = {
  notes: [] as CommandNote[],
  updateNotePositionLocal: vi.fn((noteId: string, x: number, y: number) => {
    const note = mockCommandStore.notes.find((n) => n.id === noteId);
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
    subAgentStore: mockSubAgentStore,
    commandStore: mockCommandStore,
  }),
}));

describe("useBatchDrag", () => {
  setupStoreTest();

  beforeEach(() => {
    // 重置 mock stores
    mockPodStore.pods = [];
    mockPodStore.movePod.mockClear();
    mockPodStore.syncPodPosition.mockClear();
    mockViewportStore.zoom = 1;
    mockSelectionStore.hasSelection = false;
    mockSelectionStore.selectedElements = [];
    mockRepositoryStore.notes = [];
    mockRepositoryStore.updateNotePositionLocal.mockClear();
    mockRepositoryStore.updateNotePosition.mockClear();
    mockSubAgentStore.notes = [];
    mockSubAgentStore.updateNotePositionLocal.mockClear();
    mockSubAgentStore.updateNotePosition.mockClear();
    mockCommandStore.notes = [];
    mockCommandStore.updateNotePositionLocal.mockClear();
    mockCommandStore.updateNotePosition.mockClear();
  });

  afterEach(() => {
    // 觸發 mouseup 清理事件監聽器
    const upEvent = new MouseEvent("mouseup");
    document.dispatchEvent(upEvent);
  });

  describe("startBatchDrag", () => {
    it("非左鍵不啟動，回傳 false", () => {
      const { startBatchDrag, isBatchDragging } = useBatchDrag();
      const event = new MouseEvent("mousedown", { button: 1 }); // 右鍵

      const result = startBatchDrag(event);

      expect(result).toBe(false);
      expect(isBatchDragging.value).toBe(false);
    });

    it("無選取元素時不啟動，回傳 false", () => {
      const { startBatchDrag, isBatchDragging } = useBatchDrag();
      mockSelectionStore.hasSelection = false;
      const event = new MouseEvent("mousedown", { button: 0 });

      const result = startBatchDrag(event);

      expect(result).toBe(false);
      expect(isBatchDragging.value).toBe(false);
    });

    it("啟動後 isBatchDragging 為 true，回傳 true", () => {
      const { startBatchDrag, isBatchDragging } = useBatchDrag();
      mockSelectionStore.hasSelection = true;
      const event = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 200,
      });

      const result = startBatchDrag(event);

      expect(result).toBe(true);
      expect(isBatchDragging.value).toBe(true);
    });
  });

  describe("拖曳過程", () => {
    it("移動所有選中的 Pod（呼叫 podStore.movePod）", () => {
      const { startBatchDrag } = useBatchDrag();
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      mockPodStore.pods = [pod1, pod2];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
      ];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 150,
        clientY: 150,
      });
      document.dispatchEvent(moveEvent);

      expect(mockPodStore.movePod).toHaveBeenCalledWith("pod-1", 150, 150);
      expect(mockPodStore.movePod).toHaveBeenCalledWith("pod-2", 250, 250);
    });

    it("delta 計算考慮 viewportStore.zoom", () => {
      const { startBatchDrag } = useBatchDrag();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      mockPodStore.pods = [pod];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];
      mockViewportStore.zoom = 2;

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 200,
        clientY: 200,
      });
      document.dispatchEvent(moveEvent);

      // delta = (200 - 100) / 2 = 50
      expect(mockPodStore.movePod).toHaveBeenCalledWith("pod-1", 150, 150);
    });

    it("多次移動應累加增量（增量移動）", () => {
      const { startBatchDrag } = useBatchDrag();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      mockPodStore.pods = [pod];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      startBatchDrag(startEvent);

      // 第一次移動（delta = (50 - 0) / 1 = 50）
      const moveEvent1 = new MouseEvent("mousemove", {
        clientX: 50,
        clientY: 50,
      });
      document.dispatchEvent(moveEvent1);
      // pod 從 (100, 100) 移到 (150, 150)

      // 第二次移動（delta = (100 - 50) / 1 = 50）
      const moveEvent2 = new MouseEvent("mousemove", {
        clientX: 100,
        clientY: 100,
      });
      document.dispatchEvent(moveEvent2);
      // pod 從 (150, 150) 移到 (200, 200)

      expect(mockPodStore.movePod).toHaveBeenNthCalledWith(
        2,
        "pod-1",
        200,
        200,
      );
    });

    it("移動所有類型的 Note", () => {
      const { startBatchDrag } = useBatchDrag();
      const repositoryNote = createMockNote("repository", {
        id: "note-1",
        x: 100,
        y: 100,
        boundToPodId: null,
      });
      const subAgentNote = createMockNote("subAgent", {
        id: "note-2",
        x: 200,
        y: 200,
        boundToPodId: null,
      });
      const commandNote = createMockNote("command", {
        id: "note-3",
        x: 300,
        y: 300,
        boundToPodId: null,
      });
      mockRepositoryStore.notes = [repositoryNote as RepositoryNote];
      mockSubAgentStore.notes = [subAgentNote as SubAgentNote];
      mockCommandStore.notes = [commandNote as CommandNote];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [
        { type: "repositoryNote", id: "note-1" },
        { type: "subAgentNote", id: "note-2" },
        { type: "commandNote", id: "note-3" },
      ];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 50,
        clientY: 50,
      });
      document.dispatchEvent(moveEvent);

      expect(mockRepositoryStore.updateNotePositionLocal).toHaveBeenCalledWith(
        "note-1",
        150,
        150,
      );
      expect(mockSubAgentStore.updateNotePositionLocal).toHaveBeenCalledWith(
        "note-2",
        250,
        250,
      );
      expect(mockCommandStore.updateNotePositionLocal).toHaveBeenCalledWith(
        "note-3",
        350,
        350,
      );
    });
  });

  describe("結束拖曳", () => {
    it("isBatchDragging 設為 false", async () => {
      const { startBatchDrag, isBatchDragging } = useBatchDrag();
      mockSelectionStore.hasSelection = true;
      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(isBatchDragging.value).toBe(false);
    });

    it("同步所有移動的 Pod（syncPodPosition）", async () => {
      const { startBatchDrag } = useBatchDrag();
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      mockPodStore.pods = [pod1, pod2];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
      ];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 150,
        clientY: 150,
      });
      document.dispatchEvent(moveEvent);

      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockPodStore.syncPodPosition).toHaveBeenCalledWith("pod-1");
      expect(mockPodStore.syncPodPosition).toHaveBeenCalledWith("pod-2");
    });

    it("只同步有移動過的元素", async () => {
      const { startBatchDrag } = useBatchDrag();
      const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
      const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
      mockPodStore.pods = [pod1, pod2];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 150,
        clientY: 150,
      });
      document.dispatchEvent(moveEvent);

      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockPodStore.syncPodPosition).toHaveBeenCalledWith("pod-1");
      expect(mockPodStore.syncPodPosition).not.toHaveBeenCalledWith("pod-2");
    });

    it("同步所有類型的 Note", async () => {
      const { startBatchDrag } = useBatchDrag();
      const repositoryNote = createMockNote("repository", {
        id: "note-1",
        x: 100,
        y: 100,
        boundToPodId: null,
      });
      const subAgentNote = createMockNote("subAgent", {
        id: "note-2",
        x: 200,
        y: 200,
        boundToPodId: null,
      });
      const commandNote = createMockNote("command", {
        id: "note-3",
        x: 300,
        y: 300,
        boundToPodId: null,
      });
      mockRepositoryStore.notes = [repositoryNote as RepositoryNote];
      mockSubAgentStore.notes = [subAgentNote as SubAgentNote];
      mockCommandStore.notes = [commandNote as CommandNote];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [
        { type: "repositoryNote", id: "note-1" },
        { type: "subAgentNote", id: "note-2" },
        { type: "commandNote", id: "note-3" },
      ];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 50,
        clientY: 50,
      });
      document.dispatchEvent(moveEvent);

      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRepositoryStore.updateNotePosition).toHaveBeenCalledWith(
        "note-1",
        150,
        150,
      );
      expect(mockSubAgentStore.updateNotePosition).toHaveBeenCalledWith(
        "note-2",
        250,
        250,
      );
      expect(mockCommandStore.updateNotePosition).toHaveBeenCalledWith(
        "note-3",
        350,
        350,
      );
    });
  });

  describe("isElementSelected", () => {
    it("委派到 selectionStore.selectedElements 檢查（Pod）", () => {
      const { isElementSelected } = useBatchDrag();
      mockSelectionStore.selectedElements = [
        { type: "pod", id: "pod-1" },
        { type: "pod", id: "pod-2" },
      ];

      expect(isElementSelected("pod", "pod-1")).toBe(true);
      expect(isElementSelected("pod", "pod-3")).toBe(false);
    });

    it("檢查所有 Note 類型", () => {
      const { isElementSelected } = useBatchDrag();
      mockSelectionStore.selectedElements = [
        { type: "repositoryNote", id: "note-1" },
        { type: "subAgentNote", id: "note-2" },
        { type: "commandNote", id: "note-3" },
      ];

      expect(isElementSelected("repositoryNote", "note-1")).toBe(true);
      expect(isElementSelected("subAgentNote", "note-2")).toBe(true);
      expect(isElementSelected("commandNote", "note-3")).toBe(true);
    });
  });

  describe("元素不存在時的處理", () => {
    it("選中的 Pod 不存在時不應報錯", () => {
      const { startBatchDrag } = useBatchDrag();
      mockPodStore.pods = [];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [
        { type: "pod", id: "non-existent" },
      ];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const moveEvent = new MouseEvent("mousemove", {
        clientX: 150,
        clientY: 150,
      });

      expect(() => document.dispatchEvent(moveEvent)).not.toThrow();
      expect(mockPodStore.movePod).not.toHaveBeenCalled();
    });
  });

  describe("無移動時的處理", () => {
    it("startBatchDrag 後立即 mouseup 不應同步", async () => {
      const { startBatchDrag } = useBatchDrag();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      mockPodStore.pods = [pod];
      mockSelectionStore.hasSelection = true;
      mockSelectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];

      const startEvent = new MouseEvent("mousedown", {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      startBatchDrag(startEvent);

      const upEvent = new MouseEvent("mouseup");
      document.dispatchEvent(upEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockPodStore.syncPodPosition).not.toHaveBeenCalled();
    });
  });
});
