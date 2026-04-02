import { claudeService } from "./claude/claudeService.js";
import { summaryPromptBuilder } from "./summaryPromptBuilder.js";
import { podStore } from "./podStore.js";
import { messageStore } from "./messageStore.js";
import { runStore } from "./runStore.js";
import { outputStyleService } from "./outputStyleService.js";
import { commandService } from "./commandService.js";
import { logger } from "../utils/logger.js";
import { getLastAssistantMessage } from "../utils/messageHelper.js";
import type { Pod, PersistedMessage, ModelType } from "../types/index.js";
import type { RunContext } from "../types/run.js";

interface TargetSummaryResult {
  targetPodId: string;
  summary: string;
  success: boolean;
  error?: string;
}

async function buildSummaryContext(
  sourcePod: Pod,
  targetPod: Pod,
  messages: PersistedMessage[],
): Promise<{
  sourcePodName: string;
  sourcePodOutputStyle: string | null;
  targetPodName: string;
  targetPodOutputStyle: string | null;
  targetPodCommand: string | null;
  conversationHistory: string;
}> {
  const sourcePodOutputStyle = sourcePod.outputStyleId
    ? await outputStyleService.getContent(sourcePod.outputStyleId)
    : null;

  const targetPodOutputStyle = targetPod.outputStyleId
    ? await outputStyleService.getContent(targetPod.outputStyleId)
    : null;

  const targetPodCommand = targetPod.commandId
    ? await commandService.getContent(targetPod.commandId)
    : null;

  const conversationHistory =
    summaryPromptBuilder.formatConversationHistory(messages);

  return {
    sourcePodName: sourcePod.name,
    sourcePodOutputStyle,
    targetPodName: targetPod.name,
    targetPodOutputStyle,
    targetPodCommand,
    conversationHistory,
  };
}

class SummaryService {
  async generateSummaryForTarget(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    runContext?: RunContext,
    summaryModel?: ModelType,
  ): Promise<TargetSummaryResult> {
    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) {
      return {
        targetPodId,
        summary: "",
        success: false,
        error: `找不到來源 Pod：${sourcePodId}`,
      };
    }

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      return {
        targetPodId,
        summary: "",
        success: false,
        error: `找不到目標 Pod：${targetPodId}`,
      };
    }

    const messages = runContext
      ? runStore.getRunMessages(runContext.runId, sourcePodId)
      : messageStore.getMessages(sourcePodId);
    if (messages.length === 0) {
      return {
        targetPodId,
        summary: "",
        success: false,
        error: `來源 Pod ${sourcePodId} 沒有訊息記錄`,
      };
    }

    const context = await buildSummaryContext(sourcePod, targetPod, messages);
    const systemPrompt = summaryPromptBuilder.buildSystemPrompt(
      context.sourcePodOutputStyle,
    );
    const userPrompt = summaryPromptBuilder.buildUserPrompt(context);

    const result = await claudeService.executeDisposableChat({
      systemPrompt,
      userMessage: userPrompt,
      workspacePath: sourcePod.workspacePath,
      model: summaryModel ?? "sonnet",
    });

    if (!result.success) {
      logger.error(
        "Workflow",
        "Error",
        `[SummaryService] 無法為目標 ${targetPodId} 生成摘要：${result.error ?? ""}`,
      );

      let fallbackContent: string | null;
      if (runContext) {
        const runMessages = runStore.getRunMessages(
          runContext.runId,
          sourcePodId,
        );
        const lastAssistant = [...runMessages]
          .reverse()
          .find((message) => message.role === "assistant");
        fallbackContent = lastAssistant?.content ?? null;
      } else {
        fallbackContent = getLastAssistantMessage(sourcePodId);
      }

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

    return { targetPodId, summary: result.content, success: true };
  }
}

export const summaryService = new SummaryService();
