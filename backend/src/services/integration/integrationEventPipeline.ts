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
import { injectUserMessage, extractDisplayContent } from '../../utils/chatHelpers.js';
import { runExecutionService } from '../workflow/runExecutionService.js';
import { injectRunUserMessage } from '../../utils/runChatHelpers.js';
import { onRunChatComplete } from '../../utils/chatCallbacks.js';
import { replyContextStore, buildReplyContextKey } from './replyContextStore.js';

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
    const boundPods = podStore.findByIntegrationAppAndResource(appId, event.resourceId);

    if (boundPods.length === 0) {
      logger.log('Integration', 'Complete', `[IntegrationEventPipeline] 找不到綁定 App ${appId} 和 Resource ${event.resourceId} 的 Pod`);
      return;
    }

    const multiInstancePods = boundPods.filter(({ pod }) => pod.multiInstance === true);
    const normalPods = boundPods.filter(({ pod }) => pod.multiInstance !== true);

    // 只有 normal pods 需要檢查忙碌狀態
    if (normalPods.length > 0 && this.isResourceBusy(appId, event.resourceId, normalPods)) {
      const cooldownKey = `${appId}:${event.resourceId}`;
      if (shouldSendBusyReply(this.busyReplyCooldowns, cooldownKey)) {
        const integrationProvider = integrationRegistry.get(provider);
        if (integrationProvider?.sendMessage) {
          await integrationProvider.sendMessage(appId, event.resourceId, '目前忙碌中，請稍後再試');
        }
      }
      return;
    }

    const allPods = [...multiInstancePods, ...normalPods];
    const results = await Promise.allSettled(
      allPods.map(({ canvasId, pod }) => this.processBoundPod(canvasId, pod, event))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const pod = allPods[i].pod;
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
    if (event.senderId || event.messageTs || event.threadTs) {
      replyContextStore.set(replyKey, {
        senderId: event.senderId,
        messageTs: event.messageTs,
        threadTs: event.threadTs,
      });
    }

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
    const triggerMessage = extractDisplayContent(event.text);
    const runContext = await runExecutionService.createRun(canvasId, podId, triggerMessage);
    runExecutionService.startPodInstance(runContext, podId);
    await injectRunUserMessage(runContext, podId, event.text);

    const replyKey = buildReplyContextKey(runContext, podId);
    if (event.senderId || event.messageTs || event.threadTs) {
      replyContextStore.set(replyKey, {
        senderId: event.senderId,
        messageTs: event.messageTs,
        threadTs: event.threadTs,
      });
    }

    const onComplete = (): void => {
      onRunChatComplete(runContext, canvasId, podId);
      replyContextStore.delete(replyKey);
    };

    try {
      await executeStreamingChat(
        { canvasId, podId, message: event.text, abortable: false, runContext },
        { onComplete: (_cid, _pid) => onComplete() }
      );
    } catch (error) {
      logger.error('Integration', 'Error', `[IntegrationEventPipeline] Pod「${podId}」multiInstance Run 執行失敗`, error);
    } finally {
      replyContextStore.delete(replyKey);
    }
  }
}

export const integrationEventPipeline = new IntegrationEventPipeline();
