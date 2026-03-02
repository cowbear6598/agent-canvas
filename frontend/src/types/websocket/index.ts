export * from './events'
export * from './requests'
export * from './responses'

export interface WebSocketMessage<T = unknown> {
  type: string
  payload: T
  requestId?: string
  ackId?: string
}

export interface WebSocketAckMessage {
  type: 'ack'
  ackId: string
  payload: unknown
}

export interface BasePayload {
  requestId: string

  // 允許各 store 傳入不同 payload 欄位（如 canvasId、noteId 等）。
  // 型別安全由各呼叫端的 createWebSocketRequest<TReq, TRes> 泛型參數保障。
  [key: string]: unknown
}

export interface BaseResponse {
  requestId: string
  success: boolean

  [key: string]: unknown
}

export interface ResultPayload {
  requestId: string
  success: boolean
  error?: string
}
