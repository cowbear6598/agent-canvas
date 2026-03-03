import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { aiDecidePromptBuilder, type AiDecideTargetInfo } from './aiDecidePromptBuilder.js';
import { podStore } from '../podStore.js';
import { messageStore } from '../messageStore.js';
import { outputStyleService } from '../outputStyleService.js';
import { commandService } from '../commandService.js';
import { claudeService } from '../claude/claudeService.js';
import { summaryPromptBuilder } from '../summaryPromptBuilder.js';
import type { Connection } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from '../../utils/errorHelpers.js';
import { getLastAssistantMessage } from '../../utils/messageHelper.js';

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
    error: string
  ): AiDecideBatchResult {
    return {
      results: [],
      errors: connections.map(connection => ({
        connectionId: connection.id,
        error,
      })),
    };
  }

  private async executeDecision(
    sourcePod: NonNullable<ReturnType<typeof podStore.getById>>,
    sourceSummary: string,
    targets: AiDecideTargetInfo[]
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
        })
      ),
    };

    let decisionResults: DecisionResults | null = null;

    const decideTriggersTool = tool(
      'decide_triggers',
      '回傳 Workflow 觸發判斷結果',
      decideTriggersSchema,
      async (params: DecisionResults) => {
        decisionResults = params;
        return { success: true };
      }
    );

    const customServer = createSdkMcpServer({
      name: 'ai-decide',
      tools: [decideTriggersTool],
    });

    const queryStream = claudeService.executeMcpChat({
      prompt: userPrompt,
      systemPrompt,
      mcpServers: { 'ai-decide': customServer },
      allowedTools: ['mcp__ai-decide__decide_triggers'],
      model: 'sonnet',
      cwd: sourcePod.workspacePath,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _sdkMessage of queryStream) { /* 消化 stream，等待 tool 被 SDK 呼叫 */ }

    return decisionResults;
  }

  private mapDecisionResults(
    connections: Connection[],
    decisionResults: DecisionResults
  ): AiDecideBatchResult {
    const results: AiDecideResult[] = [];
    const errors: Array<{ connectionId: string; error: string }> = [];

    for (const connection of connections) {
      const decision = decisionResults.decisions.find(decisionEntry => decisionEntry.connectionId === connection.id);
      if (decision) {
        results.push({
          connectionId: connection.id,
          shouldTrigger: decision.shouldTrigger,
          reason: decision.reason,
        });
      } else {
        errors.push({
          connectionId: connection.id,
          error: '此連線未獲得 AI 決策結果',
        });
      }
    }

    return { results, errors };
  }

  private async validateDecisionInput(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[]
  ): Promise<
    | { valid: true; sourcePod: NonNullable<ReturnType<typeof podStore.getById>>; sourceSummary: string; targets: AiDecideTargetInfo[] }
    | { valid: false; error: AiDecideBatchResult }
  > {
    const sourceSummary = await this.generateSourceSummary(canvasId, sourcePodId);
    if (!sourceSummary) {
      return { valid: false, error: this.buildDecisionErrors(connections, '無法生成來源 Pod 摘要') };
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) {
      return { valid: false, error: this.buildDecisionErrors(connections, '找不到來源 Pod') };
    }

    const targets = await this.buildTargetInfos(canvasId, connections);
    if (targets.length === 0) {
      return { valid: false, error: this.buildDecisionErrors(connections, '找不到有效的目標 Pod') };
    }

    return { valid: true, sourcePod, sourceSummary, targets };
  }

  private validateDecisionResults(
    results: DecisionResults | null,
    connections: Connection[]
  ): { valid: true; results: DecisionResults } | { valid: false; error: AiDecideBatchResult } {
    if (!results) {
      logger.error('Workflow', 'Error', '[AiDecideService] Custom Tool handler 未被呼叫');
      return { valid: false, error: this.buildDecisionErrors(connections, 'AI 決策工具未被執行') };
    }

    if (!results.decisions || !Array.isArray(results.decisions)) {
      logger.error('Workflow', 'Error', '[AiDecideService] 決策結果格式無效');
      return { valid: false, error: this.buildDecisionErrors(connections, 'AI 決策結果格式無效') };
    }

    return { valid: true, results };
  }

  async decideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[]
  ): Promise<AiDecideBatchResult> {
    if (connections.length === 0) {
      return { results: [], errors: [] };
    }

    const inputValidation = await this.validateDecisionInput(canvasId, sourcePodId, connections);
    if (!inputValidation.valid) {
      return inputValidation.error;
    }

    const { sourcePod, sourceSummary, targets } = inputValidation;

    let decisionResults: DecisionResults | null = null;
    try {
      decisionResults = await this.executeDecision(sourcePod, sourceSummary, targets);
    } catch (error) {
      logger.error('Workflow', 'Error', '[AiDecideService] Claude API 請求失敗', error);
      return this.buildDecisionErrors(connections, getErrorMessage(error));
    }

    const resultValidation = this.validateDecisionResults(decisionResults, connections);
    if (!resultValidation.valid) {
      return resultValidation.error;
    }

    return this.mapDecisionResults(connections, resultValidation.results);
  }

  private async resolveTargetPodResources(
    targetPod: NonNullable<ReturnType<typeof podStore.getById>>,
    conn: Connection
  ): Promise<AiDecideTargetInfo> {
    const targetPodOutputStyle = targetPod.outputStyleId
      ? await outputStyleService.getContent(targetPod.outputStyleId)
      : null;

    const targetPodCommand = targetPod.commandId
      ? await commandService.getContent(targetPod.commandId)
      : null;

    return {
      connectionId: conn.id,
      targetPodId: conn.targetPodId,
      targetPodName: targetPod.name,
      targetPodOutputStyle,
      targetPodCommand,
    };
  }

  private async buildTargetInfos(
    canvasId: string,
    connections: Connection[]
  ): Promise<AiDecideTargetInfo[]> {
    const targets: AiDecideTargetInfo[] = [];

    for (const connection of connections) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      if (!targetPod) {
        logger.log('Workflow', 'Update', `[AiDecideService] 找不到目標 Pod ${connection.targetPodId}`);
        continue;
      }

      targets.push(await this.resolveTargetPodResources(targetPod, connection));
    }

    return targets;
  }

  private async generateSourceSummary(canvasId: string, sourcePodId: string): Promise<string | null> {
    const sourcePod = podStore.getById(canvasId, sourcePodId);
    if (!sourcePod) return null;

    const messages = messageStore.getMessages(sourcePodId);
    if (messages.length === 0) return null;

    const conversationHistory = summaryPromptBuilder.formatConversationHistory(messages);
    const sourcePodOutputStyle = sourcePod.outputStyleId
      ? await outputStyleService.getContent(sourcePod.outputStyleId)
      : null;

    const systemPrompt = `你是一個對話摘要助手。請將以下對話內容濃縮為簡短的摘要，重點放在最終產出和關鍵結論。`;
    const userPrompt = `# Pod 名稱
${sourcePod.name}

${sourcePodOutputStyle ? `# OutputStyle\n${sourcePodOutputStyle}\n\n` : ''}# 對話歷史
${conversationHistory}

請提供一個簡短的摘要（150字內），重點說明這個對話的主要產出和結論。`;

    const result = await claudeService.executeDisposableChat({
      systemPrompt,
      userMessage: userPrompt,
      workspacePath: sourcePod.workspacePath,
    });

    if (!result.success) {
      logger.log('Workflow', 'Update', `[AiDecideService] 生成摘要失敗，使用備用內容`);
      return getLastAssistantMessage(sourcePodId);
    }

    return result.content;
  }
}

export const aiDecideService = new AiDecideService();
