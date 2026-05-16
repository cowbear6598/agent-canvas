import type { Pod } from "../../types/index.js";
import { podStore } from "../podStore.js";
import { logger } from "../../utils/logger.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import { integrationRegistry } from "./integrationRegistry.js";
import type { NormalizedEvent } from "./types.js";
import { shouldFilterJiraEvent } from "./providers/jiraProvider.js";
import { launchRun } from "../../utils/runChatHelpers.js";
import { onRunChatComplete } from "../../utils/chatCallbacks.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import {
  replyContextStore,
  buildReplyContextKey,
  setReplyContextIfPresent,
} from "./replyContextStore.js";

/**
 * Integration event.text 長度上限（字元數）。
 * 超過此限制時截斷並記 log warning，避免惡意長訊息灌版或佔用 LLM context window。
 */
const MAX_EVENT_TEXT_LENGTH = 8000;

/**
 * 依 Provider 與 eventFilter 過濾綁定的 Pod 清單。
 * 目前僅 Jira 需要特殊過濾邏輯；其他 Provider 直接回傳原始清單。
 */
function filterPodsByProvider(
  provider: string,
  appId: string,
  event: NormalizedEvent,
  pods: Array<{ canvasId: string; pod: Pod }>,
): Array<{ canvasId: string; pod: Pod }> {
  if (provider !== "jira") {
    return pods;
  }

  return pods.filter(({ pod }) => {
    const binding = pod.integrationBindings?.find((b) => b.appId === appId);
    const eventFilter = binding?.extra?.["eventFilter"] as string | undefined;
    return !shouldFilterJiraEvent(eventFilter, event.rawEvent);
  });
}

class IntegrationEventPipeline {
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

    // 依 Provider 的特定過濾規則（目前 Jira 依各 Pod 的 eventFilter 過濾）
    const filteredPods = filterPodsByProvider(
      provider,
      appId,
      event,
      boundPods,
    );

    if (filteredPods.length === 0) return;

    // 固定回覆「已接收到命令」
    this.replyAckOrBusy(provider, appId, event);

    // 所有 pod 一律走 multi-instance 路徑，parallel 執行
    await this.executeMultiInstancePods(filteredPods, event);
  }

  /** 固定回覆「已接收到命令」 */
  private replyAckOrBusy(
    provider: string,
    appId: string,
    event: NormalizedEvent,
  ): void {
    this.sendAckReply(provider, appId, event, "已接收到命令");
  }

  /** 執行所有 pods，不受忙碌狀態影響 */
  private async executeMultiInstancePods(
    pods: Array<{ canvasId: string; pod: Pod }>,
    event: NormalizedEvent,
  ): Promise<void> {
    if (pods.length === 0) return;
    await this.settleAndLogErrors(
      pods.map(({ canvasId, pod }) =>
        this.processBoundPod(canvasId, pod, event),
      ),
      pods,
    );
  }

  private async settleAndLogErrors(
    tasks: Promise<void>[],
    pods: Array<{ canvasId: string; pod: Pod }>,
  ): Promise<void> {
    const results = await Promise.allSettled(tasks);
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const { canvasId, pod } = pods[i];
        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        logger.error(
          "Integration",
          "Error",
          `[IntegrationEventPipeline] Pod「${pod.name}」處理 Integration 訊息失敗`,
          result.reason,
        );
        // 透過 WebSocket 廣播個別 Pod 的失敗事件，讓前端能做對應 UI 提示
        socketService.emitToCanvas(
          canvasId,
          WebSocketResponseEvents.POD_ERROR,
          {
            canvasId,
            podId: pod.id,
            success: false,
            error: errorMessage,
            code: "INTEGRATION_RUN_ERROR",
          },
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

  private async processBoundPod(
    canvasId: string,
    pod: Pod,
    event: NormalizedEvent,
  ): Promise<void> {
    await this.injectMessageAsRun(canvasId, pod.id, event);
  }

  private async injectMessageAsRun(
    canvasId: string,
    podId: string,
    event: NormalizedEvent,
  ): Promise<void> {
    // 長度上限檢查：超過 MAX_EVENT_TEXT_LENGTH 時截斷並記 warn，避免惡意長訊息灌版。
    let textToInject = event.text;
    if (textToInject.length > MAX_EVENT_TEXT_LENGTH) {
      logger.warn(
        "Integration",
        "Warn",
        `[IntegrationEventPipeline] event.text 超過長度上限（${textToInject.length} > ${MAX_EVENT_TEXT_LENGTH}），截斷後注入（provider=${event.provider}, podId=${podId}）`,
      );
      textToInject = textToInject.slice(0, MAX_EVENT_TEXT_LENGTH);
    }

    let replyKey: string | undefined;

    try {
      await launchRun({
        canvasId,
        podId,
        message: textToInject,
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
      throw error;
    } finally {
      if (replyKey) {
        replyContextStore.delete(replyKey);
      }
    }
  }
}

export const integrationEventPipeline = new IntegrationEventPipeline();
