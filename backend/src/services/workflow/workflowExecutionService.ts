import type { TriggerMode, Connection } from '../../types/index.js';
import type {
  PipelineContext,
  PipelineMethods,
  AiDecideMethods,
  AutoTriggerMethods,
  TriggerStrategy,
  TriggerWorkflowWithSummaryParams,
} from './types.js';
import {connectionStore} from '../connectionStore.js';
import {podStore} from '../podStore.js';
import {summaryService} from '../summaryService.js';
import {injectUserMessage} from '../../utils/chatHelpers.js';
import {workflowQueueService} from './workflowQueueService.js';
import {autoClearService} from '../autoClear/index.js';
import {logger} from '../../utils/logger.js';
import {fireAndForget} from '../../utils/operationHelpers.js';
import {commandService} from '../commandService.js';
import {executeStreamingChat} from '../claude/streamingChatExecutor.js';
import {
    buildTransferMessage,
    buildMessageWithCommand,
    forEachMultiInputGroupConnection,
    isAutoTriggerable,
} from './workflowHelpers.js';
import { LazyInitializable } from './lazyInitializable.js';

interface ExecutionServiceDeps {
  pipeline: PipelineMethods;
  aiDecideTriggerService: AiDecideMethods;
  autoTriggerService: AutoTriggerMethods;
  directTriggerService: TriggerStrategy;
}

interface WorkflowChatContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  participatingConnectionIds: string[];
  strategy: TriggerStrategy;
}

class WorkflowExecutionService extends LazyInitializable<ExecutionServiceDeps> {
  private getLastAssistantFallback(sourcePodId: string): { content: string; isSummarized: boolean } | null {
    const fallback = this.deps.autoTriggerService.getLastAssistantMessage(sourcePodId);
    return fallback ? { content: fallback, isSummarized: false } : null;
  }

  async generateSummaryWithFallback(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string
  ): Promise<{ content: string; isSummarized: boolean } | null> {
    podStore.setStatus(canvasId, sourcePodId, 'summarizing');
    const summaryResult = await summaryService.generateSummaryForTarget(
      canvasId,
      sourcePodId,
      targetPodId
    );

    if (summaryResult.success) {
      podStore.setStatus(canvasId, sourcePodId, 'idle');
      return { content: summaryResult.summary, isSummarized: true };
    }

    logger.error('Workflow', 'Error', `生成摘要失敗：${summaryResult.error}`);
    podStore.setStatus(canvasId, sourcePodId, 'idle');
    return this.getLastAssistantFallback(sourcePodId);
  }

  private triggerAutoConnections(canvasId: string, sourcePodId: string, connections: Connection[]): Promise<unknown>[] {
    return connections
      .filter((conn) => conn.triggerMode === 'auto')
      .map((connection) => this.deps.autoTriggerService.processAutoTriggerConnection(canvasId, sourcePodId, connection));
  }

  private triggerAiDecideConnections(canvasId: string, sourcePodId: string, connections: Connection[]): Promise<unknown> {
    const aiDecideConnections = connections.filter((conn) => conn.triggerMode === 'ai-decide');
    if (aiDecideConnections.length === 0) return Promise.resolve();
    return this.deps.aiDecideTriggerService.processAiDecideConnections(canvasId, sourcePodId, aiDecideConnections);
  }

  private triggerDirectConnections(canvasId: string, sourcePodId: string, connections: Connection[]): Promise<unknown>[] {
    return connections
      .filter((conn) => conn.triggerMode === 'direct')
      .map((connection) => {
        const pipelineContext: PipelineContext = {
          canvasId,
          sourcePodId,
          connection,
          triggerMode: 'direct',
          decideResult: { connectionId: connection.id, approved: true, reason: null, isError: false },
        };
        return this.deps.pipeline.execute(pipelineContext, this.deps.directTriggerService);
      });
  }

  async checkAndTriggerWorkflows(canvasId: string, sourcePodId: string): Promise<void> {
    const connections = connectionStore.findBySourcePodId(canvasId, sourcePodId);

    if (connections.length === 0) {
      return;
    }

    autoClearService.initializeWorkflowTracking(canvasId, sourcePodId);

    await Promise.allSettled([
      ...this.triggerAutoConnections(canvasId, sourcePodId, connections),
      this.triggerAiDecideConnections(canvasId, sourcePodId, connections),
      ...this.triggerDirectConnections(canvasId, sourcePodId, connections),
    ]);
  }

  async triggerWorkflowWithSummary(params: TriggerWorkflowWithSummaryParams): Promise<void> {
    const {canvasId, connectionId, summary, isSummarized, participatingConnectionIds, strategy} = params;

    const connection = connectionStore.getById(canvasId, connectionId);
    if (!connection) {
      logger.warn('Workflow', 'Warn', `triggerWorkflowWithSummary: Connection ${connectionId} 已不存在，跳過觸發`);
      return;
    }

    const { sourcePodId, targetPodId } = connection;

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      throw new Error(`找不到 Pod：${targetPodId}`);
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    logger.log('Workflow', 'Create', `觸發工作流程：Pod "${sourcePod?.name ?? sourcePodId}" → Pod "${targetPod.name}"`);

    const triggerMode = connection.triggerMode;
    const resolvedConnectionIds = participatingConnectionIds ?? [connectionId];

    this.setConnectionsToActive(canvasId, connectionId, targetPodId, triggerMode, resolvedConnectionIds);

    strategy.onTrigger({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      summary,
      isSummarized,
      participatingConnectionIds: resolvedConnectionIds,
    });

    podStore.setStatus(canvasId, targetPodId, 'chatting');
    // 刻意不 await：Claude 查詢是長時間操作，結果透過 WebSocket 事件通知前端。
    // 若改為 await，呼叫方的 Promise.allSettled 會等到查詢完成才繼續，喪失多 connection 並行觸發的能力。
    fireAndForget(
      this.executeClaudeQuery({ canvasId, connectionId, sourcePodId, targetPodId, content: summary, participatingConnectionIds: resolvedConnectionIds, strategy }),
      'Workflow',
      `executeClaudeQuery 執行失敗 (connection: ${connectionId})`
    );
  }

  private activateMultiInputConnections(canvasId: string, targetPodId: string): void {
    forEachMultiInputGroupConnection(canvasId, targetPodId, (conn) => {
      const stillExists = connectionStore.getById(canvasId, conn.id);
      if (!stillExists) {
        logger.warn('Workflow', 'Warn', `Connection ${conn.id} 已不存在，跳過 active 狀態設定`);
        return;
      }
      connectionStore.updateConnectionStatus(canvasId, conn.id, 'active');
    });
  }

  private activateParticipatingConnections(canvasId: string, participatingConnectionIds: string[]): void {
    for (const id of participatingConnectionIds) {
      const stillExists = connectionStore.getById(canvasId, id);
      if (!stillExists) {
        logger.warn('Workflow', 'Warn', `Connection ${id} 已不存在，跳過 active 狀態設定`);
        continue;
      }
      connectionStore.updateConnectionStatus(canvasId, id, 'active');
    }
  }

  private setConnectionsToActive(
    canvasId: string,
    connectionId: string,
    targetPodId: string,
    triggerMode: TriggerMode,
    participatingConnectionIds: string[]
  ): void {
    if (isAutoTriggerable(triggerMode)) {
      this.activateMultiInputConnections(canvasId, targetPodId);
      return;
    }
    this.activateParticipatingConnections(canvasId, participatingConnectionIds);
  }

  private scheduleNextInQueue(canvasId: string, targetPodId: string): void {
    // 刻意不 await：佇列處理獨立於當前 workflow，避免阻塞完成/錯誤回調
    fireAndForget(
      workflowQueueService.processNextInQueue(canvasId, targetPodId),
      'Workflow',
      '處理佇列下一項時發生錯誤'
    );
  }

  private async onWorkflowChatComplete(params: WorkflowChatContext): Promise<void> {
    const { canvasId, connectionId, sourcePodId, targetPodId, participatingConnectionIds, strategy } = params;
    strategy.onComplete(
      { canvasId, connectionId, sourcePodId, targetPodId, triggerMode: strategy.mode, participatingConnectionIds },
      true
    );
    await autoClearService.onPodComplete(canvasId, targetPodId);
    // 刻意不 await：下游 workflow 觸發獨立於當前查詢完成流程
    fireAndForget(
      this.checkAndTriggerWorkflows(canvasId, targetPodId),
      'Workflow',
      `下游 workflow 觸發失敗 (pod: ${targetPodId})`
    );
    this.scheduleNextInQueue(canvasId, targetPodId);
  }

  private async onWorkflowChatError(params: WorkflowChatContext, error: Error): Promise<void> {
    const { canvasId, connectionId, sourcePodId, targetPodId, participatingConnectionIds, strategy } = params;
    strategy.onError(
      { canvasId, connectionId, sourcePodId, targetPodId, triggerMode: strategy.mode, participatingConnectionIds },
      error.message
    );
    logger.error('Workflow', 'Error', 'Workflow 執行失敗', error);
    podStore.setStatus(canvasId, targetPodId, 'idle');
    this.scheduleNextInQueue(canvasId, targetPodId);
  }

  private async executeClaudeQuery(params: WorkflowChatContext & { content: string }): Promise<void> {
    const { canvasId, targetPodId, content } = params;
    const baseMessage = buildTransferMessage(content);
    const targetPod = podStore.getById(canvasId, targetPodId);
    const commands = await commandService.list();
    const messageToSend = buildMessageWithCommand(baseMessage, targetPod, commands);

    await injectUserMessage({ canvasId, podId: targetPodId, content: messageToSend });

    await executeStreamingChat(
      { canvasId, podId: targetPodId, message: messageToSend, abortable: false },
      {
        onComplete: (_canvasId, _podId) => this.onWorkflowChatComplete(params),
        onError: (_canvasId, _podId, error) => this.onWorkflowChatError(params, error),
      }
    );
  }
}

export const workflowExecutionService = new WorkflowExecutionService();
