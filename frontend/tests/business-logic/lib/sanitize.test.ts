import { describe, it, expect } from 'vitest'
import { validatePodName } from '@/lib/sanitize'

describe('sanitize', () => {
  describe('validatePodName', () => {
    it('應該接受正常名稱', () => {
      const result = validatePodName('My Pod')
      expect(result).toBe(true)
    })

    it('應該接受包含特殊字元的名稱', () => {
      const result = validatePodName('Pod-123_test')
      expect(result).toBe(true)
    })

    it('應該拒絕空字串', () => {
      const result = validatePodName('')
      expect(result).toBe(false)
    })

    it('應該拒絕純空白字串', () => {
      const result = validatePodName('   ')
      expect(result).toBe(false)
    })

    it('應該拒絕超過 50 字元的名稱', () => {
      const longName = 'a'.repeat(51)
      const result = validatePodName(longName)
      expect(result).toBe(false)
    })

    it('應該接受剛好 50 字元的名稱', () => {
      const maxLengthName = 'a'.repeat(50)
      const result = validatePodName(maxLengthName)
      expect(result).toBe(true)
    })

    it('應該接受前後有空白的名稱（會被 trim）', () => {
      const result = validatePodName('  Valid Name  ')
      expect(result).toBe(true)
    })

    it('應該在 trim 後檢查長度', () => {
      const name = ' '.repeat(10) + 'a'.repeat(50) + ' '.repeat(10)
      const result = validatePodName(name)
      expect(result).toBe(true)
    })

    it('應該接受單一字元名稱', () => {
      const result = validatePodName('A')
      expect(result).toBe(true)
    })

    it('應該接受包含中文的名稱', () => {
      const result = validatePodName('我的 Pod')
      expect(result).toBe(true)
    })

    it('應該拒絕超長中文名稱', () => {
      const longChineseName = '中'.repeat(51)
      const result = validatePodName(longChineseName)
      expect(result).toBe(false)
    })
  })
})
