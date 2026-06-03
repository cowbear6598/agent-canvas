import { executeDisposableChat } from "./disposableChatService.js";
import { summaryPromptBuilder } from "./summaryPromptBuilder.js";
import { podStore } from "./podStore.js";
import {
  formatGoalTodos,
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
} from "./goalRuntime.js";
import { getDefaultThinkingLevel } from "./pod/providerConfigResolver.js";
import { getRunTranscriptWindow } from "./workflow/runTranscriptWindow.js";
import { logger } from "../utils/logger.js";
import type { Pod } from "../types/index.js";
import type { PersistedMessage } from "../types/persistence.js";
import type { RunContext } from "../types/run.js";
import type { ProviderName } from "./provider/index.js";
import { resolveExecutionPaths } from "./runtime/executionPaths.js";

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
  runContext: RunContext,
  persistedSummary: string | null,
  recentMessages: PersistedMessage[],
): Promise<{
  sourcePodName: string;
  targetPodName: string;
  targetPodGoal: string | null;
  persistedSummary: string | null;
  recentConversationHistory: string;
}> {
  const recentConversationHistory =
    recentMessages.length > 0
      ? summaryPromptBuilder.formatConversationHistory(recentMessages)
      : "（無最近訊息）";

  return {
    sourcePodName: sourcePod.name,
    targetPodName: targetPod.name,
    targetPodGoal: formatGoalTodos(
      readGoalRuntimeSnapshot(getGoalRuntimeStatePath(runContext, targetPod.id))
        ?.goal ?? targetPod.goal,
    ),
    persistedSummary,
    recentConversationHistory,
  };
}

class SummaryService {
  async generateSummaryForTarget(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    provider: ProviderName,
    summaryModel: string,
    summaryThinkingLevel: string | null,
    runContext: RunContext,
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

    const transcriptWindow = getRunTranscriptWindow(
      runContext.runId,
      sourcePodId,
      8,
    );
    if (
      transcriptWindow.recentMessages.length === 0 &&
      !transcriptWindow.persistedSummary
    ) {
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

    const context = await buildSummaryContext(
      sourcePod,
      targetPod,
      runContext,
      transcriptWindow.persistedSummary,
      transcriptWindow.recentMessages,
    );
    const systemPrompt = summaryPromptBuilder.buildSystemPrompt();
    const userPrompt = summaryPromptBuilder.buildUserPrompt(context);
    const executionPaths = resolveExecutionPaths(sourcePod, runContext);

    const result = await executeDisposableChat({
      provider,
      model: summaryModel,
      systemPrompt,
      userMessage: userPrompt,
      workspacePath: executionPaths.workspacePath,
      sourcePod,
      runContext,
      thinkingLevel:
        summaryThinkingLevel ?? getDefaultThinkingLevel(provider, summaryModel),
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
