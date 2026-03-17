import type { Pod } from '../../types/index.js';
import { podStore } from '../podStore.js';
import { executeStreamingChat } from '../claude/streamingChatExecutor.js';
import { logger } from '../../utils/logger.js';
import { fireAndForget } from '../../utils/operationHelpers.js';
import { workflowExecutionService } from '../workflow/index.js';
import { shouldSendBusyReply } from '../../utils/busyChatManager.js';
import { isWorkflowChainBusy } from '../../utils/workflowChainTraversal.js';
import { integrationRegistry } from './integrationRegistry.js';
import type { NormalizedEvent } from './types.js';
import { isPodBusy } from '../../types/index.js';
import { injectUserMessage } from '../../utils/chatHelpers.js';
import { launchMultiInstanceRun } from '../../utils/runChatHelpers.js';
import { onRunChatComplete } from '../../utils/chatCallbacks.js';
import { replyContextStore, buildReplyContextKey, setReplyContextIfPresent } from './replyContextStore.js';

class IntegrationEventPipeline {
  private busyReplyCooldowns = new Map<string, number>();

  safeProcessEvent(providerName: string, appId: string, event: NormalizedEvent): void {
    fireAndForget(
      this.processEvent(providerName, appId, event),
      'Integration',
      `[IntegrationEventPipeline] ${providerName} 事件處理失敗`
    );
  }

  async processEvent(provider: string, appId: string, event: NormalizedEvent): Promise<void> {
    const boundPods = event.resourceId === '*'
      ? podStore.findByIntegrationApp(appId)
      : podStore.findByIntegrationAppAndResource(appId, event.resourceId);

    if (boundPods.length === 0) {
      logger.log('Integration', 'Complete', `[IntegrationEventPipeline] 找不到綁定 App ${appId} 和 Resource ${event.resourceId} 的 Pod`);
      return;
    }

    const multiInstancePods = boundPods.filter(({ pod }) => pod.multiInstance === true);
    const normalPods = boundPods.filter(({ pod }) => pod.multiInstance !== true);

    // multiInstance pods 先獨立處理，不受忙碌狀態影響
    const multiInstancePromises = multiInstancePods.map(({ canvasId, pod }) =>
      this.processBoundPod(canvasId, pod, event)
    );

    if (normalPods.length > 0) {
      if (this.isResourceBusy(appId, event.resourceId, normalPods)) {
        const cooldownKey = `${appId}:${event.resourceId}`;
        if (shouldSendBusyReply(this.busyReplyCooldowns, cooldownKey)) {
          const integrationProvider = integrationRegistry.get(provider);
          if (integrationProvider?.sendMessage) {
            await integrationProvider.sendMessage(appId, event.resourceId, '目前忙碌中，請稍後再試');
          }
        }
      } else {
        const normalResults = await Promise.allSettled(
          normalPods.map(({ canvasId, pod }) => this.processBoundPod(canvasId, pod, event))
        );
        for (let i = 0; i < normalResults.length; i++) {
          const result = normalResults[i];
          if (result.status === 'rejected') {
            const pod = normalPods[i].pod;
            logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${pod.name}」處理 Integration 訊息失敗`, result.reason);
          }
        }
      }
    }

    const multiInstanceResults = await Promise.allSettled(multiInstancePromises);
    for (let i = 0; i < multiInstanceResults.length; i++) {
      const result = multiInstanceResults[i];
      if (result.status === 'rejected') {
        const pod = multiInstancePods[i].pod;
        logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${pod.name}」處理 Integration 訊息失敗`, result.reason);
      }
    }
  }

  private isResourceBusy(appId: string, resourceId: string, pods?: Array<{ canvasId: string; pod: Pod }>): boolean {
    const targetPods = pods ?? podStore.findByIntegrationAppAndResource(appId, resourceId);
    return targetPods.some(({ canvasId, pod }) =>
      isPodBusy(pod.status) || isWorkflowChainBusy(canvasId, pod.id)
    );
  }

  private async processBoundPod(canvasId: string, pod: Pod, event: NormalizedEvent): Promise<void> {
    if (pod.multiInstance === true) {
      await this.injectMessageAsRun(canvasId, pod.id, event);
      return;
    }

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

    const replyKey = buildReplyContextKey(undefined, podId);
    setReplyContextIfPresent(replyKey, event);

    const onComplete = async (canvasId: string, podId: string): Promise<void> => {
      fireAndForget(
        workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
        'Integration',
        `檢查 Pod「${podId}」自動觸發 Workflow 失敗`
      );
    };

    try {
      await executeStreamingChat(
        { canvasId, podId, message: event.text, abortable: false },
        { onComplete }
      );
    } catch (error) {
      podStore.setStatus(canvasId, podId, 'error');
      logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${podName}」注入 ${event.provider} 訊息失敗`, error);
      throw error;
    } finally {
      replyContextStore.delete(replyKey);
    }
  }

  private async injectMessageAsRun(canvasId: string, podId: string, event: NormalizedEvent): Promise<void> {
    let replyKey: string | undefined;

    try {
      await launchMultiInstanceRun({
        canvasId,
        podId,
        message: event.text,
        abortable: false,
        onRunContextCreated: (runContext) => {
          replyKey = buildReplyContextKey(runContext, podId);
          setReplyContextIfPresent(replyKey, event);
        },
        onComplete: (runContext) => {
          onRunChatComplete(runContext, canvasId, podId);
        },
      });
    } catch (error) {
      logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${podId}」multiInstance Run 執行失敗`, error);
    } finally {
      if (replyKey) {
        replyContextStore.delete(replyKey);
      }
    }
  }
}

export const integrationEventPipeline = new IntegrationEventPipeline();
