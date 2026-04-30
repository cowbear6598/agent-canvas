import { describe, it, expect } from "vitest";
import { setupStoreTest } from "../helpers/testSetup";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import { createMockPod, createMockNote } from "../helpers/factories";
import type { SelectableElement } from "@/types";

describe("selectionStore", () => {
  setupStoreTest();

  describe("getters", () => {
    describe("selectedRepositoryNoteIds", () => {
      it("應篩選出 type 為 repositoryNote 的 id", () => {
        const store = useSelectionStore();
        store.selectedElements = [
          { type: "repositoryNote", id: "note-1" },
          { type: "pod", id: "pod-1" },
          { type: "repositoryNote", id: "note-2" },
        ];

        expect(store.selectedRepositoryNoteIds).toEqual(["note-1", "note-2"]);
      });
    });

    describe("selectedCommandNoteIds", () => {
      it("應篩選出 type 為 commandNote 的 id", () => {
        const store = useSelectionStore();
        store.selectedElements = [
          { type: "commandNote", id: "note-1" },
          { type: "pod", id: "pod-1" },
          { type: "commandNote", id: "note-2" },
        ];

        expect(store.selectedCommandNoteIds).toEqual(["note-1", "note-2"]);
      });
    });

    describe("hasSelection", () => {
      it("有元素時應為 true", () => {
        const store = useSelectionStore();
        store.selectedElements = [{ type: "pod", id: "pod-1" }];

        expect(store.hasSelection).toBe(true);
      });

      it("沒有元素時應為 false", () => {
        const store = useSelectionStore();
        store.selectedElements = [];

        expect(store.hasSelection).toBe(false);
      });
    });

    describe("isElementSelected", () => {
      it("元素在 selectedElements 中時應回傳 true", () => {
        const store = useSelectionStore();
        // 使用 mutation action 以確保 _selectedElementSet 同步維護
        store.setSelectedElements([
          { type: "pod", id: "pod-1" },
          { type: "repositoryNote", id: "note-1" },
        ]);

        expect(store.isElementSelected("pod", "pod-1")).toBe(true);
        expect(store.isElementSelected("repositoryNote", "note-1")).toBe(true);
      });

      it("元素不在 selectedElements 中時應回傳 false", () => {
        const store = useSelectionStore();
        // 使用 mutation action 以確保 _selectedElementSet 同步維護
        store.setSelectedElements([{ type: "pod", id: "pod-1" }]);

        expect(store.isElementSelected("pod", "pod-2")).toBe(false);
        expect(store.isElementSelected("repositoryNote", "note-1")).toBe(false);
      });

      it("應依 type 和 id 同時判斷", () => {
        const store = useSelectionStore();
        // 使用 mutation action 以確保 _selectedElementSet 同步維護
        store.setSelectedElements([{ type: "pod", id: "pod-1" }]);

        expect(store.isElementSelected("pod", "pod-1")).toBe(true);
        expect(store.isElementSelected("repositoryNote", "pod-1")).toBe(false);
      });
    });
  });

  describe("startSelection", () => {
    it("應將 isSelecting 設為 true", () => {
      const store = useSelectionStore();

      store.startSelection(100, 200);

      expect(store.isSelecting).toBe(true);
    });

    it("應設定 box 的初始座標", () => {
      const store = useSelectionStore();

      store.startSelection(100, 200);

      expect(store.box).toEqual({
        startX: 100,
        startY: 200,
        endX: 100,
        endY: 200,
      });
    });

    it("非 Ctrl 模式應清空 selectedElements", () => {
      const store = useSelectionStore();
      store.selectedElements = [{ type: "pod", id: "pod-1" }];

      store.startSelection(100, 200, false);

      expect(store.selectedElements).toEqual([]);
    });

    it("非 Ctrl 模式應清空 initialSelectedElements", () => {
      const store = useSelectionStore();
      store.selectedElements = [{ type: "pod", id: "pod-1" }];

      store.startSelection(100, 200, false);

      expect(store.initialSelectedElements).toEqual([]);
    });

    it("Ctrl 模式應保留既有 selectedElements 到 initialSelectedElements", () => {
      const store = useSelectionStore();
      const existingElements: SelectableElement[] = [
        { type: "pod", id: "pod-1" },
        { type: "repositoryNote", id: "note-1" },
      ];
      store.selectedElements = existingElements;

      store.startSelection(100, 200, true);

      expect(store.initialSelectedElements).toEqual(existingElements);
      // selectedElements 應保持不變
      expect(store.selectedElements).toEqual(existingElements);
    });

    it("Ctrl 模式應將 isCtrlMode 設為 true", () => {
      const store = useSelectionStore();

      store.startSelection(100, 200, true);

      expect(store.isCtrlMode).toBe(true);
    });

    it("非 Ctrl 模式應將 isCtrlMode 設為 false", () => {
      const store = useSelectionStore();

      store.startSelection(100, 200, false);

      expect(store.isCtrlMode).toBe(false);
    });
  });

  describe("updateSelection", () => {
    it("應更新 box 的 endX 和 endY", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.updateSelection(300, 400);

      expect(store.box).toEqual({
        startX: 100,
        startY: 200,
        endX: 300,
        endY: 400,
      });
    });

    it("box 為 null 時不應執行任何操作", () => {
      const store = useSelectionStore();
      store.box = null;

      store.updateSelection(300, 400);

      expect(store.box).toBeNull();
    });

    it("應能多次更新 box", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.updateSelection(150, 250);
      expect(store.box?.endX).toBe(150);
      expect(store.box?.endY).toBe(250);

      store.updateSelection(200, 300);
      expect(store.box?.endX).toBe(200);
      expect(store.box?.endY).toBe(300);
    });
  });

  describe("calculateSelectedElements", () => {
    describe("Pod 選取", () => {
      it("Pod 與框選範圍相交時應被選中", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

        // 框選範圍：(50, 50) 到 (200, 200)
        // Pod 範圍：(100, 100) 到 (100 + 224, 100 + 168) = (100, 100) 到 (324, 268)
        // 有相交
        store.startSelection(50, 50);
        store.updateSelection(200, 200);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
      });

      it("Pod 完全在框選範圍內應被選中", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

        // 框選範圍：(0, 0) 到 (500, 500)
        // Pod 完全在內
        store.startSelection(0, 0);
        store.updateSelection(500, 500);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
      });

      it("Pod 與框選範圍無相交時不應被選中", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 500, y: 500 });

        // 框選範圍：(0, 0) 到 (100, 100)
        // Pod 範圍：(500, 500) 到 (724, 668)
        // 無相交
        store.startSelection(0, 0);
        store.updateSelection(100, 100);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([]);
      });

      it("應正確選取多個 Pod", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
        const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
        const pod3 = createMockPod({ id: "pod-3", x: 1000, y: 1000 });

        // 框選範圍：(0, 0) 到 (500, 500)
        // pod1 和 pod2 在範圍內，pod3 不在
        store.startSelection(0, 0);
        store.updateSelection(500, 500);

        store.calculateSelectedElements({
          pods: [pod1, pod2, pod3],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([
          { type: "pod", id: "pod-1" },
          { type: "pod", id: "pod-2" },
        ]);
      });
    });

    describe("Note 選取", () => {
      it("RepositoryNote 與框選範圍相交時應被選中", () => {
        const store = useSelectionStore();
        const note = createMockNote("repository", {
          id: "note-1",
          x: 100,
          y: 100,
        });

        store.startSelection(50, 50);
        store.updateSelection(150, 150);

        store.calculateSelectedElements({
          pods: [],
          noteGroups: [{ notes: [note], type: "repositoryNote" }],
        });

        expect(store.selectedElements).toEqual([
          { type: "repositoryNote", id: "note-1" },
        ]);
      });

      it("CommandNote 與框選範圍相交時應被選中", () => {
        const store = useSelectionStore();
        const note = createMockNote("command", {
          id: "note-1",
          x: 100,
          y: 100,
        });

        store.startSelection(50, 50);
        store.updateSelection(150, 150);

        store.calculateSelectedElements({
          pods: [],
          noteGroups: [{ notes: [note], type: "commandNote" }],
        });

        expect(store.selectedElements).toEqual([
          { type: "commandNote", id: "note-1" },
        ]);
      });

      it("已綁定的 Note (boundToPodId !== null) 不應被選中", () => {
        const store = useSelectionStore();
        const boundNote = createMockNote("repository", {
          id: "note-1",
          x: 100,
          y: 100,
          boundToPodId: "pod-1",
        });
        const unboundNote = createMockNote("repository", {
          id: "note-2",
          x: 100,
          y: 150,
          boundToPodId: null,
        });

        store.startSelection(0, 0);
        store.updateSelection(300, 300);

        store.calculateSelectedElements({
          pods: [],
          noteGroups: [
            { notes: [boundNote, unboundNote], type: "repositoryNote" },
          ],
        });

        // 只有未綁定的 note 被選中
        expect(store.selectedElements).toEqual([
          { type: "repositoryNote", id: "note-2" },
        ]);
      });

      it("Note 與框選範圍無相交時不應被選中", () => {
        const store = useSelectionStore();
        const note = createMockNote("repository", {
          id: "note-1",
          x: 500,
          y: 500,
        });

        // 框選範圍：(0, 0) 到 (100, 100)
        // Note 範圍：(500, 500) 到 (580, 530)
        // 無相交
        store.startSelection(0, 0);
        store.updateSelection(100, 100);

        store.calculateSelectedElements({
          pods: [],
          noteGroups: [{ notes: [note], type: "repositoryNote" }],
        });

        expect(store.selectedElements).toEqual([]);
      });
    });

    describe("混合選取", () => {
      it("應能同時選取 Pod 和多種 Note", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
        const repoNote1 = createMockNote("repository", {
          id: "note-1",
          x: 150,
          y: 150,
        });
        const repoNote2 = createMockNote("repository", {
          id: "note-3",
          x: 250,
          y: 250,
        });

        store.startSelection(0, 0);
        store.updateSelection(400, 400);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [
            { notes: [repoNote1], type: "repositoryNote" },
            { notes: [repoNote2], type: "repositoryNote" },
          ],
        });

        expect(store.selectedElements).toEqual([
          { type: "pod", id: "pod-1" },
          { type: "repositoryNote", id: "note-1" },
          { type: "repositoryNote", id: "note-3" },
        ]);
      });

      it("應正確過濾不在範圍內的元素", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
        const pod2 = createMockPod({ id: "pod-2", x: 1000, y: 1000 });
        const note1 = createMockNote("repository", {
          id: "note-1",
          x: 150,
          y: 150,
        });
        const note2 = createMockNote("repository", {
          id: "note-2",
          x: 2000,
          y: 2000,
        });

        store.startSelection(0, 0);
        store.updateSelection(500, 500);

        store.calculateSelectedElements({
          pods: [pod1, pod2],
          noteGroups: [{ notes: [note1, note2], type: "repositoryNote" }],
        });

        expect(store.selectedElements).toEqual([
          { type: "pod", id: "pod-1" },
          { type: "repositoryNote", id: "note-1" },
        ]);
      });
    });

    describe("框選範圍反向處理", () => {
      it("startX > endX 時應正確處理", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

        // 框選方向反轉時應自動正規化座標範圍
        store.startSelection(400, 0);
        store.updateSelection(0, 300);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
      });

      it("startY > endY 時應正確處理", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

        // 框選從下到上：(0, 400) 到 (300, 0)
        // 應等同於 (0, 0) 到 (300, 400)
        store.startSelection(0, 400);
        store.updateSelection(300, 0);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
      });

      it("startX > endX 且 startY > endY 時應正確處理", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

        // 框選從右下到左上：(400, 400) 到 (0, 0)
        store.startSelection(400, 400);
        store.updateSelection(0, 0);

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
      });
    });

    describe("Ctrl 模式的 toggle 邏輯", () => {
      it("Ctrl 模式：已在 initialSelectedElements 中的元素如果在新框選中，應移除", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
        const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });

        // 先選中 pod-1
        store.selectedElements = [{ type: "pod", id: "pod-1" }];

        // 開始 Ctrl 框選，框選範圍包含 pod-1 和 pod-2
        store.startSelection(0, 0, true);
        store.updateSelection(500, 500);

        store.calculateSelectedElements({
          pods: [pod1, pod2],
          noteGroups: [],
        });

        // pod-1 已在 initialSelectedElements 中，被 toggle 移除
        // pod-2 是新選中的，被加入
        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-2" }]);
      });

      it("Ctrl 模式：不在 initialSelectedElements 中但在新框選中的元素，應加入", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 50, y: 50 });
        const pod2 = createMockPod({ id: "pod-2", x: 400, y: 400 });

        // 先選中 pod-1
        store.selectedElements = [{ type: "pod", id: "pod-1" }];

        // 開始 Ctrl 框選，但框選範圍只包含 pod-2
        // pod-1 範圍：(50, 50) 到 (274, 218)
        // pod-2 範圍：(400, 400) 到 (624, 568)
        // 框選範圍：(350, 350) 到 (700, 700) - 只包含 pod-2
        store.startSelection(350, 350, true);
        store.updateSelection(700, 700);

        store.calculateSelectedElements({
          pods: [pod1, pod2],
          noteGroups: [],
        });

        // pod-1 在 initialSelectedElements 中，但不在新框選中，保留
        // pod-2 是新選中的，被加入
        expect(store.selectedElements).toEqual([
          { type: "pod", id: "pod-1" },
          { type: "pod", id: "pod-2" },
        ]);
      });

      it("Ctrl 模式：同時測試加入和移除", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
        const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
        const pod3 = createMockPod({ id: "pod-3", x: 300, y: 300 });
        const note1 = createMockNote("repository", {
          id: "note-1",
          x: 150,
          y: 150,
        });

        // 先選中 pod-1 和 note-1
        store.selectedElements = [
          { type: "pod", id: "pod-1" },
          { type: "repositoryNote", id: "note-1" },
        ];

        // 開始 Ctrl 框選，框選範圍包含 pod-1, pod-2, pod-3
        store.startSelection(0, 0, true);
        store.updateSelection(600, 600);

        store.calculateSelectedElements({
          pods: [pod1, pod2, pod3],
          noteGroups: [{ notes: [note1], type: "repositoryNote" }],
        });

        // pod-1 被 toggle 移除（已在 initial 中，又被框選到）
        // note-1 被 toggle 移除（已在 initial 中，又被框選到）
        // pod-2 和 pod-3 是新選中的，被加入
        expect(store.selectedElements).toEqual([
          { type: "pod", id: "pod-2" },
          { type: "pod", id: "pod-3" },
        ]);
      });

      it("非 Ctrl 模式：應僅保留框選範圍內的元素", () => {
        const store = useSelectionStore();
        const pod1 = createMockPod({ id: "pod-1", x: 50, y: 50 });
        const pod2 = createMockPod({ id: "pod-2", x: 400, y: 400 });

        // 先選中 pod-1
        store.selectedElements = [{ type: "pod", id: "pod-1" }];

        // 非 Ctrl 框選，框選範圍只包含 pod-2
        // startSelection 在非 Ctrl 模式會立即清空 selectedElements
        // 所以這個測試其實是測試 calculateSelectedElements 正確選取 pod-2
        // pod-2 範圍：(400, 400) 到 (624, 568)
        // 框選範圍：(350, 350) 到 (700, 700) - 包含 pod-2，不包含 pod-1
        store.startSelection(350, 350, false);
        store.updateSelection(700, 700);

        store.calculateSelectedElements({
          pods: [pod1, pod2],
          noteGroups: [],
        });

        // 只保留框選範圍內的 pod-2
        expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-2" }]);
      });
    });

    describe("box 為 null", () => {
      it("box 為 null 時不應執行任何操作", () => {
        const store = useSelectionStore();
        const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
        store.box = null;
        store.selectedElements = [{ type: "pod", id: "existing" }];

        store.calculateSelectedElements({
          pods: [pod],
          noteGroups: [],
        });

        // selectedElements 保持不變
        expect(store.selectedElements).toEqual([
          { type: "pod", id: "existing" },
        ]);
      });
    });
  });

  describe("endSelection", () => {
    it("應將 isSelecting 設為 false", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.endSelection();

      expect(store.isSelecting).toBe(false);
    });

    it("應將 box 清為 null", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.endSelection();

      expect(store.box).toBeNull();
    });

    it("requestAnimationFrame 後應將 boxSelectJustEnded 重置為 false", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.endSelection();

      // requestAnimationFrame 在 setup.ts 中被 mock 為同步執行
      // 所以 boxSelectJustEnded 會立即被重置為 false
      expect(store.boxSelectJustEnded).toBe(false);
    });

    it("應重置 isCtrlMode", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200, true);

      store.endSelection();

      expect(store.isCtrlMode).toBe(false);
    });

    it("應清空 initialSelectedElements", () => {
      const store = useSelectionStore();
      store.selectedElements = [{ type: "pod", id: "pod-1" }];
      store.startSelection(100, 200, true);

      store.endSelection();

      expect(store.initialSelectedElements).toEqual([]);
    });

    it("不會改變 selectedElements（由 calculateSelectedElements 決定）", () => {
      const store = useSelectionStore();
      // 使用 Ctrl 模式讓 selectedElements 不被 startSelection 清空
      store.selectedElements = [{ type: "pod", id: "pod-1" }];
      store.startSelection(100, 200, true);

      store.endSelection();

      // endSelection 不會改變 selectedElements
      expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
    });
  });

  describe("cancelSelection", () => {
    it("應將 isSelecting 設為 false", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.cancelSelection();

      expect(store.isSelecting).toBe(false);
    });

    it("應將 box 清為 null", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.cancelSelection();

      expect(store.box).toBeNull();
    });

    it("不應設定 boxSelectJustEnded", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.cancelSelection();

      // 與 endSelection 不同，不設定 boxSelectJustEnded
      expect(store.boxSelectJustEnded).toBe(false);
    });

    it("應重置 isCtrlMode", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200, true);

      store.cancelSelection();

      expect(store.isCtrlMode).toBe(false);
    });

    it("應清空 initialSelectedElements", () => {
      const store = useSelectionStore();
      store.selectedElements = [{ type: "pod", id: "pod-1" }];
      store.startSelection(100, 200, true);

      store.cancelSelection();

      expect(store.initialSelectedElements).toEqual([]);
    });

    it("不會改變 selectedElements（由 calculateSelectedElements 決定）", () => {
      const store = useSelectionStore();
      // 使用 Ctrl 模式讓 selectedElements 不被 startSelection 清空
      store.selectedElements = [{ type: "pod", id: "pod-1" }];
      store.startSelection(100, 200, true);

      store.cancelSelection();

      // cancelSelection 不會改變 selectedElements
      expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
    });
  });

  describe("clearSelection", () => {
    it("應清除 isSelecting", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.clearSelection();

      expect(store.isSelecting).toBe(false);
    });

    it("應清除 box", () => {
      const store = useSelectionStore();
      store.startSelection(100, 200);

      store.clearSelection();

      expect(store.box).toBeNull();
    });

    it("應清除所有選取狀態", () => {
      const store = useSelectionStore();
      store.isSelecting = true;
      store.box = { startX: 0, startY: 0, endX: 100, endY: 100 };
      store.selectedElements = [{ type: "pod", id: "pod-1" }];

      store.clearSelection();

      expect(store.isSelecting).toBe(false);
      expect(store.box).toBeNull();
      expect(store.selectedElements).toEqual([]);
    });
  });

  describe("toggleElement", () => {
    it("空陣列時應能加入元素", () => {
      const store = useSelectionStore();
      store.selectedElements = [];

      store.toggleElement({ type: "pod", id: "pod-1" });

      expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
    });

    it("應能連續 toggle", () => {
      const store = useSelectionStore();
      store.selectedElements = [];

      // 加入
      store.toggleElement({ type: "pod", id: "pod-1" });
      expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);

      // 移除
      store.toggleElement({ type: "pod", id: "pod-1" });
      expect(store.selectedElements).toEqual([]);

      // 再次加入
      store.toggleElement({ type: "pod", id: "pod-1" });
      expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
    });
  });

  describe("setSelectedElements", () => {
    it("應能設定空陣列", () => {
      const store = useSelectionStore();
      store.selectedElements = [{ type: "pod", id: "pod-1" }];

      store.setSelectedElements([]);

      expect(store.selectedElements).toEqual([]);
    });
  });
});
