import { WebSocketResponseEvents } from "../../schemas/index.js";
import type {
  WorkflowSourcesMergedPayload,
  Connection,
  AutoTriggerMode,
  ConnectionUpdatedPayload,
} from "../../types/index.js";
import { isPodBusy } from "../../types/index.js";
import type {
  ExecutionServiceMethods,
  TriggerStrategy,
  HandleMultiInputForConnectionParams,
} from "./types.js";
import type { RunContext } from "../../types/run.js";
import { podStore } from "../podStore.js";
import { runStore } from "../runStore.js";
import { socketService } from "../socketService.js";
import { connectionStore } from "../connectionStore.js";
import { pendingTargetStore } from "../pendingTargetStore.js";
import { workflowQueueService } from "./workflowQueueService.js";
import { runQueueService } from "./runQueueService.js";
import { workflowStateService } from "./workflowStateService.js";
import { logger } from "../../utils/logger.js";
import {
  formatMergedSummaries,
  resolvePendingKey,
  getMultiInputGroupConnections,
} from "./workflowHelpers.js";
import { LazyInitializable } from "./lazyInitializable.js";
import { MERGED_CONTENT_PREVIEW_MAX_LENGTH } from "./constants.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import { createStatusDelegate } from "./workflowStatusDelegate.js";

interface MultiInputServiceDeps {
  executionService: ExecutionServiceMethods;
  strategies: {
    auto: TriggerStrategy;
    direct: TriggerStrategy;
    branch: TriggerStrategy;
  };
}

class WorkflowMultiInputService extends LazyInitializable<MultiInputServiceDeps> {
  private isTargetPodBusy(
    targetPod: ReturnType<typeof podStore.getById>,
  ): boolean {
    if (targetPod === undefined) return false;
    return isPodBusy(targetPod.status);
  }

  private enqueueIfBusy(
    canvasId: string,
    connection: Connection,
    completedSummaries: Map<string, string>,
    mergedContent: string,
    triggerMode: AutoTriggerMode,
    runContext?: RunContext,
  ): void {
    const targetPod = podStore.getById(canvasId, connection.targetPodId);
    const channel = runContext ? "Run" : "Workflow";
    logger.log(
      channel,
      "Update",
      `目標 Pod "${targetPod?.name ?? connection.targetPodId}" 忙碌中，將合併的 workflow 加入佇列`,
    );

    const primarySourcePodId = Array.from(completedSummaries.keys())[0];
    const enqueueItem = {
      canvasId,
      connectionId: connection.id,
      sourcePodId: primarySourcePodId,
      targetPodId: connection.targetPodId,
      summary: mergedContent,
      isSummarized: true,
      triggerMode,
      runContext,
    };

    if (runContext) {
      runQueueService.enqueue({ ...enqueueItem, runContext });
    } else {
      workflowQueueService.enqueue(enqueueItem);
    }

    // 安全網：立即嘗試消化佇列，防止 enqueue 發生在最後一次 scheduleNextInQueue 之後導致佇列卡住
    const delegate = createStatusDelegate(runContext);
    delegate.scheduleNextInQueue(canvasId, connection.targetPodId);

    const pendingKey = resolvePendingKey(connection.targetPodId, runContext);
    pendingTargetStore.clearPendingTarget(pendingKey);
  }

  private recordAndCheckAllSourcesReady(
    targetPodId: string,
    sourcePodId: string,
    requiredSourcePodIds: string[],
    summary: string,
    runContext?: RunContext,
  ): { ready: boolean; hasRejection: boolean } {
    const pendingKey = resolvePendingKey(targetPodId, runContext);
    const { allSourcesResponded, hasRejection } =
      pendingTargetStore.recordSourceCompletion(
        pendingKey,
        sourcePodId,
        summary,
        requiredSourcePodIds,
      );

    return { ready: allSourcesResponded, hasRejection };
  }

  private getMergedContentOrNull(
    canvasId: string,
    targetPodId: string,
    runContext?: RunContext,
  ): { completedSummaries: Map<string, string>; mergedContent: string } | null {
    const pendingKey = resolvePendingKey(targetPodId, runContext);
    const completedSummaries =
      pendingTargetStore.getCompletedSummaries(pendingKey);
    if (!completedSummaries) {
      return null;
    }

    const mergedContent = formatMergedSummaries(completedSummaries, (podId) =>
      podStore.getById(canvasId, podId),
    );

    return { completedSummaries, mergedContent };
  }

  private async checkMultiInputReadiness(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    requiredSourcePodIds: string[],
    summary: string,
    runContext?: RunContext,
  ): Promise<"not-ready" | "rejected" | "ready"> {
    const { ready, hasRejection } = this.recordAndCheckAllSourcesReady(
      connection.targetPodId,
      sourcePodId,
      requiredSourcePodIds,
      summary,
      runContext,
    );

    if (!ready) {
      workflowStateService.emitPendingStatus(
        canvasId,
        connection.targetPodId,
        runContext,
      );
      return "not-ready";
    }

    if (hasRejection) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      logger.log(
        "Workflow",
        "Update",
        `目標「${targetPod?.name ?? connection.targetPodId}」有被拒絕的來源，不觸發`,
      );
      workflowStateService.emitPendingStatus(
        canvasId,
        connection.targetPodId,
        runContext,
      );
      return "rejected";
    }

    return "ready";
  }

  async handleMultiInputForConnection(
    params: HandleMultiInputForConnectionParams,
  ): Promise<void> {
    const {
      canvasId,
      sourcePodId,
      connection,
      summary,
      triggerMode,
      runContext,
    } = params;
    const requiredSourcePodIds = getMultiInputGroupConnections(
      canvasId,
      connection.targetPodId,
    ).map((c) => c.sourcePodId);

    const readiness = await this.checkMultiInputReadiness(
      canvasId,
      sourcePodId,
      connection,
      requiredSourcePodIds,
      summary,
      runContext,
    );
    if (readiness !== "ready") {
      // Bug B 收尾：整組 multi-input 被 rejected 時，
      // 將已 approved 連線的 connectionStatus 收回 idle，
      // 避免 FE isWorkflowRunning BFS 認為仍在執行導致橡皮擦卡 disabled
      if (readiness === "rejected") {
        const groupConnections = getMultiInputGroupConnections(
          canvasId,
          connection.targetPodId,
        );
        for (const conn of groupConnections) {
          if (conn.decideStatus === "approved") {
            connectionStore.updateConnectionStatus(canvasId, conn.id, "idle");
            const updated = connectionStore.getById(canvasId, conn.id);
            if (updated) {
              const payload: ConnectionUpdatedPayload = {
                requestId: "",
                canvasId,
                success: true,
                connection: updated,
              };
              socketService.emitToCanvas(
                canvasId,
                WebSocketResponseEvents.CONNECTION_UPDATED,
                payload,
              );
            }
          }
        }
      }
      return;
    }

    const merged = this.getMergedContentOrNull(
      canvasId,
      connection.targetPodId,
      runContext,
    );
    if (!merged) return;

    if (!runContext) {
      const targetPod = podStore.getById(canvasId, connection.targetPodId);
      if (this.isTargetPodBusy(targetPod)) {
        this.enqueueIfBusy(
          canvasId,
          connection,
          merged.completedSummaries,
          merged.mergedContent,
          triggerMode,
        );
        return;
      }
    } else {
      const instance = runStore.getPodInstance(
        runContext.runId,
        connection.targetPodId,
      );
      if (instance?.status === "running") {
        this.enqueueIfBusy(
          canvasId,
          connection,
          merged.completedSummaries,
          merged.mergedContent,
          triggerMode,
          runContext,
        );
        return;
      }
    }

    this.triggerMergedWorkflow(canvasId, connection, triggerMode, runContext);
  }

  triggerMergedWorkflow(
    canvasId: string,
    connection: Connection,
    triggerMode: AutoTriggerMode,
    runContext?: RunContext,
  ): void {
    const merged = this.getMergedContentOrNull(
      canvasId,
      connection.targetPodId,
      runContext,
    );
    if (!merged) return;

    const { completedSummaries, mergedContent } = merged;

    if (!runContext) {
      podStore.setStatus(canvasId, connection.targetPodId, "chatting");
    }

    const mergedPreview = mergedContent.substring(
      0,
      MERGED_CONTENT_PREVIEW_MAX_LENGTH,
    );

    const sourcePodIds = Array.from(completedSummaries.keys());
    const mergedPayload: WorkflowSourcesMergedPayload = {
      canvasId,
      targetPodId: connection.targetPodId,
      sourcePodIds,
      mergedContentPreview: mergedPreview,
    };

    if (!runContext) {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED,
        mergedPayload,
      );
    }

    const strategy = this.deps.strategies[triggerMode];
    const delegate = createStatusDelegate(runContext);
    // 刻意不 await：合併工作流程是長時間操作，結果透過 WebSocket 通知
    fireAndForget(
      this.deps.executionService.triggerWorkflowWithSummary({
        canvasId,
        connectionId: connection.id,
        summary: mergedContent,
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy,
        runContext,
        delegate,
      }),
      "Workflow",
      `觸發合併工作流程失敗 ${connection.id}`,
    );

    const pendingKey = resolvePendingKey(connection.targetPodId, runContext);
    pendingTargetStore.clearPendingTarget(pendingKey);
  }
}

export const workflowMultiInputService = new WorkflowMultiInputService();
