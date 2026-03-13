import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatRelativeTime, truncateMessage } from '@/utils/runFormatUtils'

describe('runFormatUtils', () => {
  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('數秒前應顯示「剛剛」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const thirtySecondsAgo = new Date('2026-01-01T11:59:30Z').toISOString()

      expect(formatRelativeTime(thirtySecondsAgo)).toBe('剛剛')
    })

    it('59 秒前應顯示「剛剛」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const fiftyNineSecondsAgo = new Date('2026-01-01T11:59:01Z').toISOString()

      expect(formatRelativeTime(fiftyNineSecondsAgo)).toBe('剛剛')
    })

    it('3 分鐘前應顯示「3 分鐘前」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const threeMinutesAgo = new Date('2026-01-01T11:57:00Z').toISOString()

      expect(formatRelativeTime(threeMinutesAgo)).toBe('3 分鐘前')
    })

    it('59 分鐘前應顯示「59 分鐘前」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const fiftyNineMinutesAgo = new Date('2026-01-01T11:01:00Z').toISOString()

      expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe('59 分鐘前')
    })

    it('2 小時前應顯示「2 小時前」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const twoHoursAgo = new Date('2026-01-01T10:00:00Z').toISOString()

      expect(formatRelativeTime(twoHoursAgo)).toBe('2 小時前')
    })

    it('23 小時前應顯示「23 小時前」', () => {
      const now = new Date('2026-01-01T12:00:00Z')
      vi.setSystemTime(now)
      const twentyThreeHoursAgo = new Date('2025-12-31T13:00:00Z').toISOString()

      expect(formatRelativeTime(twentyThreeHoursAgo)).toBe('23 小時前')
    })

    it('超過一天應顯示「X 天前」', () => {
      const now = new Date('2026-01-05T12:00:00Z')
      vi.setSystemTime(now)
      const threeDaysAgo = new Date('2026-01-02T12:00:00Z').toISOString()

      expect(formatRelativeTime(threeDaysAgo)).toBe('3 天前')
    })
  })

  describe('truncateMessage', () => {
    it('超過長度應截斷並加 ...', () => {
      const message = 'Hello World This Is A Long Message'
      const result = truncateMessage(message, 10)

      expect(result).toBe('Hello Worl...')
    })

    it('未超過長度應原樣回傳', () => {
      const message = 'Short'
      const result = truncateMessage(message, 10)

      expect(result).toBe('Short')
    })

    it('剛好等於長度應原樣回傳', () => {
      const message = 'Exact'
      const result = truncateMessage(message, 5)

      expect(result).toBe('Exact')
    })

    it('空字串應回傳空字串', () => {
      const result = truncateMessage('', 10)

      expect(result).toBe('')
    })
  })
})
