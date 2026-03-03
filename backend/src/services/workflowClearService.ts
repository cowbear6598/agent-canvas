import { connectionStore } from './connectionStore.js';
import { podStore } from './podStore.js';
import { messageStore } from './messageStore.js';
import { chatPersistenceService } from './persistence/chatPersistence.js';
import { canvasStore } from './canvasStore.js';
import { pendingTargetStore } from './pendingTargetStore.js';
import { directTriggerStore } from './directTriggerStore.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/errorHelpers.js';

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
      const currentPodId = queue.shift()!;

      const connections = connectionStore.findBySourcePodId(canvasId, currentPodId);

      for (const connection of connections) {
        const targetPodId = connection.targetPodId;

        if (!visited.has(targetPodId)) {
          visited.add(targetPodId);
          queue.push(targetPodId);
        }
      }
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
    const canvasDir = canvasStore.getCanvasDir(canvasId);
    if (!canvasDir) {
      return {
        success: false,
        clearedPodIds: [],
        clearedPodNames: [],
        clearedConnectionIds: [],
        error: `找不到 Canvas：${canvasId}`,
      };
    }

    try {
      const podIds = this.getDownstreamPodIds(canvasId, sourcePodId);
      const clearedPodNames: string[] = [];
      const clearedConnectionIds: string[] = [];

      for (const podId of podIds) {
        const result = await this.clearSinglePod(canvasId, podId, canvasDir);
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
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('AutoClear', 'Error', `[WorkflowClear] 清除 Workflow 失敗：${errorMessage}`);

      return {
        success: false,
        clearedPodIds: [],
        clearedPodNames: [],
        clearedConnectionIds: [],
        error: errorMessage,
      };
    }
  }

  private async clearSinglePod(
    canvasId: string,
    podId: string,
    canvasDir: string,
  ): Promise<ClearSinglePodResult | null> {
    const pod = podStore.getById(canvasId, podId);
    if (!pod) return null;

    messageStore.clearMessages(podId);

    const clearResult = await chatPersistenceService.clearChatHistory(canvasDir, podId);
    if (!clearResult.success) {
      logger.error('AutoClear', 'Error', `[WorkflowClear] 清除 Pod ${podId} 的聊天紀錄時發生錯誤：${clearResult.error}`);
    }

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
