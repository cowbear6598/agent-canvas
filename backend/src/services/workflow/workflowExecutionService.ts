import type { TriggerMode, Connection } from "../../types/index.js";
import type {
  PipelineMethods,
  BranchTriggerMethods,
  AutoTriggerMethods,
  TriggerStrategy,
  TriggerWorkflowWithSummaryParams,
  SettlementPathway,
} from "./types.js";
import type { ProviderName } from "../provider/index.js";
import { runStore } from "../runStore.js";
import { summaryService } from "../summaryService.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errorHelpers.js";
import { executeStreamingChat } from "../claude/streamingChatExecutor.js";
import { buildTransferMessage } from "./workflowHelpers.js";
import { decideWorkflowSummary } from "./workflowRunDecisions.js";
import { LazyInitializable } from "./lazyInitializable.js";
import type { RunContext } from "../../types/run.js";
import {
  type WorkflowStatusDelegate,
  createStatusDelegate,
} from "./workflowStatusDelegate.js";
import { ChatExecutionStrategy } from "../executionStrategy.js";
import { runExecutionService } from "./runExecutionService.js";
import { getRunTranscriptWindow } from "./runTranscriptWindow.js";
import { workflowAsyncDispatchService } from "./workflowAsyncDispatchService.js";
import {
  completeWorkflowChatStage,
  enqueueWorkflowTriggerStage,
  failWorkflowChatStage,
  launchWorkflowChatStage,
} from "./workflowTriggerStages.js";
import { getUserVisibleErrorMessage } from "../../utils/userVisibleError.js";
import { resolveLoopSessionContinuity } from "./workflowLoopPolicy.js";
import { runWorkflowSnapshotStore } from "./runWorkflowSnapshotStore.js";

interface ExecutionServiceDeps {
  pipeline: PipelineMethods;
  branchTriggerService: BranchTriggerMethods;
  autoTriggerService: AutoTriggerMethods;
  directTriggerService: TriggerStrategy;
}

/**
 * 過濾錯誤訊息，避免將系統內部細節（路徑、堆疊等）洩漏給客戶端。
 * 只有 UserVisibleError 類型的 message 允許原樣傳遞。
 */
function sanitizeErrorForClient(error: Error): string {
  return getUserVisibleErrorMessage(error) ?? "工作流程執行失敗";
}

function isTerminalRunPod(runContext: RunContext, podId: string): boolean {
  const instance = runStore.getPodInstance(runContext.runId, podId);
  return instance?.status === "blocked" || instance?.status === "error";
}

function isRunActive(runContext: RunContext): boolean {
  return runStore.getRun(runContext.runId)?.status === "running";
}

interface WorkflowChatContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode: TriggerMode;
  participatingConnectionIds: string[];
  sourcePodIds?: string[];
  sourcePodNames?: string[];
  strategy: TriggerStrategy;
  runContext: RunContext;
  delegate: WorkflowStatusDelegate;
}

/** 摘要失敗時的 fallback 結果型別（直接取既有摘要或原始訊息，未經 disposableChat） */
type SummaryFallback = { content: string; isSummarized: boolean };

class WorkflowExecutionService extends LazyInitializable<ExecutionServiceDeps> {
  isCyclicPod(runContext: RunContext, podId: string): boolean {
    return runExecutionService.isCyclicPod(runContext, podId);
  }

  private getSummaryFallback(
    sourcePodId: string,
    runContext: RunContext,
  ): SummaryFallback | null {
    const transcriptWindow = getRunTranscriptWindow(
      runContext.runId,
      sourcePodId,
      8,
    );
    if (transcriptWindow.persistedSummary) {
      return {
        content: transcriptWindow.persistedSummary,
        isSummarized: false,
      };
    }

    const fallback = this.deps.autoTriggerService.getLastAssistantMessage(
      sourcePodId,
      runContext,
    );
    return fallback ? { content: fallback, isSummarized: false } : null;
  }

  async generateSummaryWithFallback(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    provider: ProviderName,
    summaryModel: string,
    summaryThinkingLevel: string | null,
    runContext: RunContext,
    pathway?: SettlementPathway,
    delegate?: WorkflowStatusDelegate,
  ): Promise<{
    content: string;
    isSummarized: boolean;
    /** disposableChatService 實際使用的模型；fallback 路徑下為 undefined */
    resolvedModel?: string;
  } | null> {
    const resolvedDelegate = delegate ?? createStatusDelegate(runContext);

    resolvedDelegate.markSummarizing(canvasId, sourcePodId);

    const summaryResult = await summaryService.generateSummaryForTarget(
      canvasId,
      sourcePodId,
      targetPodId,
      provider,
      summaryModel,
      summaryThinkingLevel,
      runContext,
    );

    const fallback = summaryResult.success
      ? null
      : this.getSummaryFallback(sourcePodId, runContext);
    const decision = decideWorkflowSummary(
      summaryResult.success,
      summaryResult.summary,
      summaryResult.resolvedModel,
      fallback?.content ?? null,
      "無法生成摘要",
    );

    if (decision.kind === "complete") {
      resolvedDelegate.onSummaryComplete(canvasId, sourcePodId, pathway);
      return {
        content: decision.content,
        isSummarized: decision.isSummarized,
        resolvedModel: decision.resolvedModel,
      };
    }

    resolvedDelegate.onSummaryFailed(
      canvasId,
      sourcePodId,
      decision.errorMessage,
    );
    return null;
  }

  private triggerAutoConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext: RunContext,
  ): Promise<unknown>[] {
    return connections
      .filter((conn) => conn.triggerMode === "auto")
      .map((connection) =>
        this.deps.autoTriggerService.processAutoTriggerConnection(
          canvasId,
          sourcePodId,
          connection,
          runContext,
        ),
      );
  }

  private triggerBranchConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext: RunContext,
  ): Promise<unknown> {
    const branchConnections = connections.filter(
      (conn) => conn.triggerMode === "branch",
    );
    if (branchConnections.length === 0) return Promise.resolve();
    return this.deps.branchTriggerService.processBranchConnections(
      canvasId,
      sourcePodId,
      branchConnections,
      runContext,
    );
  }

  async checkAndTriggerWorkflows(
    canvasId: string,
    sourcePodId: string,
    runContext: RunContext,
  ): Promise<void> {
    if (!isRunActive(runContext)) return;

    const connections = runWorkflowSnapshotStore.findConnectionsBySourcePodId(
      runContext.runId,
      sourcePodId,
    );

    if (connections.length === 0) {
      return;
    }

    const results = await Promise.allSettled([
      ...this.triggerAutoConnections(
        canvasId,
        sourcePodId,
        connections,
        runContext,
      ),
      this.triggerBranchConnections(
        canvasId,
        sourcePodId,
        connections,
        runContext,
      ),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Workflow", "Error", "Workflow 觸發失敗", result.reason);
      }
    }

    const rejectedResults = results.filter(
      (result) => result.status === "rejected",
    );
    if (rejectedResults.length > 0) {
      const messages = rejectedResults.map((result) =>
        getErrorMessage(result.reason),
      );
      throw new Error(`Workflow 觸發失敗：${messages.join("；")}`);
    }
  }

  async triggerWorkflowWithSummary(
    params: TriggerWorkflowWithSummaryParams,
  ): Promise<void> {
    const {
      canvasId,
      connectionId,
      summary,
      isSummarized,
      participatingConnectionIds,
      sourcePodIds,
      sourcePodNames,
      strategy,
      runContext,
      skipBusyCheck,
    } = params;
    const delegate = params.delegate ?? createStatusDelegate(runContext);

    if (!isRunActive(runContext)) return;

    const connection = runWorkflowSnapshotStore.getConnection(
      runContext.runId,
      connectionId,
    );
    if (!connection) {
      logger.warn(
        "Workflow",
        "Warn",
        `triggerWorkflowWithSummary: Connection ${connectionId} 已不存在，跳過觸發`,
      );
      return;
    }

    const { sourcePodId, targetPodId } = connection;

    const targetPod = runWorkflowSnapshotStore.getPod(
      runContext.runId,
      targetPodId,
    );
    if (!targetPod) {
      logger.warn(
        "Workflow",
        "Warn",
        `triggerWorkflowWithSummary: 找不到目標 Pod ${targetPodId}，跳過觸發`,
      );
      return;
    }

    const sourcePod = runWorkflowSnapshotStore.getPod(
      runContext.runId,
      sourcePodId,
    );
    logger.log(
      "Workflow",
      "Create",
      `觸發工作流程：Pod "${sourcePod?.name ?? sourcePodId}" → Pod "${targetPod.name}"`,
    );

    if (isTerminalRunPod(runContext, targetPodId)) {
      logger.warn(
        "Workflow",
        "Warn",
        `triggerWorkflowWithSummary: 目標 Pod ${targetPodId} 已為終態，跳過觸發`,
      );
      return;
    }

    const triggerMode = params.triggerMode ?? strategy.mode;
    const resolvedConnectionIds = participatingConnectionIds ?? [connectionId];

    if (
      !skipBusyCheck &&
      enqueueWorkflowTriggerStage(delegate, {
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        summary,
        isSummarized,
        triggerMode,
        participatingConnectionIds: resolvedConnectionIds,
        sourcePodIds,
        sourcePodNames,
        runContext,
      })
    ) {
      return;
    }

    // 刻意不 await：Claude 查詢是長時間操作，結果透過 WebSocket 事件通知前端。
    // 若改為 await，呼叫方的 Promise.allSettled 會等到查詢完成才繼續，喪失多 connection 並行觸發的能力。
    launchWorkflowChatStage({
      canvasId,
      connectionId,
      beforeLaunch: () => {
        if (this.isCyclicPod(runContext, sourcePodId)) {
          delegate.startPodExecution(canvasId, targetPodId, true);
        } else {
          delegate.startPodExecution(canvasId, targetPodId);
        }
      },
      createQueryPromise: () =>
        this.executeClaudeQuery({
          canvasId,
          connectionId,
          sourcePodId,
          targetPodId,
          triggerMode,
          content: summary,
          participatingConnectionIds: resolvedConnectionIds,
          sourcePodIds,
          sourcePodNames,
          strategy,
          runContext,
          delegate,
        }),
      dispatchConnectionQuery: (promise, launchedConnectionId) =>
        workflowAsyncDispatchService.dispatchConnectionQuery(
          promise,
          launchedConnectionId,
        ),
    });
  }

  private async onWorkflowChatComplete(params: WorkflowChatContext): Promise<void> {
    const {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      triggerMode,
      participatingConnectionIds,
      strategy,
      runContext,
      delegate,
    } = params;
    await completeWorkflowChatStage({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      triggerMode,
      participatingConnectionIds,
      sourcePodIds: params.sourcePodIds,
      sourcePodNames: params.sourcePodNames,
      strategy,
      runContext,
      delegate,
      checkAndTriggerWorkflows: () =>
        this.checkAndTriggerWorkflows(canvasId, targetPodId, runContext),
    });
  }

  private async onWorkflowChatError(
    params: WorkflowChatContext,
    error: Error,
  ): Promise<void> {
    const {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      triggerMode,
      participatingConnectionIds,
      strategy,
      runContext,
      delegate,
    } = params;
    // 過濾 error.message：只有 UserVisibleError（業務錯誤）才允許原樣傳給客戶端
    const clientErrorMessage = sanitizeErrorForClient(error);
    failWorkflowChatStage({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      triggerMode,
      participatingConnectionIds,
      sourcePodIds: params.sourcePodIds,
      sourcePodNames: params.sourcePodNames,
      strategy,
      runContext,
      delegate,
      error,
      clientErrorMessage,
    });
  }

  private async executeClaudeQuery(
    params: WorkflowChatContext & { content: string },
  ): Promise<void> {
    const { canvasId, targetPodId, content, runContext } = params;
    if (!isRunActive(runContext)) return;

    const baseMessage = buildTransferMessage(content);

    const execStrategy = new ChatExecutionStrategy(
      canvasId,
      runContext,
      resolveLoopSessionContinuity(
        this.isCyclicPod(runContext, targetPodId),
      ),
    );

    await execStrategy.addUserMessage(targetPodId, baseMessage);
    const sourcePodNames =
      params.sourcePodNames ??
      [
        runWorkflowSnapshotStore.getPod(runContext.runId, params.sourcePodId)
          ?.name ??
          params.sourcePodId,
      ];

    await executeStreamingChat(
      {
        canvasId,
        podId: targetPodId,
        message: baseMessage,
        abortable: false,
        strategy: execStrategy,
        goalRoundDivider: {
          sourcePodIds: params.sourcePodIds ?? [params.sourcePodId],
          sourcePodNames,
          connectionIds: params.participatingConnectionIds,
        },
      },
      {
        onComplete: (_canvasId, _podId) => this.onWorkflowChatComplete(params),
        onBlocked: (_canvasId, _podId, reason) => {
          runExecutionService.blockedPodInstance(runContext, targetPodId, reason);
          params.delegate.scheduleNextInQueue(canvasId, targetPodId);
        },
        onError: (_canvasId, _podId, error) =>
          this.onWorkflowChatError(params, error),
      },
    );
  }
}

export const workflowExecutionService = new WorkflowExecutionService();
