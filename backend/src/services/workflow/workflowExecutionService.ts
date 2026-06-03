import type { TriggerMode, Connection } from "../../types/index.js";
import type {
  PipelineContext,
  PipelineMethods,
  BranchTriggerMethods,
  AutoTriggerMethods,
  TriggerStrategy,
  TriggerWorkflowWithSummaryParams,
  SettlementPathway,
} from "./types.js";
import type { ProviderName } from "../provider/index.js";
import { connectionStore } from "../connectionStore.js";
import { podStore } from "../podStore.js";
import { summaryService } from "../summaryService.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errorHelpers.js";
import { executeStreamingChat } from "../claude/streamingChatExecutor.js";
import {
  buildTransferMessage,
  forEachMultiInputGroupConnection,
  isAutoTriggerable,
} from "./workflowHelpers.js";
import { decideWorkflowSummary } from "./workflowRunDecisions.js";
import { LazyInitializable } from "./lazyInitializable.js";
import type { RunContext } from "../../types/run.js";
import {
  type WorkflowStatusDelegate,
  createStatusDelegate,
} from "./workflowStatusDelegate.js";
import { ChatExecutionStrategy } from "../executionStrategy.js";
import { getRunTranscriptWindow } from "./runTranscriptWindow.js";
import { workflowAsyncDispatchService } from "./workflowAsyncDispatchService.js";
import {
  completeWorkflowChatStage,
  enqueueWorkflowTriggerStage,
  failWorkflowChatStage,
  launchWorkflowChatStage,
} from "./workflowTriggerStages.js";

interface ExecutionServiceDeps {
  pipeline: PipelineMethods;
  branchTriggerService: BranchTriggerMethods;
  autoTriggerService: AutoTriggerMethods;
  directTriggerService: TriggerStrategy;
}

/**
 * 代表預期的使用者可見業務錯誤，訊息可安全傳送給客戶端。
 * 拋出此類別的錯誤時，message 會直接廣播；其他 Error 則以通用訊息替代。
 */
export class WorkflowUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowUserError";
  }
}

/**
 * 過濾錯誤訊息，避免將系統內部細節（路徑、堆疊等）洩漏給客戶端。
 * 只有 WorkflowUserError 的 message 允許原樣傳遞。
 */
function sanitizeErrorForClient(error: Error): string {
  if (error instanceof WorkflowUserError) {
    return error.message;
  }
  return "工作流程執行失敗";
}

interface WorkflowChatContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
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

  private buildDirectPipelineContext(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    runContext: RunContext,
    delegate: WorkflowStatusDelegate,
  ): PipelineContext {
    return {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: "direct",
      decideResult: {
        connectionId: connection.id,
        approved: true,
        reason: null,
        isError: false,
      },
      runContext,
      delegate,
    };
  }

  private triggerDirectConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext: RunContext,
  ): Promise<unknown>[] {
    const delegate = createStatusDelegate(runContext);
    return connections
      .filter((conn) => conn.triggerMode === "direct")
      .map((connection) => {
        const pipelineContext = this.buildDirectPipelineContext(
          canvasId,
          sourcePodId,
          connection,
          runContext,
          delegate,
        );
        return this.deps.pipeline.execute(
          pipelineContext,
          this.deps.directTriggerService,
        );
      });
  }

  async checkAndTriggerWorkflows(
    canvasId: string,
    sourcePodId: string,
    runContext: RunContext,
  ): Promise<void> {
    const connections = connectionStore.findBySourcePodId(
      canvasId,
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
      ...this.triggerDirectConnections(
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

    const connection = connectionStore.getById(canvasId, connectionId);
    if (!connection) {
      logger.warn(
        "Workflow",
        "Warn",
        `triggerWorkflowWithSummary: Connection ${connectionId} 已不存在，跳過觸發`,
      );
      return;
    }

    const { sourcePodId, targetPodId } = connection;

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      logger.warn(
        "Workflow",
        "Warn",
        `triggerWorkflowWithSummary: 找不到目標 Pod ${targetPodId}，跳過觸發`,
      );
      return;
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    logger.log(
      "Workflow",
      "Create",
      `觸發工作流程：Pod "${sourcePod?.name ?? sourcePodId}" → Pod "${targetPod.name}"`,
    );

    const triggerMode = connection.triggerMode;
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

    this.setConnectionsToActive(
      canvasId,
      connectionId,
      targetPodId,
      triggerMode,
      resolvedConnectionIds,
      runContext,
    );

    strategy.onTrigger({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      summary,
      isSummarized,
      participatingConnectionIds: resolvedConnectionIds,
      sourcePodIds,
      sourcePodNames,
      runContext,
    });

    // 刻意不 await：Claude 查詢是長時間操作，結果透過 WebSocket 事件通知前端。
    // 若改為 await，呼叫方的 Promise.allSettled 會等到查詢完成才繼續，喪失多 connection 並行觸發的能力。
    launchWorkflowChatStage({
      canvasId,
      connectionId,
      beforeLaunch: () => {
        delegate.startPodExecution(canvasId, targetPodId);
      },
      createQueryPromise: () =>
        this.executeClaudeQuery({
          canvasId,
          connectionId,
          sourcePodId,
          targetPodId,
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

  private activateConnections(canvasId: string, connectionIds: string[]): void {
    for (const id of connectionIds) {
      const stillExists = connectionStore.getById(canvasId, id);
      if (!stillExists) {
        logger.warn(
          "Workflow",
          "Warn",
          `Connection ${id} 已不存在，跳過 active 狀態設定`,
        );
        continue;
      }
      connectionStore.updateConnectionStatus(canvasId, id, "active");
    }
  }

  /**
   * 純函數：依 triggerMode 回傳應設為 active 的 connection id 清單。
   * 不讀取 runContext，不產生副作用。
   */
  private resolveConnectionIdsToActivate(
    canvasId: string,
    targetPodId: string,
    triggerMode: TriggerMode,
    participatingConnectionIds: string[],
  ): string[] {
    if (isAutoTriggerable(triggerMode)) {
      const multiInputIds: string[] = [];
      forEachMultiInputGroupConnection(canvasId, targetPodId, (conn) =>
        multiInputIds.push(conn.id),
      );
      return multiInputIds;
    }
    return participatingConnectionIds;
  }

  private setConnectionsToActive(
    canvasId: string,
    connectionId: string,
    targetPodId: string,
    triggerMode: TriggerMode,
    participatingConnectionIds: string[],
    runContext: RunContext,
  ): void {
    // run mode 下 connection 是模板，不應改變全域狀態
    if (runContext) return;

    const ids = this.resolveConnectionIdsToActivate(
      canvasId,
      targetPodId,
      triggerMode,
      participatingConnectionIds,
    );
    this.activateConnections(canvasId, ids);
  }

  private async onWorkflowChatComplete(params: WorkflowChatContext): Promise<void> {
    const {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
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
      participatingConnectionIds,
      strategy,
      runContext,
      delegate,
    } = params;
    // 過濾 error.message：只有 WorkflowUserError（業務錯誤）才允許原樣傳給客戶端
    const clientErrorMessage = sanitizeErrorForClient(error);
    failWorkflowChatStage({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
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
    const baseMessage = buildTransferMessage(content);

    const execStrategy = new ChatExecutionStrategy(canvasId, runContext);

    await execStrategy.addUserMessage(targetPodId, baseMessage);
    const sourcePodNames =
      params.sourcePodNames ??
      [
        podStore.getById(canvasId, params.sourcePodId)?.name ??
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
        onError: (_canvasId, _podId, error) =>
          this.onWorkflowChatError(params, error),
      },
    );
  }
}

export const workflowExecutionService = new WorkflowExecutionService();
