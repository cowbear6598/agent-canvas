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
import { aiDecideService } from './aiDecideService.js';
import { workflowEventEmitter } from './workflowEventEmitter.js';
import { connectionStore } from '../connectionStore.js';
import { podStore } from '../podStore.js';
import { workflowStateService } from './workflowStateService.js';
import { pendingTargetStore } from '../pendingTargetStore.js';
import { workflowPipeline } from './workflowPipeline.js';
import { workflowMultiInputService } from './workflowMultiInputService.js';
import { forEachMultiInputGroupConnection, formatConnLog, completeMultiInputConnections, buildQueuedPayload, isAutoTriggerable } from './workflowHelpers.js';
import { logger } from '../../utils/logger.js';
import { getErrorMessage } from '../../utils/errorHelpers.js';
import { LazyInitializable } from './lazyInitializable.js';
import { autoClearService } from '../autoClear/autoClearService.js';

type AiDecideService = typeof aiDecideService;
type WorkflowEventEmitter = typeof workflowEventEmitter;
type ConnectionStore = typeof connectionStore;
type PodStore = typeof podStore;
type WorkflowStateService = typeof workflowStateService;
type PendingTargetStore = typeof pendingTargetStore;
type WorkflowPipeline = typeof workflowPipeline;
type WorkflowMultiInputService = typeof workflowMultiInputService;
type AutoClearService = typeof autoClearService;

interface AiDecideTriggerDependencies {
  aiDecideService: AiDecideService;
  eventEmitter: WorkflowEventEmitter;
  connectionStore: ConnectionStore;
  podStore: PodStore;
  stateService: WorkflowStateService;
  pendingTargetStore: PendingTargetStore;
  pipeline: WorkflowPipeline;
  multiInputService: WorkflowMultiInputService;
  autoClearService: AutoClearService;
}

class WorkflowAiDecideTriggerService extends LazyInitializable<AiDecideTriggerDependencies> implements TriggerStrategy {
  readonly mode = 'ai-decide' as const;

  onTrigger(context: TriggerLifecycleContext): void {
    this.ensureInitialized();
    this.deps.eventEmitter.emitWorkflowAiDecideTriggered(
      context.canvasId,
      context.connectionId,
      context.sourcePodId,
      context.targetPodId
    );
  }

  onComplete(context: CompletionContext, success: boolean, error?: string): void {
    completeMultiInputConnections(context, success, error);
  }

  onError(context: CompletionContext, errorMessage: string): void {
    completeMultiInputConnections(context, false, errorMessage);
  }

  onQueued(context: QueuedContext): void {
    this.ensureInitialized();
    forEachMultiInputGroupConnection(context.canvasId, context.targetPodId, (connection) => {
      this.deps.connectionStore.updateConnectionStatus(context.canvasId, connection.id, 'queued');
    });
    this.deps.eventEmitter.emitWorkflowQueued(
      context.canvasId,
      buildQueuedPayload(context, context.connectionId, context.sourcePodId)
    );
  }

  onQueueProcessed(context: QueueProcessedContext): void {
    this.ensureInitialized();
    this.deps.eventEmitter.emitWorkflowQueueProcessed(context.canvasId, {
      canvasId: context.canvasId,
      targetPodId: context.targetPodId,
      connectionId: context.connectionId,
      sourcePodId: context.sourcePodId,
      remainingQueueSize: context.remainingQueueSize,
      triggerMode: context.triggerMode,
    });
  }

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    this.ensureInitialized();

    const { canvasId, sourcePodId, connections } = context;

    try {
      const batchResult = await this.deps.aiDecideService.decideConnections(
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

  private setConnectionsToDeciding(canvasId: string, connections: Connection[]): void {
    this.ensureInitialized();
    for (const connection of connections) {
      this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'pending', null);
      this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-deciding');
    }
  }

  private async processDecideResult(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    decideResult: TriggerDecideResult
  ): Promise<void> {
    const connection = connections.find(c => c.id === decideResult.connectionId);
    if (!connection) return;

    if (decideResult.isError) {
      this.handleErrorConnection(canvasId, sourcePodId, connection, decideResult);
      return;
    }

    if (decideResult.approved) {
      this.handleApprovedConnection(canvasId, sourcePodId, connection, decideResult);
      return;
    }

    await this.handleRejectedConnection(canvasId, sourcePodId, connection, decideResult);
  }

  async processAiDecideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[]
  ): Promise<void> {
    this.ensureInitialized();

    const connectionIds = connections.map(connection => connection.id);
    this.deps.eventEmitter.emitAiDecidePending(canvasId, connectionIds, sourcePodId);

    this.setConnectionsToDeciding(canvasId, connections);

    const decideResults = await this.decide({ canvasId, sourcePodId, connections });

    for (const decideResult of decideResults) {
      await this.processDecideResult(canvasId, sourcePodId, connections, decideResult);
    }
  }

  private handleErrorConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult
  ): void {
    this.ensureInitialized();
    const errorMessage = decideResult.reason ?? '未知錯誤';
    this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'error', errorMessage);
    this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-error');
    this.deps.eventEmitter.emitAiDecideError({
      canvasId,
      connectionId: connection.id,
      sourcePodId,
      targetPodId: connection.targetPodId,
      error: errorMessage,
    });
    const sourcePod = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPod = this.deps.podStore.getById(canvasId, connection.targetPodId);
    logger.error('Workflow', 'Error', `AI Decide 發生錯誤，${formatConnLog({connId: connection.id, sourceName: sourcePod?.name, sourcePodId, targetName: targetPod?.name, targetPodId: connection.targetPodId})}：${errorMessage}`);
  }

  private handleApprovedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult
  ): void {
    this.ensureInitialized();
    this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'approved', decideResult.reason);
    this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-approved');
    this.deps.eventEmitter.emitAiDecideResult({
      canvasId,
      connectionId: connection.id,
      sourcePodId,
      targetPodId: connection.targetPodId,
      shouldTrigger: true,
      reason: decideResult.reason ?? '',
    });
    const sourcePod = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPod = this.deps.podStore.getById(canvasId, connection.targetPodId);
    logger.log('Workflow', 'Create', `AI Decide 核准${formatConnLog({connId: connection.id, sourceName: sourcePod?.name, sourcePodId, targetName: targetPod?.name, targetPodId: connection.targetPodId})}：${decideResult.reason}`);

    const pipelineContext: PipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: 'ai-decide',
      decideResult,
    };

    this.deps.pipeline.execute(pipelineContext, this).catch((error: unknown) => {
      logger.error('Workflow', 'Error', `AI Decide Workflow 執行失敗，連線 ${connection.id}`, error);
      this.deps.eventEmitter.emitWorkflowComplete({
        canvasId,
        connectionId: connection.id,
        sourcePodId,
        targetPodId: connection.targetPodId,
        success: false,
        error: getErrorMessage(error),
        triggerMode: 'ai-decide',
      });
    });
  }

  private emitRejectionEvents(
    canvasId: string,
    connection: Connection,
    sourcePodId: string,
    reason: string
  ): void {
    this.ensureInitialized();
    this.deps.eventEmitter.emitAiDecideResult({
      canvasId,
      connectionId: connection.id,
      sourcePodId,
      targetPodId: connection.targetPodId,
      shouldTrigger: false,
      reason,
    });
    const sourcePod = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPod = this.deps.podStore.getById(canvasId, connection.targetPodId);
    logger.log('Workflow', 'Update', `AI Decide 拒絕${formatConnLog({connId: connection.id, sourceName: sourcePod?.name, sourcePodId, targetName: targetPod?.name, targetPodId: connection.targetPodId})}：${reason}`);
  }

  private shouldDeferToMultiInput(canvasId: string, targetPodId: string): boolean {
    this.ensureInitialized();
    const { isMultiInput } = this.deps.stateService.checkMultiInputScenario(canvasId, targetPodId);
    return isMultiInput && this.deps.pendingTargetStore.hasPendingTarget(targetPodId);
  }

  private async handleNonMultiInputRejection(canvasId: string, targetPodId: string): Promise<void> {
    this.ensureInitialized();
    if (this.isLastRejectionTriggersGroupCancel(canvasId, targetPodId)) {
      await this.deps.autoClearService.onGroupNotTriggered(canvasId, targetPodId);
    }
  }

  private async handleRejectedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult
  ): Promise<void> {
    this.ensureInitialized();
    const reason = decideResult.reason ?? '';
    this.deps.connectionStore.updateDecideStatus(canvasId, connection.id, 'rejected', decideResult.reason);
    this.deps.connectionStore.updateConnectionStatus(canvasId, connection.id, 'ai-rejected');
    this.emitRejectionEvents(canvasId, connection, sourcePodId, reason);

    if (this.shouldDeferToMultiInput(canvasId, connection.targetPodId)) {
      await this.handleRejectedMultiInput(canvasId, sourcePodId, connection, reason);
      return;
    }

    await this.handleNonMultiInputRejection(canvasId, connection.targetPodId);
  }

  private isLastRejectionTriggersGroupCancel(canvasId: string, targetPodId: string): boolean {
    this.ensureInitialized();
    const incomingConnections = this.deps.connectionStore.findByTargetPodId(canvasId, targetPodId);
    const autoAiIncoming = incomingConnections.filter((c) => isAutoTriggerable(c.triggerMode));
    return autoAiIncoming.length === 1;
  }

  private async handleRejectedMultiInput(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    reason: string
  ): Promise<void> {
    this.ensureInitialized();
    this.deps.pendingTargetStore.recordSourceRejection(connection.targetPodId, sourcePodId, reason);
    this.deps.stateService.emitPendingStatus(canvasId, connection.targetPodId);

    const pending = this.deps.pendingTargetStore.getPendingTarget(connection.targetPodId);
    if (!pending) {
      return;
    }

    const allSourcesResponded = pending.completedSources.size + pending.rejectedSources.size >= pending.requiredSourcePodIds.length;
    if (allSourcesResponded && pending.rejectedSources.size > 0) {
      await this.deps.autoClearService.onGroupNotTriggered(canvasId, connection.targetPodId);
    }
  }
}

export const workflowAiDecideTriggerService = new WorkflowAiDecideTriggerService();
