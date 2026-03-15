import { createWebSocketRequest } from '@/services/websocket'
import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { getActiveCanvasIdOrWarn } from '@/utils/canvasGuard'

// TPayload 需符合 createWebSocketRequest 的最低要求（含 requestId）
type MinimalPayload = { requestId: string }

export interface SendCanvasActionConfig<TPayload extends MinimalPayload, TResponse> {
  requestEvent: string
  responseEvent: string
  // 呼叫端無需傳入 requestId（由 createWebSocketRequest 注入）與 canvasId（由 sendCanvasAction 注入）
  payload?: Omit<TPayload, 'requestId' | 'canvasId'>
  timeout?: number
  matchResponse?: (response: TResponse, requestId: string) => boolean
}

export function useSendCanvasAction(): {
  sendCanvasAction: <TPayload extends MinimalPayload, TResponse>(
    config: SendCanvasActionConfig<TPayload, TResponse>
  ) => Promise<TResponse | null>
} {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler()

  const sendCanvasAction = <TPayload extends MinimalPayload, TResponse>(
    config: SendCanvasActionConfig<TPayload, TResponse>
  ): Promise<TResponse | null> => {
    const canvasId = getActiveCanvasIdOrWarn('sendCanvasAction')
    if (!canvasId) return Promise.resolve(null)

    const fullPayload = { ...(config.payload ?? {}), canvasId } as unknown as Omit<TPayload, 'requestId'>

    return wrapWebSocketRequest(
      createWebSocketRequest<TPayload, TResponse>({
        requestEvent: config.requestEvent,
        responseEvent: config.responseEvent,
        timeout: config.timeout,
        matchResponse: config.matchResponse,
        payload: fullPayload,
      })
    )
  }

  return { sendCanvasAction }
}
