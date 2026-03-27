import type { Pod } from "../../types/index.js";
import { podStore } from "../podStore.js";
import { executeStreamingChat } from "../claude/streamingChatExecutor.js";
import { logger } from "../../utils/logger.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import { workflowExecutionService } from "../workflow/index.js";
import { shouldSendBusyReply } from "../../utils/busyChatManager.js";
import { isWorkflowChainBusy } from "../../utils/workflowChainTraversal.js";
import { integrationRegistry } from "./integrationRegistry.js";
import type { NormalizedEvent } from "./types.js";
import { shouldFilterJiraEvent } from "./providers/jiraProvider.js";
import { isPodBusy } from "../../types/index.js";
import {
  injectUserMessage,
  buildDisplayContentWithCommand,
} from "../../utils/chatHelpers.js";
import { launchMultiInstanceRun } from "../../utils/runChatHelpers.js";
import { onRunChatComplete } from "../../utils/chatCallbacks.js";
import {
  replyContextStore,
  buildReplyContextKey,
  setReplyContextIfPresent,
} from "./replyContextStore.js";

class IntegrationEventPipeline {
  private busyReplyCooldowns = new Map<string, number>();

  safeProcessEvent(
    providerName: string,
    appId: string,
    event: NormalizedEvent,
  ): void {
    fireAndForget(
      this.processEvent(providerName, appId, event),
      "Integration",
      `[IntegrationEventPipeline] ${providerName} 事件處理失敗`,
    );
  }

  async processEvent(
    provider: string,
    appId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    const boundPods =
      event.resourceId === "*"
        ? podStore.findByIntegrationApp(appId)
        : podStore.findByIntegrationAppAndResource(appId, event.resourceId);

    if (boundPods.length === 0) {
      logger.log(
        "Integration",
        "Complete",
        `[IntegrationEventPipeline] 找不到綁定 App ${appId} 和 Resource ${event.resourceId} 的 Pod`,
      );
      return;
    }

    // 針對 Jira 事件依各 Pod 的 eventFilter 過濾
    const filteredPods =
      provider === "jira"
        ? boundPods.filter(({ pod }) => {
            const binding = pod.integrationBindings?.find(
              (b) => b.appId === appId,
            );
            const eventFilter = binding?.extra?.["eventFilter"] as
              | string
              | undefined;
            return !shouldFilterJiraEvent(eventFilter, event.rawEvent);
          })
        : boundPods;

    if (filteredPods.length === 0) return;

    const multiInstancePods = filteredPods.filter(
      ({ pod }) => pod.multiInstance === true,
    );
    const normalPods = filteredPods.filter(
      ({ pod }) => pod.multiInstance !== true,
    );

    // 回覆確認或忙碌訊息
    this.replyAckOrBusy(provider, appId, event, normalPods, multiInstancePods);

    // 分流執行：multiInstance 不受忙碌狀態影響，normal 需檢查忙碌狀態
    // 兩者可同時啟動，透過 Promise.all 並行等待
    await Promise.all([
      this.executeMultiInstancePods(multiInstancePods, event),
      this.executeNormalPods(normalPods, appId, event),
    ]);
  }

  /** 根據忙碌狀態回覆 ack 或 busy 訊息 */
  private replyAckOrBusy(
    provider: string,
    appId: string,
    event: NormalizedEvent,
    normalPods: Array<{ canvasId: string; pod: Pod }>,
    multiInstancePods: Array<{ canvasId: string; pod: Pod }>,
  ): void {
    if (this.shouldReplyBusy(normalPods, multiInstancePods)) {
      const cooldownKey = `${appId}:${event.resourceId}`;
      if (shouldSendBusyReply(this.busyReplyCooldowns, cooldownKey)) {
        this.sendAckReply(provider, appId, event, "目前忙碌中，請稍後再試");
      }
    } else {
      this.sendAckReply(provider, appId, event, "已接收到命令");
    }
  }

  /** 執行 multiInstance pods，不受忙碌狀態影響 */
  private async executeMultiInstancePods(
    pods: Array<{ canvasId: string; pod: Pod }>,
    event: NormalizedEvent,
  ): Promise<void> {
    if (pods.length === 0) return;
    await this.settleAndLogErrors(
      pods.map(({ canvasId, pod }) =>
        this.processBoundPod(canvasId, pod, event),
      ),
      pods.map(({ pod }) => pod),
    );
  }

  /** 執行 normal pods，全部忙碌時跳過 */
  private async executeNormalPods(
    pods: Array<{ canvasId: string; pod: Pod }>,
    appId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    if (pods.length === 0) return;
    if (this.isResourceBusy(appId, event.resourceId, pods)) return;
    await this.settleAndLogErrors(
      pods.map(({ canvasId, pod }) =>
        this.processBoundPod(canvasId, pod, event),
      ),
      pods.map(({ pod }) => pod),
    );
  }

  private shouldReplyBusy(
    normalPods: Array<{ canvasId: string; pod: Pod }>,
    multiInstancePods: Array<{ canvasId: string; pod: Pod }>,
  ): boolean {
    const hasAnyNormalBusy = normalPods.some(
      ({ canvasId, pod }) =>
        isPodBusy(pod.status) || isWorkflowChainBusy(canvasId, pod.id),
    );
    return (
      normalPods.length > 0 &&
      hasAnyNormalBusy &&
      multiInstancePods.length === 0
    );
  }

  private async settleAndLogErrors(
    tasks: Promise<void>[],
    pods: Pod[],
  ): Promise<void> {
    const results = await Promise.allSettled(tasks);
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        logger.error(
          "Integration",
          "Error",
          `[IntegrationEventPipeline] Pod「${pods[i].name}」處理 Integration 訊息失敗`,
          result.reason,
        );
      }
    }
  }

  private sendAckReply(
    provider: string,
    appId: string,
    event: NormalizedEvent,
    message: string,
  ): void {
    const integrationProvider = integrationRegistry.get(provider);
    if (!integrationProvider?.sendMessage) return;

    const extra = integrationProvider.buildAckExtra?.(event) ?? {};

    const sendPromise = integrationProvider.sendMessage(
      appId,
      event.resourceId,
      message,
      extra,
    );
    sendPromise.catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn(
        "Integration",
        "Warn",
        `[IntegrationEventPipeline] 發送確認回覆失敗：${errorMessage}`,
      );
    });
  }

  private isResourceBusy(
    appId: string,
    resourceId: string,
    pods?: Array<{ canvasId: string; pod: Pod }>,
  ): boolean {
    const targetPods =
      pods ?? podStore.findByIntegrationAppAndResource(appId, resourceId);
    return targetPods.some(
      ({ canvasId, pod }) =>
        isPodBusy(pod.status) || isWorkflowChainBusy(canvasId, pod.id),
    );
  }

  private async processBoundPod(
    canvasId: string,
    pod: Pod,
    event: NormalizedEvent,
  ): Promise<void> {
    if (pod.multiInstance === true) {
      await this.injectMessageAsRun(canvasId, pod.id, event);
      return;
    }

    if (isPodBusy(pod.status)) return;

    if (pod.status === "error") {
      podStore.setStatus(canvasId, pod.id, "idle");
    }

    await this.injectMessage(canvasId, pod.id, event);
  }

  private async injectMessage(
    canvasId: string,
    podId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    // 二次確認 Pod 狀態，防止並發事件穿透
    const currentPod = podStore.getById(canvasId, podId);
    if (currentPod && isPodBusy(currentPod.status)) {
      logger.log(
        "Integration",
        "Complete",
        `Pod「${currentPod.name}」已在忙碌中，跳過注入`,
      );
      return;
    }

    if (!currentPod) return;

    const podName = currentPod.name;
    const displayText = buildDisplayContentWithCommand(
      event.text,
      currentPod.commandId ?? null,
    );

    await injectUserMessage({ canvasId, podId, content: displayText });

    logger.log(
      "Integration",
      "Complete",
      `[IntegrationEventPipeline] 注入 ${event.provider} 訊息至 Pod「${podName}」`,
    );

    const replyKey = buildReplyContextKey(undefined, podId);
    setReplyContextIfPresent(replyKey, event);

    const onComplete = async (
      canvasId: string,
      podId: string,
    ): Promise<void> => {
      fireAndForget(
        workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
        "Integration",
        `檢查 Pod「${podId}」自動觸發 Workflow 失敗`,
      );
    };

    try {
      await executeStreamingChat(
        { canvasId, podId, message: event.text, abortable: false },
        { onComplete },
      );
    } catch (error) {
      podStore.setStatus(canvasId, podId, "error");
      logger.error(
        "Integration",
        "Error",
        `[IntegrationEventPipeline] Pod「${podName}」注入 ${event.provider} 訊息失敗`,
        error,
      );
      throw error;
    } finally {
      replyContextStore.delete(replyKey);
    }
  }

  private async injectMessageAsRun(
    canvasId: string,
    podId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    let replyKey: string | undefined;
    const currentPod = podStore.getById(canvasId, podId);
    const displayMessage = buildDisplayContentWithCommand(
      event.text,
      currentPod?.commandId ?? null,
    );

    try {
      await launchMultiInstanceRun({
        canvasId,
        podId,
        message: event.text,
        displayMessage,
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
      logger.error(
        "Integration",
        "Error",
        `[IntegrationEventPipeline] Pod「${podId}」multiInstance Run 執行失敗`,
        error,
      );
    } finally {
      if (replyKey) {
        replyContextStore.delete(replyKey);
      }
    }
  }
}

export const integrationEventPipeline = new IntegrationEventPipeline();
