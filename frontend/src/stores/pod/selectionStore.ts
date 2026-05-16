import { defineStore } from "pinia";
import type { BaseNote, SelectableElement, SelectionState } from "@/types";
import {
  POD_WIDTH,
  POD_HEIGHT,
  NOTE_WIDTH,
  NOTE_HEIGHT,
} from "@/lib/constants";

export type NoteType = "repositoryNote";

type SelectionBox = { minX: number; maxX: number; minY: number; maxY: number };

function toElementKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function buildElementSet(
  elements: { type: string; id: string }[],
): Set<string> {
  return new Set(elements.map((el) => toElementKey(el.type, el.id)));
}

function selectIdsByType(
  elements: { type: string; id: string }[],
  type: string,
): string[] {
  return elements.filter((el) => el.type === type).map((el) => el.id);
}

function findPodsInSelectionBox(
  pods: Array<{ id: string; x: number; y: number }>,
  box: SelectionBox,
): SelectableElement[] {
  return pods
    .filter((pod) => {
      const podMaxX = pod.x + POD_WIDTH;
      const podMaxY = pod.y + POD_HEIGHT;
      return !(
        podMaxX < box.minX ||
        pod.x > box.maxX ||
        podMaxY < box.minY ||
        pod.y > box.maxY
      );
    })
    .map((pod) => ({ type: "pod" as const, id: pod.id }));
}

function isNoteInBox(note: BaseNote, box: SelectionBox): boolean {
  const noteMaxX = note.x + NOTE_WIDTH;
  const noteMaxY = note.y + NOTE_HEIGHT;
  return (
    noteMaxX >= box.minX &&
    note.x <= box.maxX &&
    noteMaxY >= box.minY &&
    note.y <= box.maxY
  );
}

function findNotesInSelectionBox(
  noteGroups: Array<{ notes: BaseNote[]; type: NoteType }>,
  box: SelectionBox,
): SelectableElement[] {
  return noteGroups.flatMap(({ notes, type }) =>
    notes
      .filter((note) => !note.boundToPodId && isNoteInBox(note, box))
      .map((note) => ({ type, id: note.id })),
  );
}

function applyCtrlModeToggle(
  initialElements: SelectableElement[],
  newElements: SelectableElement[],
): SelectableElement[] {
  const result = [...initialElements];

  for (const element of newElements) {
    const index = result.findIndex(
      (el) => el.type === element.type && el.id === element.id,
    );
    if (index !== -1) {
      result.splice(index, 1);
    } else {
      result.push(element);
    }
  }

  return result;
}

export interface CalculateSelectionParams {
  pods: Array<{ id: string; x: number; y: number }>;
  noteGroups: Array<{ notes: BaseNote[]; type: NoteType }>;
}

interface SelectionStateInternal extends SelectionState {
  /** 內部同步維護的 Set 索引，避免 selectedElementSet getter 每次讀取重建 Set */
  _selectedElementSet: Set<string>;
}

export const useSelectionStore = defineStore("selection", {
  state: (): SelectionStateInternal => ({
    isSelecting: false,
    box: null,
    selectedElements: [],
    boxSelectJustEnded: false,
    isCtrlMode: false,
    initialSelectedElements: [],
    _selectedElementSet: new Set<string>(),
  }),

  getters: {
    /**
     * 取得選中的 Pod ID 列表
     */
    selectedPodIds: (state): string[] =>
      selectIdsByType(state.selectedElements, "pod"),

    /**
     * 取得選中的 RepositoryNote ID 列表
     */
    selectedRepositoryNoteIds: (state): string[] =>
      selectIdsByType(state.selectedElements, "repositoryNote"),

    /**
     * 是否有選中的元素
     */
    hasSelection: (state): boolean => state.selectedElements.length > 0,

    /**
     * 選中元素的 Set 索引（O(1) 讀取，由各 mutation 同步維護）
     */
    selectedElementSet: (state): Set<string> =>
      (state as SelectionStateInternal)._selectedElementSet,

    /**
     * 檢查元素是否已選取（O(1) 查找）
     */
    isElementSelected(): (type: string, id: string) => boolean {
      return (type: string, id: string): boolean => {
        return this.selectedElementSet.has(toElementKey(type, id));
      };
    },
  },

  actions: {
    /**
     * 以新的 elements 陣列同步重建內部 _selectedElementSet。
     * 所有會替換 selectedElements 的路徑都必須呼叫此函式，確保 Set 與陣列保持同步。
     */
    _syncSet(elements: SelectableElement[]): void {
      this._selectedElementSet = buildElementSet(elements);
    },

    /**
     * 開始框選
     */
    startSelection(
      startX: number,
      startY: number,
      isCtrlPressed: boolean = false,
    ): void {
      this.isSelecting = true;
      this.box = { startX, startY, endX: startX, endY: startY };
      this.isCtrlMode = isCtrlPressed;

      if (isCtrlPressed) {
        // Ctrl 模式：保留現有選取作為 initialSelectedElements，_selectedElementSet 不需重建
        this.initialSelectedElements = [...this.selectedElements];
      } else {
        // 非 Ctrl 模式：清空選取，同步重建 _selectedElementSet
        this.selectedElements = [];
        this.initialSelectedElements = [];
        this._syncSet([]);
      }
    },

    /**
     * 更新框選範圍
     */
    updateSelection(endX: number, endY: number): void {
      if (!this.box) return;
      this.box.endX = endX;
      this.box.endY = endY;
    },

    /**
     * 結束框選
     */
    endSelection(): void {
      this.isSelecting = false;
      this.box = null;
      this.boxSelectJustEnded = true;
      this.isCtrlMode = false;
      this.initialSelectedElements = [];
      requestAnimationFrame(() => {
        this.boxSelectJustEnded = false;
      });
    },

    /**
     * 取消框選（純點擊情況）
     * 不設定 boxSelectJustEnded，讓 click 事件可以正常傳遞
     */
    cancelSelection(): void {
      this.isSelecting = false;
      this.box = null;
      this.isCtrlMode = false;
      this.initialSelectedElements = [];
    },

    /**
     * 清除選取狀態
     */
    clearSelection(): void {
      this.isSelecting = false;
      this.box = null;
      this.selectedElements = [];
      this._syncSet([]);
    },

    /**
     * 設定選中的元素
     */
    setSelectedElements(elements: SelectableElement[]): void {
      this.selectedElements = elements;
      this._syncSet(elements);
    },

    /**
     * Toggle 元素選取狀態
     */
    toggleElement(element: SelectableElement): void {
      const key = toElementKey(element.type, element.id);
      const index = this.selectedElements.findIndex(
        (el) => el.type === element.type && el.id === element.id,
      );

      if (index !== -1) {
        this.selectedElements.splice(index, 1);
        this._selectedElementSet.delete(key);
      } else {
        this.selectedElements.push(element);
        this._selectedElementSet.add(key);
      }
    },

    calculateSelectedElements(params: CalculateSelectionParams): void {
      if (!this.box) return;

      const box: SelectionBox = {
        minX: Math.min(this.box.startX, this.box.endX),
        maxX: Math.max(this.box.startX, this.box.endX),
        minY: Math.min(this.box.startY, this.box.endY),
        maxY: Math.max(this.box.startY, this.box.endY),
      };

      const selected = [
        ...findPodsInSelectionBox(params.pods, box),
        ...findNotesInSelectionBox(params.noteGroups, box),
      ];

      const next = this.isCtrlMode
        ? applyCtrlModeToggle(this.initialSelectedElements, selected)
        : selected;

      this.selectedElements = next;
      this._syncSet(next);
    },
  },
});
