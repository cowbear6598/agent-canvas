import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  aiDecidePromptBuilder,
  type AiDecideTargetInfo,
} from "./aiDecidePromptBuilder.js";
import { podStore } from "../podStore.js";
import { messageStore } from "../messageStore.js";
import { runStore } from "../runStore.js";
import { commandService } from "../commandService.js";
import { claudeService } from "../claude/claudeService.js";
import { executeDisposableChat } from "../disposableChatService.js";
import { summaryPromptBuilder } from "../summaryPromptBuilder.js";
import type { Connection, AiDecideModelType } from "../../types/index.js";
import type { RunContext } from "../../types/run.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errorHelpers.js";
import { getLastAssistantMessage } from "../../utils/messageHelper.js";
import { resolveExecutionPaths } from "../runtime/executionPaths.js";

export interface AiDecideResult {
  connectionId: string;
  shouldTrigger: boolean;
  reason: string;
}

export interface AiDecideBatchResult {
  results: AiDecideResult[];
  errors: Array<{ connectionId: string; error: string }>;
}

type DecisionResults = {
  decisions: Array<{
    connectionId: string;
    shouldTrigger: boolean;
    reason: string;
  }>;
};

class AiDecideService {
  private buildDecisionErrors(
    connections: Connection[],
    error: string,
  ): AiDecideBatchResult {
    return {
      results: [],
      errors: connections.map((connection) => ({
        connectionId: connection.id,
        error,
      })),
    };
  }

  private async executeDecision(
    sourcePod: NonNullable<ReturnType<typeof podStore.getById>>,
    sourceSummary: string,
    targets: AiDecideTargetInfo[],
    model: AiDecideModelType,
    runContext?: RunContext,
  ): Promise<DecisionResults | null> {
    const context = {
      sourcePodName: sourcePod.name,
      sourceSummary,
      targets,
    };
    const systemPrompt = aiDecidePromptBuilder.buildSystemPrompt();
    const userPrompt = aiDecidePromptBuilder.buildUserPrompt(context);

    const decideTriggersSchema = {
      decisions: z.array(
        z.object({
          connectionId: z.string(),
          shouldTrigger: z.boolean(),
          reason: z.string(),
        }),
      ),
    };

    let decisionResults: DecisionResults | null = null;

    const decideTriggersTool = tool(
      "decide_triggers",
      "回傳 Workflow 觸發判斷結果",
      decideTriggersSchema,
      async (params: DecisionResults) => {
        decisionResults = params;
        return { content: [{ type: "text" as const, text: "success" }] };
      },
    );

    const customServer = createSdkMcpServer({
      name: "ai-decide",
      tools: [decideTriggersTool],
    });
    const executionPaths = resolveExecutionPaths(sourcePod, runContext);

    const queryStream = claudeService.executeMcpChat({
      prompt: userPrompt,
      systemPrompt,
      mcpServers: { "ai-decide": customServer },
      allowedTools: ["mcp__ai-decide__decide_triggers"],
      model,
      cwd: executionPaths.workspacePath,
      sandboxHomePath: executionPaths.sandboxHomePath,
    });

    for await (const _sdkMessage of queryStream) {
      /* 消化 stream，等待 tool 被 SDK 呼叫 */
    }

    return decisionResults;
  }

  private mapDecisionResults(
    connections: Connection[],
    decisionResults: DecisionResults,
  ): AiDecideBatchResult {
    const results: AiDecideResult[] = [];
    const errors: Array<{ connectionId: string; error: string }> = [];

    // 先用 connectionId 為 key 建立 Map，避免對每條 connection 都線性掃描 decisions（O(n²) → O(n+m)）
    const decisionMap = new Map(
      decisionResults.decisions.map((d) => [d.connectionId, d]),
    );

    for (const connection of connections) {
      const decision = decisionMap.get(connection.id);
      if (decision) {
        results.push({
          connectionId: connection.id,
          shouldTrigger: decision.shouldTrigger,
          reason: decision.reason,
        });
      } else {
        errors.push({
          connectionId: connection.id,
          error: "此連線未獲得 AI 決策結果",
        });
      }
    }

    return { results, errors };
  }

  private async validateDecisionInput(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<
    | {
        valid: true;
        sourcePod: NonNullable<ReturnType<typeof podStore.getById>>;
        sourceSummary: string;
        targets: AiDecideTargetInfo[];
      }
    | { valid: false; error: AiDecideBatchResult }
  > {
    // 先查詢 sourcePod，傳入 generateSourceSummary 避免重複查詢
    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) {
      return {
        valid: false,
        error: this.buildDecisionErrors(connections, "找不到來源 Pod"),
      };
    }

    // group 是依 aiDecideModel 分組而來，同組內的 summaryModel 語意上屬於各自 connection。
    // 此處摘要僅用於輔助 AI 決策，非傳送給 target Pod，因此取第一筆作為代表值
    // 是刻意的設計選擇：group-level 摘要品質差異可忽略，無需逐條拆開呼叫。
    const groupSummaryModel = connections[0]?.summaryModel ?? "sonnet";
    const sourceSummary = await this.generateSourceSummary(
      sourcePod,
      runContext,
      groupSummaryModel,
    );
    if (!sourceSummary) {
      return {
        valid: false,
        error: this.buildDecisionErrors(connections, "無法生成來源 Pod 摘要"),
      };
    }

    const targets = await this.buildTargetInfos(canvasId, connections);
    if (targets.length === 0) {
      return {
        valid: false,
        error: this.buildDecisionErrors(connections, "找不到有效的目標 Pod"),
      };
    }

    return { valid: true, sourcePod, sourceSummary, targets };
  }

  private validateDecisionResults(
    results: DecisionResults | null,
    connections: Connection[],
  ):
    | { valid: true; results: DecisionResults }
    | { valid: false; error: AiDecideBatchResult } {
    if (!results) {
      logger.error(
        "Workflow",
        "Error",
        "[AiDecideService] Custom Tool handler 未被呼叫",
      );
      return {
        valid: false,
        error: this.buildDecisionErrors(connections, "AI 決策工具未被執行"),
      };
    }

    if (!results.decisions || !Array.isArray(results.decisions)) {
      logger.error("Workflow", "Error", "[AiDecideService] 決策結果格式無效");
      return {
        valid: false,
        error: this.buildDecisionErrors(connections, "AI 決策結果格式無效"),
      };
    }

    return { valid: true, results };
  }

  async decideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<AiDecideBatchResult> {
    if (connections.length === 0) {
      return { results: [], errors: [] };
    }

    // 依 aiDecideModel 分組以支援同一決策迴圈內不同 connection 用不同模型
    const groupByModel = new Map<AiDecideModelType, Connection[]>();
    for (const connection of connections) {
      const model = connection.aiDecideModel;
      const group = groupByModel.get(model) ?? [];
      group.push(connection);
      groupByModel.set(model, group);
    }

    const allResults: AiDecideResult[] = [];
    const allErrors: Array<{ connectionId: string; error: string }> = [];

    for (const [model, groupConnections] of groupByModel) {
      const inputValidation = await this.validateDecisionInput(
        canvasId,
        sourcePodId,
        groupConnections,
        runContext,
      );
      if (!inputValidation.valid) {
        allErrors.push(...inputValidation.error.errors);
        continue;
      }

      const { sourcePod, sourceSummary, targets } = inputValidation;

      let decisionResults: DecisionResults | null = null;
      try {
        decisionResults = await this.executeDecision(
          sourcePod,
          sourceSummary,
          targets,
          model,
          runContext,
        );
      } catch (error) {
        logger.error(
          "Workflow",
          "Error",
          `[AiDecideService] Claude API 請求失敗（模型：${model}）`,
          error,
        );
        allErrors.push(
          ...this.buildDecisionErrors(groupConnections, getErrorMessage(error))
            .errors,
        );
        continue;
      }

      const resultValidation = this.validateDecisionResults(
        decisionResults,
        groupConnections,
      );
      if (!resultValidation.valid) {
        allErrors.push(...resultValidation.error.errors);
        continue;
      }

      const groupBatchResult = this.mapDecisionResults(
        groupConnections,
        resultValidation.results,
      );
      allResults.push(...groupBatchResult.results);
      allErrors.push(...groupBatchResult.errors);
    }

    return { results: allResults, errors: allErrors };
  }

  private async resolveTargetPodResources(
    targetPod: NonNullable<ReturnType<typeof podStore.getById>>,
    conn: Connection,
  ): Promise<AiDecideTargetInfo> {
    const targetPodCommand = targetPod.commandId
      ? await commandService.getContent(targetPod.commandId)
      : null;

    return {
      connectionId: conn.id,
      targetPodId: conn.targetPodId,
      targetPodName: targetPod.name,
      targetPodCommand,
    };
  }

  private async buildTargetInfos(
    canvasId: string,
    connections: Connection[],
  ): Promise<AiDecideTargetInfo[]> {
    const results = await Promise.all(
      connections.map(async (connection) => {
        const targetPod = podStore.getById(canvasId, connection.targetPodId);
        if (!targetPod) {
          logger.log(
            "Workflow",
            "Update",
            `[AiDecideService] 找不到目標 Pod ${connection.targetPodId}`,
          );
          return null;
        }

        return this.resolveTargetPodResources(targetPod, connection);
      }),
    );

    return results.filter(
      (target): target is AiDecideTargetInfo => target !== null,
    );
  }

  private async generateSourceSummary(
    sourcePod: NonNullable<ReturnType<typeof podStore.getById>>,
    runContext?: RunContext,
    summaryModel?: string,
  ): Promise<string | null> {
    const sourcePodId = sourcePod.id;

    const messages = runContext
      ? runStore.getRunMessages(runContext.runId, sourcePodId)
      : messageStore.getMessages(sourcePodId);
    if (messages.length === 0) return null;

    const conversationHistory =
      summaryPromptBuilder.formatConversationHistory(messages);

    const systemPrompt = aiDecidePromptBuilder.buildSourceSummarySystemPrompt();
    const userPrompt = aiDecidePromptBuilder.buildSourceSummaryUserPrompt({
      podName: sourcePod.name,
      conversationHistory,
    });
    const executionPaths = resolveExecutionPaths(sourcePod, runContext);

    const result = await executeDisposableChat({
      provider: "claude",
      systemPrompt,
      userMessage: userPrompt,
      workspacePath: executionPaths.workspacePath,
      sandboxHomePath: executionPaths.sandboxHomePath,
      model: summaryModel ?? "sonnet",
    });

    if (!result.success) {
      logger.log(
        "Workflow",
        "Update",
        `[AiDecideService] 生成摘要失敗，使用備用內容`,
      );
      if (runContext) {
        const lastAssistant = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        return lastAssistant?.content ?? null;
      }
      return getLastAssistantMessage(sourcePodId);
    }

    return result.content;
  }
}

export const aiDecideService = new AiDecideService();
