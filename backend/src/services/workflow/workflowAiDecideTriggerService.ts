import type { Connection } from '../../types/index.js';
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
import type { RunContext } from '../../types/run.js';
import { aiDecideService } from './aiDecideService.js';
import { workflowEventEmitter } from './workflowEventEmitter.js';
import { connectionStore } from '../connectionStore.js';
import { podStore } from '../podStore.js';
import { workflowStateService } from './workflowStateService.js';
import { pendingTargetStore } from '../pendingTargetStore.js';
import { workflowPipeline } from './workflowPipeline.js';
import { workflowMultiInputService } from './workflowMultiInputService.js';
import { forEachMultiInputGroupConnection, formatConnectionLog, buildQueuedPayload, createMultiInputCompletionHandlers, emitQueueProcessed } from './workflowHelpers.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from '../../utils/errorHelpers.js';
import { LazyInitializable } from './lazyInitializable.js';
type AiDecideService = typeof aiDecideService;
type WorkflowEventEmitter = typeof workflowEventEmitter;
type ConnectionStore = typeof connectionStore;
type PodStore = typeof podStore;
type WorkflowStateService = typeof workflowStateService;
type PendingTargetStore = typeof pendingTargetStore;
type WorkflowPipeline = typeof workflowPipeline;
type WorkflowMultiInputService = typeof workflowMultiInputService;

interface AiDecideTriggerDependencies {
  aiDecideService: AiDecideService;
  eventEmitter: WorkflowEventEmitter;
  connectionStore: ConnectionStore;
  podStore: PodStore;
  stateService: WorkflowStateService;
  pendingTargetStore: PendingTargetStore;
  pipeline: WorkflowPipeline;
  multiInputService: WorkflowMultiInputService;
}

class WorkflowAiDecideTriggerService extends LazyInitializable<AiDecideTriggerDependencies> implements TriggerStrategy {
  readonly mode = 'ai-decide' as const;

  onTrigger(context: TriggerLifecycleContext): void {
    if (context.runContext) return;
    this.deps.eventEmitter.emitWorkflowAiDecideTriggered(
      context.canvasId,
      context.connectionId,
      context.sourcePodId,
      context.targetPodId
    );
  }

  private readonly completionHandlers = createMultiInputCompletionHandlers();

  onComplete(context: CompletionContext, success: boolean, error?: string): void {
    this.completionHandlers.onComplete(context, success, error);
  }

  onError(context: CompletionContext, errorMessage: string): void {
    this.completionHandlers.onError(context, errorMessage);
  }

  onQueued(context: QueuedContext): void {
    if (context.runContext) return;
    forEachMultiInputGroupConnection(context.canvasId, context.targetPodId, (connection) => {
      this.deps.connectionStore.updateConnectionStatus(context.canvasId, connection.id, 'queued');
    });
    this.deps.eventEmitter.emitWorkflowQueued(
      context.canvasId,
      buildQueuedPayload(context, context.connectionId, context.sourcePodId)
    );
  }

  onQueueProcessed(context: QueueProcessedContext): void {
    emitQueueProcessed(context);
  }

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    const deps = this.deps;
    const { canvasId, sourcePodId, connections } = context;

    try {
      const batchResult = await deps.aiDecideService.decideConnections(
        canvasId,
        sourcePodId,
        connections
      );

      const successResults: TriggerDecideResult[] = batchResult.results.map(result => ({
        connectionId: result.connectionId,
        approved: result.shouldTrigger,
        reason: result.reason,
        isError: false,
      }));

      const errorResults: TriggerDecideResult[] = batchResult.errors.map(errorResult => {
        logger.error('Workflow', 'Error', `[AI-Decide] Connection ${errorResult.connectionId} 錯誤：${errorResult.error}`);
        return {
          connectionId: errorResult.connectionId,
          approved: false,
          reason: 'AI 判斷服務發生錯誤',
          isError: true,
        };
      });

      return [...successResults, ...errorResults];
    } catch (error) {
      logger.error('Workflow', 'Error', '[AI-Decide] aiDecideService.decideConnections 失敗', error);

      return connections.map(connection => ({
        connectionId: connection.id,
        approved: false,
        reason: `錯誤：${getErrorMessage(error)}`,
        isError: true,
      }));
    }
  }

  private setConnectionsToDeciding(canvasId: string, connections: Connection[], runContext?: RunContext): void {
    if (runContext) return;
    for (const connection of connections) {
      this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'pending', null);
      this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-deciding');
    }
  }

  private async processDecideResult(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    decideResult: TriggerDecideResult,
    runContext?: RunContext
  ): Promise<void> {
    const connection = connections.find(c => c.id === decideResult.connectionId);
    if (!connection) return;

    if (decideResult.isError) {
      this.handleErrorConnection(canvasId, sourcePodId, connection, decideResult, runContext);
      return;
    }

    if (decideResult.approved) {
      this.handleApprovedConnection(canvasId, sourcePodId, connection, decideResult, runContext);
      this.triggerApprovedPipeline(canvasId, sourcePodId, connection, decideResult, runContext);
      return;
    }

    await this.handleRejectedConnection(canvasId, sourcePodId, connection, decideResult, runContext);
  }

  async processAiDecideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext
  ): Promise<void> {
    const connectionIds = connections.map(connection => connection.id);
    if (!runContext) {
      this.deps.eventEmitter.emitAiDecidePending(canvasId, connectionIds, sourcePodId);
    }

    this.setConnectionsToDeciding(canvasId, connections, runContext);

    const decideResults = await this.decide({ canvasId, sourcePodId, connections });

    for (const decideResult of decideResults) {
      await this.processDecideResult(canvasId, sourcePodId, connections, decideResult, runContext);
    }
  }

  private handleErrorConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    runContext?: RunContext
  ): void {
    const errorMessage = decideResult.reason ?? '未知錯誤';
    if (!runContext) {
      this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'error', errorMessage);
      this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-error');
    }
    if (!runContext) {
      this.deps.eventEmitter.emitAiDecideError({
        canvasId,
        connectionId: connection.id,
        sourcePodId,
        targetPodId: connection.targetPodId,
        error: errorMessage,
      });
    }
    const sourcePodErr = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPodErr = this.deps.podStore.getById(canvasId, connection.targetPodId);
    const connLogErr = formatConnectionLog({connectionId: connection.id, sourceName: sourcePodErr?.name, sourcePodId, targetName: targetPodErr?.name, targetPodId: connection.targetPodId});
    logger.error('Workflow', 'Error', `AI Decide 發生錯誤，${connLogErr}：${errorMessage}`);
  }

  private handleApprovedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    runContext?: RunContext
  ): void {
    if (!runContext) {
      this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'approved', decideResult.reason);
      this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-approved');
    }
    if (!runContext) {
      this.deps.eventEmitter.emitAiDecideResult({
        canvasId,
        connectionId: connection.id,
        sourcePodId,
        targetPodId: connection.targetPodId,
        shouldTrigger: true,
        reason: decideResult.reason ?? '',
      });
    }
    const sourcePodApprove = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPodApprove = this.deps.podStore.getById(canvasId, connection.targetPodId);
    const connLogApprove = formatConnectionLog({connectionId: connection.id, sourceName: sourcePodApprove?.name, sourcePodId, targetName: targetPodApprove?.name, targetPodId: connection.targetPodId});
    const reasonApprove = decideResult.reason;
    logger.log('Workflow', 'Create', reasonApprove ? `AI Decide 核准${connLogApprove}：${reasonApprove}` : `AI Decide 核准${connLogApprove}`);
  }

  private triggerApprovedPipeline(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    runContext?: RunContext
  ): void {
    const pipelineContext: PipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: 'ai-decide',
      decideResult,
      runContext,
    };

    this.deps.pipeline.execute(pipelineContext, this).catch((error: unknown) => {
      logger.error('Workflow', 'Error', `AI Decide Workflow 執行失敗，連線 ${connection.id}`, error);
      if (!runContext) {
        this.deps.eventEmitter.emitWorkflowComplete({
          canvasId,
          connectionId: connection.id,
          sourcePodId,
          targetPodId: connection.targetPodId,
          success: false,
          error: getErrorMessage(error),
          triggerMode: 'ai-decide',
        });
      }
    });
  }

  private emitRejectionEvents(
    canvasId: string,
    connection: Connection,
    sourcePodId: string,
    reason: string,
    runContext?: RunContext
  ): void {
    if (runContext) return;
    this.deps.eventEmitter.emitAiDecideResult({
      canvasId,
      connectionId: connection.id,
      sourcePodId,
      targetPodId: connection.targetPodId,
      shouldTrigger: false,
      reason,
    });
    const sourcePodReject = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPodReject = this.deps.podStore.getById(canvasId, connection.targetPodId);
    const connLogReject = formatConnectionLog({connectionId: connection.id, sourceName: sourcePodReject?.name, sourcePodId, targetName: targetPodReject?.name, targetPodId: connection.targetPodId});
    logger.log('Workflow', 'Update', reason ? `AI Decide 拒絕${connLogReject}：${reason}` : `AI Decide 拒絕${connLogReject}`);
  }

  private shouldDeferToMultiInput(canvasId: string, targetPodId: string, runContext?: RunContext): boolean {
    const { isMultiInput } = this.deps.stateService.checkMultiInputScenario(canvasId, targetPodId);
    const pendingKey = runContext ? `${runContext.runId}:${targetPodId}` : targetPodId;
    return isMultiInput && this.deps.pendingTargetStore.hasPendingTarget(pendingKey);
  }

  private async handleRejectedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    runContext?: RunContext
  ): Promise<void> {
    const reason = decideResult.reason ?? '';
    if (!runContext) {
      this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'rejected', decideResult.reason);
      this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-rejected');
    }
    this.emitRejectionEvents(canvasId, connection, sourcePodId, reason, runContext);

    if (this.shouldDeferToMultiInput(canvasId, connection.targetPodId, runContext)) {
      await this.handleRejectedMultiInput(canvasId, sourcePodId, connection, reason);
    }
  }

  private async handleRejectedMultiInput(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    reason: string
  ): Promise<void> {
    this.deps.pendingTargetStore.recordSourceRejection(connection.targetPodId, sourcePodId, reason);
    this.deps.stateService.emitPendingStatus(canvasId, connection.targetPodId);
  }
}

export const workflowAiDecideTriggerService = new WorkflowAiDecideTriggerService();
