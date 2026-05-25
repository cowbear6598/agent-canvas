import type {
  Connection,
} from "../../types/index.js";
import type {
  TriggerStrategy,
  TriggerDecideContext,
  TriggerDecideResult,
  CollectSourcesContext,
  CollectSourcesResult,
  TriggerLifecycleContext,
  CompletionContext,
  QueuedContext,
  QueueProcessedContext,
} from "./types.js";
import { workflowEventEmitter } from "./workflowEventEmitter.js";
import {
  buildQueuedPayload,
  buildQueueProcessedPayload,
} from "./workflowHelpers.js";
import { connectionStore } from "../connectionStore.js";

class WorkflowDirectTriggerService implements TriggerStrategy {
  readonly mode = "direct" as const;

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    return context.connections.map((connection) => ({
      connectionId: connection.id,
      approved: true,
      reason: null,
      isError: false,
    }));
  }

  async collectSources(
    context: CollectSourcesContext,
  ): Promise<CollectSourcesResult> {
    return {
      ready: true,
      participatingConnectionIds: [context.connection.id],
    };
  }

  private getConnectionsToIterate(
    canvasId: string,
    participatingConnectionIds: string[],
  ): Connection[] {
    return participatingConnectionIds
      .map((id) => connectionStore.getById(canvasId, id))
      .filter((conn): conn is Connection => conn !== undefined);
  }

  private forEachParticipatingConnection(
    canvasId: string,
    participatingConnectionIds: string[],
    callback: (conn: Connection) => void,
  ): void {
    const connections = this.getConnectionsToIterate(
      canvasId,
      participatingConnectionIds,
    );
    for (const conn of connections) {
      callback(conn);
    }
  }

  onTrigger(context: TriggerLifecycleContext): void {
    if (context.runContext) return;

    this.forEachParticipatingConnection(
      context.canvasId,
      context.participatingConnectionIds,
      (conn) => {
        workflowEventEmitter.emitDirectTriggered(context.canvasId, {
          canvasId: context.canvasId,
          connectionId: conn.id,
          sourcePodId: conn.sourcePodId,
          targetPodId: context.targetPodId,
          transferredContent: context.summary,
          isSummarized: context.isSummarized,
        });
      },
    );
  }

  onComplete(
    context: CompletionContext,
    success: boolean,
    error?: string,
  ): void {
    if (context.runContext) return;

    this.forEachParticipatingConnection(
      context.canvasId,
      context.participatingConnectionIds,
      (conn) => {
        workflowEventEmitter.emitWorkflowComplete({
          canvasId: context.canvasId,
          connectionId: conn.id,
          sourcePodId: conn.sourcePodId,
          targetPodId: context.targetPodId,
          success,
          error,
          triggerMode: context.triggerMode,
        });
        connectionStore.updateConnectionStatus(
          context.canvasId,
          conn.id,
          "idle",
        );
      },
    );
  }

  onError(context: CompletionContext, errorMessage: string): void {
    this.onComplete(context, false, errorMessage);
  }

  onQueued(context: QueuedContext): void {
    if (context.runContext) return;

    this.forEachParticipatingConnection(
      context.canvasId,
      context.participatingConnectionIds,
      (conn) => {
        connectionStore.updateConnectionStatus(
          context.canvasId,
          conn.id,
          "queued",
        );
        workflowEventEmitter.emitWorkflowQueued(
          context.canvasId,
          buildQueuedPayload(context, conn.id, conn.sourcePodId),
        );
      },
    );
  }

  /**
   * 僅發送 WORKFLOW_QUEUE_PROCESSED 事件，不設定 connection 為 active。
   * active 狀態由 triggerWorkflowWithSummary 統一設定。
   */
  onQueueProcessed(context: QueueProcessedContext): void {
    if (context.runContext) return;

    this.forEachParticipatingConnection(
      context.canvasId,
      context.participatingConnectionIds,
      (conn) => {
        workflowEventEmitter.emitWorkflowQueueProcessed(
          context.canvasId,
          buildQueueProcessedPayload({
            ...context,
            connectionId: conn.id,
            sourcePodId: conn.sourcePodId,
          }),
        );
      },
    );
  }
}

export const workflowDirectTriggerService = new WorkflowDirectTriggerService();
