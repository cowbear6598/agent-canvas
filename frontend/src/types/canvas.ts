export interface Canvas {
  id: string
  name: string
  sortIndex: number
}

export interface CanvasCreatePayload {
  requestId: string
  name: string
}

export interface CanvasListPayload {
  requestId: string
}

export interface CanvasRenamePayload {
  requestId: string
  canvasId: string
  newName: string
}

export interface CanvasDeletePayload {
  requestId: string
  canvasId: string
}

export interface CanvasSwitchPayload {
  requestId: string
  canvasId: string
}

export interface CanvasCreatedPayload {
  requestId: string
  success: boolean
  canvas?: Canvas
  error?: string
}

export interface CanvasListResultPayload {
  requestId: string
  success: boolean
  canvases?: Canvas[]
  error?: string
}

export interface CanvasRenamedPayload {
  requestId: string
  success: boolean
  canvas?: {
    id: string
    name: string
  }
  error?: string
}

export interface CanvasDeletedPayload {
  requestId: string
  success: boolean
  canvasId?: string
  error?: string
}

export interface CanvasSwitchedPayload {
  requestId: string
  success: boolean
  canvasId?: string
  error?: string
}

export interface CanvasReorderPayload {
  requestId: string
  canvasIds: string[]
}

export interface CanvasReorderedPayload {
  requestId: string
  success: boolean
  error?: string
}
