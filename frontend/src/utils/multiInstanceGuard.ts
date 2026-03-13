import { usePodStore } from '@/stores/pod/podStore'
import { useConnectionStore } from '@/stores/connectionStore'

export function isMultiInstanceSourcePod(podId: string): boolean {
  const podStore = usePodStore()
  const connectionStore = useConnectionStore()

  const pod = podStore.getPodById(podId)
  if (!pod?.multiInstance) return false

  return connectionStore.isSourcePod(podId)
}

/**
 * 使用 BFS 往上游遍歷，找出指定 pod 所屬 multi-instance chain 的 source pod ID。
 * 需要 BFS 防止循環（visited set），並能找到任何 multi-instance source pod 就提前返回。
 */
function findUpstreamMultiInstanceSourcePodId(podId: string): string | null {
  const connectionStore = useConnectionStore()
  const podStore = usePodStore()

  const visited = new Set<string>([podId])
  const queue: string[] = [podId]

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) break

    const upstreamConnections = connectionStore.getConnectionsByTargetPodId(currentId)
    for (const connection of upstreamConnections) {
      const sourcePodId = connection.sourcePodId
      if (!sourcePodId) continue

      const sourcePod = podStore.getPodById(sourcePodId)
      if (sourcePod?.multiInstance && connectionStore.isSourcePod(sourcePodId)) {
        return sourcePodId
      }

      if (!visited.has(sourcePodId)) {
        visited.add(sourcePodId)
        queue.push(sourcePodId)
      }
    }
  }

  return null
}

export function isMultiInstanceChainPod(podId: string): boolean {
  return findUpstreamMultiInstanceSourcePodId(podId) !== null
}

export function getMultiInstanceSourcePodId(podId: string): string | null {
  return findUpstreamMultiInstanceSourcePodId(podId)
}
