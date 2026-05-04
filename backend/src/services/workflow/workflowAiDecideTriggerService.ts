import type { Connection } from "../../types/index.js";
import type {
  TriggerStrategy,
  TriggerDecideContext,
  TriggerDecideResult,
  PipelineContext,
  TriggerLifecycleContext,
  CompletionContext,
  QueuedContext,
  QueueProcessedContext,
} from "./types.js";
import type { RunContext } from "../../types/run.js";
import { aiDecideService } from "./aiDecideService.js";
import { workflowEventEmitter } from "./workflowEventEmitter.js";
import { connectionStore } from "../connectionStore.js";
import { podStore } from "../podStore.js";
import { workflowStateService } from "./workflowStateService.js";
import { pendingTargetStore } from "../pendingTargetStore.js";
import { workflowPipeline } from "./workflowPipeline.js";
import { workflowMultiInputService } from "./workflowMultiInputService.js";
import {
  forEachMultiInputGroupConnection,
  formatConnectionLog,
  buildQueuedPayload,
  createMultiInputCompletionHandlers,
  emitQueueProcessed,
  resolvePendingKey,
} from "./workflowHelpers.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errorHelpers.js";
import { LazyInitializable } from "./lazyInitializable.js";
import { createStatusDelegate } from "./workflowStatusDelegate.js";
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

class WorkflowAiDecideTriggerService
  extends LazyInitializable<AiDecideTriggerDependencies>
  implements TriggerStrategy
{
  readonly mode = "ai-decide" as const;

  onTrigger(context: TriggerLifecycleContext): void {
    if (context.runContext) return;
    this.deps.eventEmitter.emitWorkflowAiDecideTriggered(
      context.canvasId,
      context.connectionId,
      context.sourcePodId,
      context.targetPodId,
    );
  }

  private readonly completionHandlers = createMultiInputCompletionHandlers();

  onComplete(
    context: CompletionContext,
    success: boolean,
    error?: string,
  ): void {
    this.completionHandlers.onComplete(context, success, error);
  }

  onError(context: CompletionContext, errorMessage: string): void {
    this.completionHandlers.onError(context, errorMessage);
  }

  onQueued(context: QueuedContext): void {
    if (context.runContext) return;
    forEachMultiInputGroupConnection(
      context.canvasId,
      context.targetPodId,
      (connection) => {
        this.deps.connectionStore.updateConnectionStatus(
          context.canvasId,
          connection.id,
          "queued",
        );
      },
    );
    this.deps.eventEmitter.emitWorkflowQueued(
      context.canvasId,
      buildQueuedPayload(context, context.connectionId, context.sourcePodId),
    );
  }

  onQueueProcessed(context: QueueProcessedContext): void {
    emitQueueProcessed(context);
  }

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    const deps = this.deps;
    const { canvasId, sourcePodId, connections, runContext } = context;

    try {
      const batchResult = await deps.aiDecideService.decideConnections(
        canvasId,
        sourcePodId,
        connections,
        runContext,
      );

      const successResults: TriggerDecideResult[] = batchResult.results.map(
        (result) => ({
          connectionId: result.connectionId,
          approved: result.shouldTrigger,
          reason: result.reason,
          isError: false,
        }),
      );

      const errorResults: TriggerDecideResult[] = batchResult.errors.map(
        (errorResult) => {
          logger.error(
            "Workflow",
            "Error",
            `[AI-Decide] Connection ${errorResult.connectionId} 錯誤：${errorResult.error}`,
          );
          return {
            connectionId: errorResult.connectionId,
            approved: false,
            reason: "AI 判斷服務發生錯誤",
            isError: true,
          };
        },
      );

      return [...successResults, ...errorResults];
    } catch (error) {
      logger.error(
        "Workflow",
        "Error",
        "[AI-Decide] aiDecideService.decideConnections 失敗",
        error,
      );

      return connections.map((connection) => ({
        connectionId: connection.id,
        approved: false,
        reason: `錯誤：${getErrorMessage(error)}`,
        isError: true,
      }));
    }
  }

  private setConnectionsToDeciding(
    canvasId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): void {
    if (runContext) return;
    for (const connection of connections) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "pending",
        null,
      );
      this.deps.connectionStore.updateConnectionStatus(
        canvasId,
        connection.id,
        "ai-deciding",
      );
    }
  }

  private async processDecideResult(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    decideResult: TriggerDecideResult,
    delegate: ReturnType<typeof createStatusDelegate>,
    runContext?: RunContext,
  ): Promise<void> {
    const connection = connections.find(
      (conn) => conn.id === decideResult.connectionId,
    );
    if (!connection) return;

    if (decideResult.isError) {
      this.handleErrorConnection(
        canvasId,
        sourcePodId,
        connection,
        decideResult,
        delegate,
      );
      return;
    }

    if (decideResult.approved) {
      this.handleApprovedConnection(
        canvasId,
        sourcePodId,
        connection,
        decideResult,
        runContext,
      );
      this.triggerApprovedPipeline(
        canvasId,
        sourcePodId,
        connection,
        decideResult,
        delegate,
        runContext,
      );
      return;
    }

    await this.handleRejectedConnection(
      canvasId,
      sourcePodId,
      connection,
      decideResult,
      delegate,
      runContext,
    );
  }

  async processAiDecideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<void> {
    const delegate = createStatusDelegate(runContext);
    const connectionIds = connections.map((connection) => connection.id);

    if (!delegate.isRunMode()) {
      this.deps.eventEmitter.emitAiDecidePending(
        canvasId,
        connectionIds,
        sourcePodId,
      );
    }

    this.setConnectionsToDeciding(canvasId, connections, runContext);

    const targetPodIds = [
      ...new Set(connections.map((conn) => conn.targetPodId)),
    ];
    for (const targetPodId of targetPodIds) {
      delegate.markDeciding(canvasId, targetPodId);
    }

    const decideResults = await this.decide({
      canvasId,
      sourcePodId,
      connections,
      runContext,
    });

    for (const decideResult of decideResults) {
      await this.processDecideResult(
        canvasId,
        sourcePodId,
        connections,
        decideResult,
        delegate,
        runContext,
      );
    }
  }

  private buildConnectionLog(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
  ): string {
    const sourcePod = this.deps.podStore.getById(canvasId, sourcePodId);
    const targetPod = this.deps.podStore.getById(
      canvasId,
      connection.targetPodId,
    );
    return formatConnectionLog({
      sourceName: sourcePod?.name,
      sourcePodId,
      targetName: targetPod?.name,
      targetPodId: connection.targetPodId,
    });
  }

  private handleErrorConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    delegate: ReturnType<typeof createStatusDelegate>,
  ): void {
    const errorMessage = decideResult.reason ?? "未知錯誤";

    if (!delegate.isRunMode()) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "error",
        errorMessage,
      );
      this.deps.connectionStore.updateConnectionStatus(
        canvasId,
        connection.id,
        "ai-error",
      );
      this.deps.eventEmitter.emitAiDecideError({
        canvasId,
        connectionId: connection.id,
        sourcePodId,
        targetPodId: connection.targetPodId,
        error: errorMessage,
      });
    } else {
      delegate.onChatError(canvasId, connection.targetPodId, errorMessage);
    }
    const connLog = this.buildConnectionLog(canvasId, sourcePodId, connection);
    logger.error(
      "Workflow",
      "Error",
      `AI Decide 發生錯誤，${connLog}：${errorMessage}`,
    );
  }

  private handleApprovedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    runContext?: RunContext,
  ): void {
    if (!runContext) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "approved",
        decideResult.reason,
      );
      this.deps.connectionStore.updateConnectionStatus(
        canvasId,
        connection.id,
        "ai-approved",
      );
      this.deps.eventEmitter.emitAiDecideResult({
        canvasId,
        connectionId: connection.id,
        sourcePodId,
        targetPodId: connection.targetPodId,
        shouldTrigger: true,
        reason: decideResult.reason ?? "",
      });
    }
    const connLog = this.buildConnectionLog(canvasId, sourcePodId, connection);
    const reason = decideResult.reason;
    logger.log(
      "Workflow",
      "Create",
      reason
        ? `AI Decide 核准${connLog}：${reason}`
        : `AI Decide 核准${connLog}`,
    );
  }

  private triggerApprovedPipeline(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    delegate: ReturnType<typeof createStatusDelegate>,
    runContext?: RunContext,
  ): void {
    const pipelineContext: PipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: "ai-decide",
      decideResult,
      runContext,
    };

    this.deps.pipeline
      .execute(pipelineContext, this)
      .catch((error: unknown) => {
        logger.error(
          "Workflow",
          "Error",
          `AI Decide Workflow 執行失敗，連線 ${connection.id}`,
          error,
        );
        if (!delegate.isRunMode()) {
          this.deps.eventEmitter.emitWorkflowComplete({
            canvasId,
            connectionId: connection.id,
            sourcePodId,
            targetPodId: connection.targetPodId,
            success: false,
            error: getErrorMessage(error),
            triggerMode: "ai-decide",
          });
        }
      });
  }

  private emitRejectionEvents(
    canvasId: string,
    connection: Connection,
    sourcePodId: string,
    reason: string,
    runContext?: RunContext,
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
    const connLog = this.buildConnectionLog(canvasId, sourcePodId, connection);
    logger.log(
      "Workflow",
      "Update",
      reason
        ? `AI Decide 拒絕${connLog}：${reason}`
        : `AI Decide 拒絕${connLog}`,
    );
  }

  private shouldDeferToMultiInput(
    canvasId: string,
    targetPodId: string,
    runContext?: RunContext,
  ): boolean {
    const { isMultiInput } = this.deps.stateService.checkMultiInputScenario(
      canvasId,
      targetPodId,
    );
    const pendingKey = resolvePendingKey(targetPodId, runContext);
    return (
      isMultiInput && this.deps.pendingTargetStore.hasPendingTarget(pendingKey)
    );
  }

  private async handleRejectedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    decideResult: TriggerDecideResult,
    delegate: ReturnType<typeof createStatusDelegate>,
    runContext?: RunContext,
  ): Promise<void> {
    const reason = decideResult.reason ?? "";

    if (!delegate.isRunMode()) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "rejected",
        decideResult.reason,
      );
      this.deps.connectionStore.updateConnectionStatus(
        canvasId,
        connection.id,
        "ai-rejected",
      );
    } else {
      delegate.settleAndSkipPath(canvasId, connection.targetPodId, "auto");
    }
    this.emitRejectionEvents(
      canvasId,
      connection,
      sourcePodId,
      reason,
      runContext,
    );

    if (
      this.shouldDeferToMultiInput(canvasId, connection.targetPodId, runContext)
    ) {
      await this.handleRejectedMultiInput(
        canvasId,
        sourcePodId,
        connection,
        reason,
      );
    }
  }

  private async handleRejectedMultiInput(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    reason: string,
  ): Promise<void> {
    this.deps.pendingTargetStore.recordSourceRejection(
      connection.targetPodId,
      sourcePodId,
      reason,
    );
    this.deps.stateService.emitPendingStatus(canvasId, connection.targetPodId);
  }
}

export const workflowAiDecideTriggerService =
  new WorkflowAiDecideTriggerService();
