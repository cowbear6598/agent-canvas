import { describe, it, expect } from 'vitest'
import {
  collectBoundNotesFromStore,
  collectSelectedPods,
  collectRelatedConnections,
  createUnboundNoteCollector,
} from '@/composables/canvas/copyPaste/collectCopyData'
import type { SelectableElement } from '@/types'

describe('collectCopyData', () => {
  describe('collectBoundNotesFromStore', () => {
    it('只回傳 boundToPodId 符合的 note', () => {
      const store = {
        notes: [
          { id: 'n1', boundToPodId: 'pod-1', name: 'Note 1' },
          { id: 'n2', boundToPodId: 'pod-2', name: 'Note 2' },
          { id: 'n3', boundToPodId: 'pod-1', name: 'Note 3' },
        ],
      }

      const result = collectBoundNotesFromStore('pod-1', store, note => note)

      expect(result).toHaveLength(2)
      expect(result.map(n => n.id)).toEqual(['n1', 'n3'])
    })

    it('store 為空時應回傳空陣列', () => {
      const store = { notes: [] }

      const result = collectBoundNotesFromStore('pod-1', store, note => note)

      expect(result).toEqual([])
    })
  })

  describe('collectSelectedPods', () => {
    it('selectedElements 中只處理 type === "pod" 的元素', () => {
      const pods = [
        {
          id: 'pod-1',
          name: 'Pod 1',
          color: '#fff',
          x: 0,
          y: 0,
          rotation: 0,
          outputStyleId: null,
          skillIds: [],
          subAgentIds: [],
          model: 'claude-sonnet-4-6',
          repositoryId: null,
          commandId: null,
        },
      ]

      const selectedElements: SelectableElement[] = [
        { type: 'pod', id: 'pod-1' },
        { type: 'skillNote', id: 'note-1' },
        { type: 'outputStyleNote', id: 'note-2' },
      ]

      const result = collectSelectedPods(selectedElements, pods as any)

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('pod-1')
    })
  })

  describe('collectRelatedConnections', () => {
    const connections = [
      {
        id: 'conn-1',
        sourcePodId: 'pod-1',
        targetPodId: 'pod-2',
        sourceAnchor: 'bottom',
        targetAnchor: 'top',
        triggerMode: 'auto',
      },
      {
        id: 'conn-2',
        sourcePodId: 'pod-1',
        targetPodId: 'pod-3',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        triggerMode: 'auto',
      },
    ]

    it('只複製兩端 Pod 都被選中的 Connection', () => {
      const selectedPodIds = new Set(['pod-1', 'pod-2'])

      const result = collectRelatedConnections(selectedPodIds, connections as any)

      expect(result).toHaveLength(1)
      expect(result[0]!.sourcePodId).toBe('pod-1')
      expect(result[0]!.targetPodId).toBe('pod-2')
    })

    it('只有單端 Pod 被選中時不應複製該 Connection', () => {
      const selectedPodIds = new Set(['pod-1'])

      const result = collectRelatedConnections(selectedPodIds, connections as any)

      expect(result).toHaveLength(0)
    })
  })

  describe('createUnboundNoteCollector', () => {
    it('note 不存在時應回傳 null', () => {
      const store = { notes: [] }
      const collector = createUnboundNoteCollector(store, note => note)

      const result = collector('non-existent-id')

      expect(result).toBeNull()
    })

    it('note 存在且未綁定時應回傳 mapFn 結果', () => {
      const note = { id: 'note-1', boundToPodId: null, name: 'Test Note' }
      const store = { notes: [note] }
      const collector = createUnboundNoteCollector(store, n => ({ id: n.id, name: n.name }))

      const result = collector('note-1')

      expect(result).toEqual({ id: 'note-1', name: 'Test Note' })
    })

    it('note 存在但已綁定時應回傳 null', () => {
      const note = { id: 'note-1', boundToPodId: 'pod-1', name: 'Test Note' }
      const store = { notes: [note] }
      const collector = createUnboundNoteCollector(store, n => n)

      const result = collector('note-1')

      expect(result).toBeNull()
    })
  })
})
