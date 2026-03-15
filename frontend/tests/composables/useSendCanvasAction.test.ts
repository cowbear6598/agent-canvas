import { describe, it, expect, vi } from 'vitest'
import { webSocketMockFactory, mockCreateWebSocketRequest } from '../helpers/mockWebSocket'
import { setupStoreTest } from '../helpers/testSetup'
import { useSendCanvasAction } from '@/composables/useSendCanvasAction'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@/services/websocket', () => webSocketMockFactory())

describe('useSendCanvasAction', () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore()
    canvasStore.activeCanvasId = 'canvas-1'
  })

  describe('sendCanvasAction - 成功情境', () => {
    it('成功時應回傳 response', async () => {
      const { sendCanvasAction } = useSendCanvasAction()
      const responseData = { success: true, id: 'item-1' }

      mockCreateWebSocketRequest.mockResolvedValueOnce(responseData)

      const result = await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
        payload: { someField: 'value' },
      })

      expect(result).toEqual(responseData)
    })

    it('應自動將 canvasId 注入 payload', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
        payload: { podId: 'pod-1' },
      })

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: 'canvas-1',
            podId: 'pod-1',
          }),
        })
      )
    })

    it('payload 為空時應只注入 canvasId', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
      })

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            canvasId: 'canvas-1',
          }),
        })
      )
    })

    it('應傳遞正確的 requestEvent 和 responseEvent', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await sendCanvasAction({
        requestEvent: 'custom:request',
        responseEvent: 'custom:response',
        payload: {},
      })

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestEvent: 'custom:request',
          responseEvent: 'custom:response',
        })
      )
    })

    it('應傳遞 timeout 設定', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true })

      await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
        timeout: 30000,
      })

      expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      )
    })
  })

  describe('sendCanvasAction - 沒有 active canvas 情境', () => {
    it('沒有 activeCanvasId 時應回傳 null，不發出請求', async () => {
      const canvasStore = useCanvasStore()
      canvasStore.activeCanvasId = null

      const { sendCanvasAction } = useSendCanvasAction()

      const result = await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
        payload: {},
      })

      expect(result).toBeNull()
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled()
    })
  })

  describe('sendCanvasAction - WebSocket 失敗情境', () => {
    it('createWebSocketRequest 拋出例外時應回傳 null', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error('WebSocket 連線失敗'))

      const result = await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
        payload: {},
      })

      expect(result).toBeNull()
    })

    it('請求逾時時應回傳 null', async () => {
      const { sendCanvasAction } = useSendCanvasAction()

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error('請求逾時'))

      const result = await sendCanvasAction({
        requestEvent: 'test:request',
        responseEvent: 'test:response',
      })

      expect(result).toBeNull()
    })
  })
})
