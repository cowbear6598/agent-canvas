export interface SelectableElement {
  type:
    | "pod"
    | "skillNote"
    | "repositoryNote"
    | "subAgentNote"
    | "commandNote"
    | "mcpServerNote";
  id: string;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface SelectionState {
  isSelecting: boolean;
  box: SelectionBox | null;
  selectedElements: SelectableElement[];
  boxSelectJustEnded: boolean;
  isCtrlMode: boolean;
  initialSelectedElements: SelectableElement[];
}
