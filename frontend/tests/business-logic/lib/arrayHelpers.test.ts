import { describe, it, expect } from 'vitest'
import { removeById } from '@/lib/arrayHelpers'

describe('arrayHelpers', () => {
    describe('removeById', () => {
        it('存在時應移除該元素並回傳新陣列', () => {
            const items = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }]
            const result = removeById(items, '2')
            expect(result).toHaveLength(2)
            expect(result.find(item => item.id === '2')).toBeUndefined()
        })

        it('不存在時應回傳相同內容的新陣列', () => {
            const items = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }]
            const result = removeById(items, '999')
            expect(result).toHaveLength(2)
            expect(result).toEqual(items)
        })

        it('應回傳新陣列而非修改原陣列', () => {
            const items = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }]
            const result = removeById(items, '1')
            expect(result).not.toBe(items)
            expect(items).toHaveLength(2)
        })

        it('空陣列時應回傳空陣列', () => {
            const items: { id: string; name: string }[] = []
            const result = removeById(items, '1')
            expect(result).toHaveLength(0)
        })

        it('移除唯一元素後應回傳空陣列', () => {
            const items = [{ id: '1', name: 'A' }]
            const result = removeById(items, '1')
            expect(result).toHaveLength(0)
        })
    })
})
