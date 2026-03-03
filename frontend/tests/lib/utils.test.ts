import { describe, it, expect } from 'vitest'
import { capitalizeFirstLetter } from '@/lib/utils'

describe('capitalizeFirstLetter', () => {
  it('一般字串應將首字母大寫', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello')
  })

  it('空字串應回傳空字串', () => {
    expect(capitalizeFirstLetter('')).toBe('')
  })

  it('已是大寫的字串應保持不變', () => {
    expect(capitalizeFirstLetter('Hello')).toBe('Hello')
  })

  it('單字元字串應正常處理', () => {
    expect(capitalizeFirstLetter('a')).toBe('A')
  })
})
