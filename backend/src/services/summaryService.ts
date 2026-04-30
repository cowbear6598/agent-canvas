import { executeDisposableChat } from "./disposableChatService.js";
import { summaryPromptBuilder } from "./summaryPromptBuilder.js";
import { podStore } from "./podStore.js";
import { messageStore } from "./messageStore.js";
import { runStore } from "./runStore.js";
import { commandService } from "./commandService.js";
import { logger } from "../utils/logger.js";
import { getLastAssistantMessage } from "../utils/messageHelper.js";
import type { Pod, PersistedMessage } from "../types/index.js";
import type { RunContext } from "../types/run.js";
import type { ProviderName } from "./provider/index.js";

interface TargetSummaryResult {
  targetPodId: string;
  summary: string;
  success: boolean;
  error?: string;
  /** 實際使用的模型名稱（disposableChatService 成功時才有值，可能因 fallback 與輸入不同） */
  resolvedModel?: string;
}

async function buildSummaryContext(
  sourcePod: Pod,
  targetPod: Pod,
  messages: PersistedMessage[],
): Promise<{
  sourcePodName: string;
  targetPodName: string;
  targetPodCommand: string | null;
  conversationHistory: string;
}> {
  const targetPodCommand = targetPod.commandId
    ? await commandService.getContent(targetPod.commandId)
    : null;

  const conversationHistory =
    summaryPromptBuilder.formatConversationHistory(messages);

  return {
    sourcePodName: sourcePod.name,
    targetPodName: targetPod.name,
    targetPodCommand,
    conversationHistory,
  };
}

class SummaryService {
  /**
   * 從 fallback 路徑取得最後一則 assistant 訊息。
   * AI 呼叫失敗時使用，避免整個摘要流程中斷。
   *
   * @param sourcePodId - 來源 Pod ID
   * @param messages - 已取得的訊息列表（避免重複 I/O）
   * @param runContext - 若為 run 模式，從 run 訊息中取；否則從全域訊息取
   */
  private resolveFallbackSummary(
    sourcePodId: string,
    messages: PersistedMessage[],
    runContext?: RunContext,
  ): string | null {
    if (runContext) {
      let lastAssistant: PersistedMessage | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAssistant = messages[i];
          break;
        }
      }
      return lastAssistant?.content ?? null;
    }
    return getLastAssistantMessage(sourcePodId);
  }

  async generateSummaryForTarget(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    provider: ProviderName,
    summaryModel: string,
    runContext?: RunContext,
  ): Promise<TargetSummaryResult> {
    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) {
      logger.error(
        "Workflow",
        "Error",
        `[SummaryService] 來源 Pod 不存在（id: ${sourcePodId}）`,
      );
      return {
        targetPodId,
        summary: "",
        success: false,
        error: "來源 Pod 不存在",
      };
    }

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      logger.error(
        "Workflow",
        "Error",
        `[SummaryService] 目標 Pod 不存在（id: ${targetPodId}）`,
      );
      return {
        targetPodId,
        summary: "",
        success: false,
        error: "目標 Pod 不存在",
      };
    }

    const messages = runContext
      ? runStore.getRunMessages(runContext.runId, sourcePodId)
      : messageStore.getMessages(sourcePodId);
    if (messages.length === 0) {
      logger.error(
        "Workflow",
        "Error",
        `[SummaryService] 來源 Pod 沒有訊息記錄（id: ${sourcePodId}）`,
      );
      return {
        targetPodId,
        summary: "",
        success: false,
        error: "來源 Pod 沒有可用訊息記錄",
      };
    }

    const context = await buildSummaryContext(sourcePod, targetPod, messages);
    const systemPrompt = summaryPromptBuilder.buildSystemPrompt();
    const userPrompt = summaryPromptBuilder.buildUserPrompt(context);

    const result = await executeDisposableChat({
      provider,
      model: summaryModel,
      systemPrompt,
      userMessage: userPrompt,
      workspacePath: sourcePod.workspacePath,
    });

    if (!result.success) {
      const rawError = result.error ?? "";
      // 截斷到 512 字並將換行轉為 ↩，防止子服務錯誤詳情破版或洩漏過多資訊
      const truncatedError = rawError.replace(/\r?\n/g, " ↩ ").slice(0, 512);
      logger.error(
        "Workflow",
        "Error",
        `[SummaryService] 無法為目標 Pod 生成摘要（provider: ${provider}，model: ${summaryModel}，targetPodId: ${targetPodId}）：${truncatedError}`,
      );

      // fallback 到上游最後一則 Assistant 訊息（重用已取得的 messages，避免重複 I/O）
      const fallbackContent = this.resolveFallbackSummary(
        sourcePodId,
        messages,
        runContext,
      );

      if (fallbackContent !== null) {
        return { targetPodId, summary: fallbackContent, success: true };
      }

      return {
        targetPodId,
        summary: "",
        success: false,
        error: result.error ?? "",
      };
    }

    return {
      targetPodId,
      summary: result.content,
      success: true,
      resolvedModel: result.resolvedModel,
    };
  }
}

export const summaryService = new SummaryService();
