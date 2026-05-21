import { describe, it, expect } from 'vitest'
import { setupStoreTest } from '@tests/helpers/testSetup'
import { useCursorStore } from '@/stores/cursorStore'
import type { CursorMovedPayload } from '@/types/websocket'

function makeCursorPayload(overrides: Partial<CursorMovedPayload> = {}): CursorMovedPayload {
  return {
    connectionId: 'conn-1',
    x: 100,
    y: 200,
    color: '#ff0000',
    ...overrides,
  }
}

describe('cursorStore', () => {
  setupStoreTest()

  describe('初始狀態', () => {
    it('cursors 應為空 Map', () => {
      const store = useCursorStore()

      expect(store.cursors.size).toBe(0)
    })
  })

  describe('addOrUpdateCursor', () => {
    it('應新增游標', () => {
      const store = useCursorStore()
      const payload = makeCursorPayload()

      store.addOrUpdateCursor(payload)

      expect(store.cursors.size).toBe(1)
      const cursor = store.cursors.get('conn-1')
      expect(cursor).toEqual({
        connectionId: 'conn-1',
        x: 100,
        y: 200,
        color: '#ff0000',
      })
    })

    it('無效顏色格式應被替換為預設色', () => {
      const store = useCursorStore()

      store.addOrUpdateCursor(makeCursorPayload({ color: 'not-a-color' }))

      expect(store.cursors.get('conn-1')?.color).toBe('#6B7280')
    })

    it('有效顏色格式應保留原值', () => {
      const store = useCursorStore()

      store.addOrUpdateCursor(makeCursorPayload({ color: '#FF6B6B' }))

      expect(store.cursors.get('conn-1')?.color).toBe('#FF6B6B')
    })

    it('應更新已存在的游標', () => {
      const store = useCursorStore()
      store.addOrUpdateCursor(makeCursorPayload({ x: 100, y: 200 }))

      store.addOrUpdateCursor(makeCursorPayload({ x: 300, y: 400, color: '#00ff00' }))

      expect(store.cursors.size).toBe(1)
      const cursor = store.cursors.get('conn-1')
      expect(cursor?.x).toBe(300)
      expect(cursor?.y).toBe(400)
      expect(cursor?.color).toBe('#00ff00')
    })
  })

  describe('removeCursor', () => {
    it('應移除指定 connectionId 的游標', () => {
      const store = useCursorStore()
      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-1' }))
      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-2' }))

      store.removeCursor('conn-1')

      expect(store.cursors.has('conn-1')).toBe(false)
      expect(store.cursors.has('conn-2')).toBe(true)
    })

    it('移除不存在的 connectionId 不應報錯', () => {
      const store = useCursorStore()

      expect(() => store.removeCursor('non-existent')).not.toThrow()
    })
  })

  describe('clearAllCursors', () => {
    it('應清空所有游標', () => {
      const store = useCursorStore()
      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-1' }))
      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-2' }))

      store.clearAllCursors()

      expect(store.cursors.size).toBe(0)
    })
  })

  describe('Canvas 切換時清除游標', () => {
    it('clearAllCursors 應清空所有遠端游標且 cursorCount 歸零', () => {
      const store = useCursorStore()
      store.addOrUpdateCursor({ connectionId: 'conn-1', x: 100, y: 200, color: '#E05252' })
      store.addOrUpdateCursor({ connectionId: 'conn-2', x: 300, y: 400, color: '#2BA89E' })
      expect(store.cursorCount).toBe(2)

      store.clearAllCursors()

      expect(store.cursorCount).toBe(0)
      expect(store.cursors.size).toBe(0)
    })
  })

  describe('cursorCount', () => {
    it('應回傳正確的游標數量', () => {
      const store = useCursorStore()

      expect(store.cursorCount).toBe(0)

      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-1' }))
      expect(store.cursorCount).toBe(1)

      store.addOrUpdateCursor(makeCursorPayload({ connectionId: 'conn-2' }))
      expect(store.cursorCount).toBe(2)

      store.removeCursor('conn-1')
      expect(store.cursorCount).toBe(1)
    })
  })
})
