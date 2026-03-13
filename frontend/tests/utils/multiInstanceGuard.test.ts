import { describe, it, expect, vi } from 'vitest'
import { webSocketMockFactory } from '../helpers/mockWebSocket'
import { setupStoreTest, mockToastFactory } from '../helpers/testSetup'
import { usePodStore } from '@/stores/pod/podStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { createMockPod, createMockConnection } from '../helpers/factories'
import {
  isMultiInstanceSourcePod,
  isMultiInstanceChainPod,
  getMultiInstanceSourcePodId,
} from '@/utils/multiInstanceGuard'

vi.mock('@/services/websocket', () => webSocketMockFactory())
vi.mock('@/composables/useToast', () => mockToastFactory())
vi.mock('@/utils/errorSanitizer', () => ({
  sanitizeErrorForUser: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message
    return '未知錯誤'
  }),
}))
vi.mock('@/composables/useCanvasWebSocketAction', () => ({
  useCanvasWebSocketAction: () => ({
    executeAction: vi.fn(),
  }),
}))

describe('multiInstanceGuard', () => {
  setupStoreTest()

  describe('isMultiInstanceSourcePod', () => {
    it('有 multiInstance 且無上游連線的 source pod 應回傳 true', () => {
      const podStore = usePodStore()
      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      podStore.pods = [sourcePod]

      expect(isMultiInstanceSourcePod('source-pod')).toBe(true)
    })

    it('有 multiInstance 但有上游連線的下游 pod 應回傳 false', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const upstreamPod = createMockPod({ id: 'upstream-pod' })
      const downstreamPod = createMockPod({ id: 'downstream-pod', multiInstance: true })
      podStore.pods = [upstreamPod, downstreamPod]

      const connection = createMockConnection({
        sourcePodId: 'upstream-pod',
        targetPodId: 'downstream-pod',
      })
      connectionStore.connections = [connection]

      expect(isMultiInstanceSourcePod('downstream-pod')).toBe(false)
    })

    it('multiInstance 為 false 的 pod 應回傳 false', () => {
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'normal-pod', multiInstance: false })
      podStore.pods = [pod]

      expect(isMultiInstanceSourcePod('normal-pod')).toBe(false)
    })

    it('不存在的 pod 應回傳 false', () => {
      expect(isMultiInstanceSourcePod('non-existent-pod')).toBe(false)
    })
  })

  describe('isMultiInstanceChainPod', () => {
    it('直接下游 pod 屬於 multi-instance chain 應回傳 true', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      const downstreamPod = createMockPod({ id: 'downstream-pod' })
      podStore.pods = [sourcePod, downstreamPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'downstream-pod' }),
      ]

      expect(isMultiInstanceChainPod('downstream-pod')).toBe(true)
    })

    it('多層下游 pod 屬於 multi-instance chain 應回傳 true', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      const middlePod = createMockPod({ id: 'middle-pod' })
      const tailPod = createMockPod({ id: 'tail-pod' })
      podStore.pods = [sourcePod, middlePod, tailPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'middle-pod' }),
        createMockConnection({ sourcePodId: 'middle-pod', targetPodId: 'tail-pod' }),
      ]

      expect(isMultiInstanceChainPod('tail-pod')).toBe(true)
    })

    it('獨立 pod 應回傳 false', () => {
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'independent-pod' })
      podStore.pods = [pod]

      expect(isMultiInstanceChainPod('independent-pod')).toBe(false)
    })

    it('非 multi-instance 的 workflow pod 應回傳 false', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: false })
      const downstreamPod = createMockPod({ id: 'downstream-pod' })
      podStore.pods = [sourcePod, downstreamPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'downstream-pod' }),
      ]

      expect(isMultiInstanceChainPod('downstream-pod')).toBe(false)
    })

    it('source pod 本身應回傳 false（自身無上游連線可達 multi-instance source）', () => {
      const podStore = usePodStore()
      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      podStore.pods = [sourcePod]

      expect(isMultiInstanceChainPod('source-pod')).toBe(false)
    })
  })

  describe('getMultiInstanceSourcePodId', () => {
    it('應回傳對應的 source pod ID', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      const downstreamPod = createMockPod({ id: 'downstream-pod' })
      podStore.pods = [sourcePod, downstreamPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'downstream-pod' }),
      ]

      expect(getMultiInstanceSourcePodId('downstream-pod')).toBe('source-pod')
    })

    it('多層下游應回傳最上游的 source pod ID', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: true })
      const middlePod = createMockPod({ id: 'middle-pod' })
      const tailPod = createMockPod({ id: 'tail-pod' })
      podStore.pods = [sourcePod, middlePod, tailPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'middle-pod' }),
        createMockConnection({ sourcePodId: 'middle-pod', targetPodId: 'tail-pod' }),
      ]

      expect(getMultiInstanceSourcePodId('tail-pod')).toBe('source-pod')
    })

    it('找不到 multi-instance chain 時應回傳 null', () => {
      const podStore = usePodStore()
      const pod = createMockPod({ id: 'independent-pod' })
      podStore.pods = [pod]

      expect(getMultiInstanceSourcePodId('independent-pod')).toBeNull()
    })

    it('非 multi-instance workflow 的下游 pod 應回傳 null', () => {
      const podStore = usePodStore()
      const connectionStore = useConnectionStore()

      const sourcePod = createMockPod({ id: 'source-pod', multiInstance: false })
      const downstreamPod = createMockPod({ id: 'downstream-pod' })
      podStore.pods = [sourcePod, downstreamPod]

      connectionStore.connections = [
        createMockConnection({ sourcePodId: 'source-pod', targetPodId: 'downstream-pod' }),
      ]

      expect(getMultiInstanceSourcePodId('downstream-pod')).toBeNull()
    })
  })
})
