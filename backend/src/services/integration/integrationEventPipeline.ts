import type { Pod } from '../../types/index.js';
import { podStore } from '../podStore.js';
import { executeStreamingChat } from '../claude/streamingChatExecutor.js';
import { logger } from '../../utils/logger.js';
import { createPostChatCompleteCallback } from '../../utils/operationHelpers.js';
import { autoClearService } from '../autoClear/index.js';
import { workflowExecutionService } from '../workflow/index.js';
import { shouldSendBusyReply } from '../../utils/busyChatManager.js';
import { isWorkflowChainBusy } from '../../utils/workflowChainTraversal.js';
import { integrationRegistry } from './integrationRegistry.js';
import type { NormalizedEvent } from './types.js';
import { isPodBusy } from '../../types/index.js';
import { injectUserMessage } from '../../utils/chatHelpers.js';

class IntegrationEventPipeline {
  private busyReplyCooldowns = new Map<string, number>();

  async processEvent(provider: string, appId: string, event: NormalizedEvent): Promise<void> {
    const boundPods = podStore.findByIntegrationAppAndResource(appId, event.resourceId);

    if (boundPods.length === 0) {
      logger.log('Integration', 'Complete', `[IntegrationEventPipeline] 找不到綁定 App ${appId} 和 Resource ${event.resourceId} 的 Pod`);
      return;
    }

    if (this.isResourceBusy(appId, event.resourceId)) {
      const cooldownKey = `${appId}:${event.resourceId}`;
      if (shouldSendBusyReply(this.busyReplyCooldowns, cooldownKey)) {
        const integrationProvider = integrationRegistry.get(provider);
        if (integrationProvider?.sendMessage) {
          await integrationProvider.sendMessage(appId, event.resourceId, '目前忙碌中，請稍後再試');
        }
      }
      return;
    }

    const results = await Promise.allSettled(
      boundPods.map(({ canvasId, pod }) => this.processBoundPod(canvasId, pod, event))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const pod = boundPods[i].pod;
        logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${pod.name}」處理 Integration 訊息失敗`, result.reason);
      }
    }
  }

  private isResourceBusy(appId: string, resourceId: string): boolean {
    const boundPods = podStore.findByIntegrationAppAndResource(appId, resourceId);
    return boundPods.some(({ canvasId, pod }) =>
      isPodBusy(pod.status) || isWorkflowChainBusy(canvasId, pod.id)
    );
  }

  private async processBoundPod(canvasId: string, pod: Pod, event: NormalizedEvent): Promise<void> {
    if (isPodBusy(pod.status)) return;

    if (pod.status === 'error') {
      podStore.setStatus(canvasId, pod.id, 'idle');
    }

    await this.injectMessage(canvasId, pod.id, event);
  }

  private async injectMessage(canvasId: string, podId: string, event: NormalizedEvent): Promise<void> {
    // 二次確認 Pod 狀態，防止並發事件穿透
    const currentPod = podStore.getById(canvasId, podId);
    if (currentPod && isPodBusy(currentPod.status)) {
      logger.log('Integration', 'Complete', `Pod「${currentPod.name}」已在忙碌中，跳過注入`);
      return;
    }

    const podName = currentPod?.name ?? podId;

    await injectUserMessage({ canvasId, podId, content: event.text });

    logger.log('Integration', 'Complete', `[IntegrationEventPipeline] 注入 ${event.provider} 訊息至 Pod「${podName}」`);

    const onComplete = createPostChatCompleteCallback(
      (cId, pId) => autoClearService.onPodComplete(cId, pId),
      (cId, pId) => workflowExecutionService.checkAndTriggerWorkflows(cId, pId),
      'Integration'
    );

    try {
      await executeStreamingChat(
        { canvasId, podId, message: event.text, abortable: false },
        { onComplete }
      );
    } catch (error) {
      podStore.setStatus(canvasId, podId, 'error');
      logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${podName}」注入 ${event.provider} 訊息失敗`, error);
      throw error;
    }
  }
}

export const integrationEventPipeline = new IntegrationEventPipeline();
