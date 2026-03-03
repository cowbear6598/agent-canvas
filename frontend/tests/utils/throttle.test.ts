import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { throttle } from '@/utils/throttle'

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('leading call', () => {
    it('第一次呼叫應立即執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')

      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('a')
    })

    it('interval 結束後再次呼叫應立即執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      vi.advanceTimersByTime(100)
      throttled('b')

      expect(fn).toHaveBeenCalledTimes(2)
      expect(fn).toHaveBeenNthCalledWith(2, 'b')
    })
  })

  describe('trailing call', () => {
    it('throttle 期間的呼叫應延遲至 interval 結束後送出', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      fn.mockClear()

      throttled('b')
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('b')
    })

    it('throttle 期間多次呼叫只送出最後一次', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      fn.mockClear()

      throttled('b')
      throttled('c')
      throttled('d')

      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('d')
    })
  })

  describe('cancel', () => {
    it('cancel 後 pending call 不應執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      fn.mockClear()

      throttled('b')
      throttled.cancel()

      vi.advanceTimersByTime(200)

      expect(fn).not.toHaveBeenCalled()
    })

    it('cancel 後再次呼叫應正常 leading call 執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      throttled('b')
      throttled.cancel()
      fn.mockClear()

      vi.advanceTimersByTime(100)
      throttled('c')

      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('c')
    })
  })

  describe('flush', () => {
    it('flush 應立即執行 pending call', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      fn.mockClear()

      throttled('b')
      throttled.flush()

      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith('b')
    })

    it('flush 後 interval 結束不應重複執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled('a')
      fn.mockClear()

      throttled('b')
      throttled.flush()
      fn.mockClear()

      vi.advanceTimersByTime(200)

      expect(fn).not.toHaveBeenCalled()
    })

    it('無 pending call 時 flush 不應執行', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled.flush()

      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('型別正確性', () => {
    it('應正確傳遞多個參數', () => {
      const fn = vi.fn()
      const throttled = throttle(fn, 100)

      throttled(1, 'two', true)

      expect(fn).toHaveBeenCalledWith(1, 'two', true)
    })
  })
})
