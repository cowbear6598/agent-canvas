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
import { forEachMultiInputGroupConnection, formatConnectionLog, buildQueuedPayload, isAutoTriggerable, createMultiInputCompletionHandlers, emitQueueProcessed } from './workflowHelpers.js';
import { logger } from '../../utils/logger.js';
import type { LogAction } from '../../utils/logger.js';
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

  private readonly completionHandlers = createMultiInputCompletionHandlers();

  onComplete(context: CompletionContext, success: boolean, error?: string): void {
    this.completionHandlers.onComplete(context, success, error);
  }

  onError(context: CompletionContext, errorMessage: string): void {
    this.completionHandlers.onError(context, errorMessage);
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
    emitQueueProcessed(context);
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

  private logConnectionEvent(
    level: 'log' | 'error',
    action: LogAction,
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    message: string,
    suffix?: string
  ): void {
    const sourcePod = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPod = this.deps.podStore.getById(canvasId, connection.targetPodId);
    const connLog = formatConnectionLog({connectionId: connection.id, sourceName: sourcePod?.name, sourcePodId, targetName: targetPod?.name, targetPodId: connection.targetPodId});
    const fullMessage = suffix ? `${message}${connLog}：${suffix}` : `${message}${connLog}`;
    logger[level]('Workflow', action, fullMessage);
  }

  private handleErrorConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult
  ): void {
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
    this.logConnectionEvent('error', 'Error', canvasId, sourcePodId, connection, `AI Decide 發生錯誤，`, errorMessage);
  }

  private handleApprovedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult
  ): void {
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
    this.logConnectionEvent('log', 'Create', canvasId, sourcePodId, connection, `AI Decide 核准`, decideResult.reason ?? undefined);

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
    this.deps.eventEmitter.emitAiDecideResult({
      canvasId,
      connectionId: connection.id,
      sourcePodId,
      targetPodId: connection.targetPodId,
      shouldTrigger: false,
      reason,
    });
    this.logConnectionEvent('log', 'Update', canvasId, sourcePodId, connection, `AI Decide 拒絕`, reason);
  }

  private shouldDeferToMultiInput(canvasId: string, targetPodId: string): boolean {
    const { isMultiInput } = this.deps.stateService.checkMultiInputScenario(canvasId, targetPodId);
    return isMultiInput && this.deps.pendingTargetStore.hasPendingTarget(targetPodId);
  }

  private async handleNonMultiInputRejection(canvasId: string, targetPodId: string): Promise<void> {
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
    const { allSourcesResponded } = this.deps.pendingTargetStore.recordSourceRejection(connection.targetPodId, sourcePodId, reason);
    this.deps.stateService.emitPendingStatus(canvasId, connection.targetPodId);

    if (allSourcesResponded) {
      await this.deps.autoClearService.onGroupNotTriggered(canvasId, connection.targetPodId);
    }
  }
}

export const workflowAiDecideTriggerService = new WorkflowAiDecideTriggerService();
