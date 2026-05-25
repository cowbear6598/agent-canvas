import type { I18nError } from "../../utils/i18nError.js";

export interface CanvasCreatedPayload {
  requestId: string;
  success: boolean;
  canvas?: {
    id: string;
    name: string;
    sortIndex: number;
  };
  error?: string | I18nError;
}

export interface CanvasListResultPayload {
  requestId: string;
  success: boolean;
  canvases?: Array<{
    id: string;
    name: string;
    sortIndex: number;
  }>;
  error?: string;
}

export interface CanvasRenamedPayload {
  requestId: string;
  success: boolean;
  canvasId?: string;
  newName?: string;
  canvas?: {
    id: string;
    name: string;
  };
  error?: string;
}

export interface CanvasDeletedPayload {
  requestId: string;
  success: boolean;
  canvasId?: string;
  error?: string;
}

export interface CanvasSwitchedPayload {
  requestId: string;
  success: boolean;
  canvasId?: string;
  error?: string;
}

export interface CanvasReorderedPayload {
  requestId: string;
  success: boolean;
  canvasIds?: string[];
  error?: string;
}
