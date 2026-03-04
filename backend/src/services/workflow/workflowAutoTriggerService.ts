import type { Connection, WorkflowAutoTriggeredPayload } from '../../types/index.js';
import type {
  TriggerStrategy,
  TriggerDecideContext,
  TriggerDecideResult,
  PipelineContext,
  TriggerLifecycleContext,
  CompletionContext,
  QueuedContext,
  QueueProcessedContext,
} from './types.js';
import { podStore } from '../podStore.js';
import { messageStore } from '../messageStore.js';
import { connectionStore } from '../connectionStore.js';
import { workflowEventEmitter } from './workflowEventEmitter.js';
import { forEachMultiInputGroupConnection, completeMultiInputConnections, buildQueuedPayload } from './workflowHelpers.js';
import { logger } from '../../utils/logger.js';

interface Pipeline {
  execute(context: PipelineContext, strategy: TriggerStrategy): Promise<void>;
}

class WorkflowAutoTriggerService implements TriggerStrategy {
  readonly mode = 'auto' as const;
  private pipeline?: Pipeline;

  init(deps: { pipeline: Pipeline }): void {
    this.pipeline = deps.pipeline;
  }

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    return context.connections.map((conn) => ({
      connectionId: conn.id,
      approved: true,
      reason: null,
      isError: false,
    }));
  }

  getLastAssistantMessage(sourcePodId: string): string | null {
    const messages = messageStore.getMessages(sourcePodId);
    const assistantMessages = messages.filter((message) => message.role === 'assistant');

    if (assistantMessages.length === 0) {
      logger.error('Workflow', 'Error', '找不到 assistant 訊息作為備用內容');
      return null;
    }

    return assistantMessages[assistantMessages.length - 1].content;
  }

  async processAutoTriggerConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection
  ): Promise<void> {
    if (!this.pipeline) {
      throw new Error('AutoTriggerService 尚未初始化，請先呼叫 init()');
    }

    const targetPod = podStore.getById(canvasId, connection.targetPodId);
    if (!targetPod) {
      logger.log('Workflow', 'Error', `目標 Pod ${connection.targetPodId} 不存在，跳過自動觸發`);
      return;
    }

    const pipelineContext: PipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: 'auto',
      decideResult: {
        connectionId: connection.id,
        approved: true,
        reason: null,
        isError: false,
      },
    };

    await this.pipeline.execute(pipelineContext, this);
  }

  onTrigger(context: TriggerLifecycleContext): void {
    const payload: WorkflowAutoTriggeredPayload = {
      connectionId: context.connectionId,
      sourcePodId: context.sourcePodId,
      targetPodId: context.targetPodId,
      transferredContent: context.summary,
      isSummarized: context.isSummarized,
    };
    workflowEventEmitter.emitWorkflowAutoTriggered(context.canvasId, payload);
  }

  onComplete(context: CompletionContext, success: boolean, error?: string): void {
    completeMultiInputConnections(context, success, error);
  }

  onError(context: CompletionContext, errorMessage: string): void {
    completeMultiInputConnections(context, false, errorMessage);
  }

  onQueued(context: QueuedContext): void {
    forEachMultiInputGroupConnection(context.canvasId, context.targetPodId, (conn) => {
      connectionStore.updateConnectionStatus(context.canvasId, conn.id, 'queued');
    });
    workflowEventEmitter.emitWorkflowQueued(
      context.canvasId,
      buildQueuedPayload(context, context.connectionId, context.sourcePodId)
    );
  }

  onQueueProcessed(context: QueueProcessedContext): void {
    workflowEventEmitter.emitWorkflowQueueProcessed(context.canvasId, {
      canvasId: context.canvasId,
      targetPodId: context.targetPodId,
      connectionId: context.connectionId,
      sourcePodId: context.sourcePodId,
      remainingQueueSize: context.remainingQueueSize,
      triggerMode: context.triggerMode,
    });
  }
}

export const workflowAutoTriggerService = new WorkflowAutoTriggerService();
