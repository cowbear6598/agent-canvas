import { describe, it, expect } from 'vitest'
import { isAutoTriggerable } from '@/lib/workflowUtils'

describe('workflowUtils', () => {
  describe('isAutoTriggerable', () => {
    it('triggerMode 為 "auto" 時應回傳 true', () => {
      expect(isAutoTriggerable('auto')).toBe(true)
    })

    it('triggerMode 為 "ai-decide" 時應回傳 true', () => {
      expect(isAutoTriggerable('ai-decide')).toBe(true)
    })

    it('triggerMode 為 "manual" 時應回傳 false', () => {
      expect(isAutoTriggerable('manual')).toBe(false)
    })

    it('triggerMode 為 "direct" 時應回傳 false', () => {
      expect(isAutoTriggerable('direct')).toBe(false)
    })

    it('triggerMode 為 undefined 時應回傳 false', () => {
      expect(isAutoTriggerable(undefined)).toBe(false)
    })

    it('triggerMode 為空字串時應回傳 false', () => {
      expect(isAutoTriggerable('')).toBe(false)
    })
  })
})
