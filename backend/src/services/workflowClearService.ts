import { connectionStore } from './connectionStore.js';
import { podStore } from './podStore.js';
import { messageStore } from './messageStore.js';
import { pendingTargetStore } from './pendingTargetStore.js';
import { directTriggerStore } from './directTriggerStore.js';
import { logger } from '../utils/logger.js';
import { safeExecuteAsync } from '../utils/operationHelpers.js';
import type { Connection } from '../types/index.js';

function enqueueUnvisitedTargets(
  connections: Connection[],
  visited: Set<string>,
  queue: string[]
): void {
  for (const connection of connections) {
    const targetPodId = connection.targetPodId;
    if (!visited.has(targetPodId)) {
      visited.add(targetPodId);
      queue.push(targetPodId);
    }
  }
}

interface ClearResult {
  success: boolean;
  clearedPodIds: string[];
  clearedPodNames: string[];
  clearedConnectionIds: string[];
  error?: string;
}

interface ClearSinglePodResult {
  podName: string;
  clearedConnectionIds: string[];
}

class WorkflowClearService {
  getDownstreamPodIds(canvasId: string, sourcePodId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [sourcePodId];
    visited.add(sourcePodId);

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) break;
      const connections = connectionStore.findBySourcePodId(canvasId, currentId);
      enqueueUnvisitedTargets(connections, visited, queue);
    }

    return Array.from(visited);
  }

  getDownstreamPods(canvasId: string, sourcePodId: string): Array<{ id: string; name: string }> {
    const podIds = this.getDownstreamPodIds(canvasId, sourcePodId);
    const pods: Array<{ id: string; name: string }> = [];

    for (const podId of podIds) {
      const pod = podStore.getById(canvasId, podId);
      if (pod) {
        pods.push({
          id: pod.id,
          name: pod.name,
        });
      }
    }

    return pods;
  }

  async clearWorkflow(canvasId: string, sourcePodId: string): Promise<ClearResult> {
    const podIds = this.getDownstreamPodIds(canvasId, sourcePodId);
    const clearedPodNames: string[] = [];
    const clearedConnectionIds: string[] = [];

    for (const podId of podIds) {
      const clearResult = await safeExecuteAsync(() => this.clearSinglePod(canvasId, podId));
      if (!clearResult.success) {
        logger.error('AutoClear', 'Error', `[WorkflowClear] 清除 Pod ${podId} 失敗：${clearResult.error}`);
        continue;
      }

      const result = clearResult.data;
      if (result) {
        clearedPodNames.push(result.podName);
        clearedConnectionIds.push(...result.clearedConnectionIds);
      }
    }

    return {
      success: true,
      clearedPodIds: podIds,
      clearedPodNames,
      clearedConnectionIds,
    };
  }

  private async clearSinglePod(
    canvasId: string,
    podId: string,
  ): Promise<ClearSinglePodResult | null> {
    const pod = podStore.getById(canvasId, podId);
    if (!pod) return null;

    messageStore.clearMessages(podId);
    podStore.resetClaudeSession(canvasId, podId);

    const clearedConnectionIds = this.clearAiDecideConnections(canvasId, podId);

    pendingTargetStore.clearPendingTarget(podId);
    directTriggerStore.clearDirectPending(podId);

    return { podName: pod.name, clearedConnectionIds };
  }

  private clearAiDecideConnections(canvasId: string, podId: string): string[] {
    const outgoingConnections = connectionStore.findBySourcePodId(canvasId, podId);
    const clearedConnectionIds: string[] = [];

    for (const conn of outgoingConnections) {
      if (conn.triggerMode === 'ai-decide' && conn.decideStatus !== 'none') {
        connectionStore.updateDecideStatus(canvasId, conn.id, 'none', null);
        connectionStore.updateConnectionStatus(canvasId, conn.id, 'idle');
        clearedConnectionIds.push(conn.id);
      }
    }

    return clearedConnectionIds;
  }
}

export const workflowClearService = new WorkflowClearService();
