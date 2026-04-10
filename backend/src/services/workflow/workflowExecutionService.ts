import type { TriggerMode, Connection, ModelType } from "../../types/index.js";
import type {
  PipelineContext,
  PipelineMethods,
  AiDecideMethods,
  AutoTriggerMethods,
  TriggerStrategy,
  TriggerWorkflowWithSummaryParams,
  SettlementPathway,
} from "./types.js";
import { connectionStore } from "../connectionStore.js";
import { podStore } from "../podStore.js";
import { summaryService } from "../summaryService.js";
import { logger } from "../../utils/logger.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import { commandService } from "../commandService.js";
import { executeStreamingChat } from "../claude/streamingChatExecutor.js";
import {
  buildTransferMessage,
  buildMessageWithCommand,
  forEachMultiInputGroupConnection,
  isAutoTriggerable,
  resolveSettlementPathway,
} from "./workflowHelpers.js";
import { LazyInitializable } from "./lazyInitializable.js";
import type { RunContext } from "../../types/run.js";
import {
  type WorkflowStatusDelegate,
  createStatusDelegate,
} from "./workflowStatusDelegate.js";
import { NormalModeExecutionStrategy } from "../normalExecutionStrategy.js";
import { RunModeExecutionStrategy } from "../executionStrategy.js";

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
  runContext?: RunContext;
  delegate: WorkflowStatusDelegate;
}

class WorkflowExecutionService extends LazyInitializable<ExecutionServiceDeps> {
  private getLastAssistantFallback(
    sourcePodId: string,
    runContext?: RunContext,
  ): { content: string; isSummarized: boolean } | null {
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
    runContext?: RunContext,
    summaryModel?: ModelType,
    pathway?: SettlementPathway,
    delegate?: WorkflowStatusDelegate,
  ): Promise<{ content: string; isSummarized: boolean } | null> {
    const resolvedDelegate = delegate ?? createStatusDelegate(runContext);

    resolvedDelegate.markSummarizing(canvasId, sourcePodId);

    const summaryResult = await summaryService.generateSummaryForTarget(
      canvasId,
      sourcePodId,
      targetPodId,
      runContext,
      summaryModel,
    );

    if (summaryResult.success) {
      resolvedDelegate.onSummaryComplete(canvasId, sourcePodId, pathway);
      return { content: summaryResult.summary, isSummarized: true };
    }

    logger.error("Workflow", "Error", `生成摘要失敗：${summaryResult.error}`);
    const fallback = this.getLastAssistantFallback(sourcePodId, runContext);

    if (!fallback) {
      resolvedDelegate.onSummaryFailed(canvasId, sourcePodId, "無法生成摘要");
      return null;
    }

    resolvedDelegate.onSummaryComplete(canvasId, sourcePodId, pathway);
    return fallback;
  }

  private triggerAutoConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
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

  private triggerAiDecideConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<unknown> {
    const aiDecideConnections = connections.filter(
      (conn) => conn.triggerMode === "ai-decide",
    );
    if (aiDecideConnections.length === 0) return Promise.resolve();
    return this.deps.aiDecideTriggerService.processAiDecideConnections(
      canvasId,
      sourcePodId,
      aiDecideConnections,
      runContext,
    );
  }

  private triggerDirectConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<unknown>[] {
    return connections
      .filter((conn) => conn.triggerMode === "direct")
      .map((connection) => {
        const pipelineContext: PipelineContext = {
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
        };
        return this.deps.pipeline.execute(
          pipelineContext,
          this.deps.directTriggerService,
        );
      });
  }

  async checkAndTriggerWorkflows(
    canvasId: string,
    sourcePodId: string,
    runContext?: RunContext,
  ): Promise<void> {
    const connections = connectionStore.findBySourcePodId(
      canvasId,
      sourcePodId,
    );

    if (connections.length === 0) {
      return;
    }

    await Promise.allSettled([
      ...this.triggerAutoConnections(
        canvasId,
        sourcePodId,
        connections,
        runContext,
      ),
      this.triggerAiDecideConnections(
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
      strategy,
      runContext,
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
      throw new Error(`找不到 Pod：${targetPodId}`);
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    logger.log(
      "Workflow",
      "Create",
      `觸發工作流程：Pod "${sourcePod?.name ?? sourcePodId}" → Pod "${targetPod.name}"`,
    );

    const triggerMode = connection.triggerMode;
    const resolvedConnectionIds = participatingConnectionIds ?? [connectionId];

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
      runContext,
    });

    delegate.startPodExecution(canvasId, targetPodId);

    // 刻意不 await：Claude 查詢是長時間操作，結果透過 WebSocket 事件通知前端。
    // 若改為 await，呼叫方的 Promise.allSettled 會等到查詢完成才繼續，喪失多 connection 並行觸發的能力。
    fireAndForget(
      this.executeClaudeQuery({
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        content: summary,
        participatingConnectionIds: resolvedConnectionIds,
        strategy,
        runContext,
        delegate,
      }),
      "Workflow",
      `executeClaudeQuery 執行失敗 (connection: ${connectionId})`,
    );
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

  private setConnectionsToActive(
    canvasId: string,
    connectionId: string,
    targetPodId: string,
    triggerMode: TriggerMode,
    participatingConnectionIds: string[],
    runContext?: RunContext,
  ): void {
    // run mode 下 connection 是模板，不應改變全域狀態
    if (runContext) return;

    if (isAutoTriggerable(triggerMode)) {
      const multiInputIds: string[] = [];
      forEachMultiInputGroupConnection(canvasId, targetPodId, (conn) =>
        multiInputIds.push(conn.id),
      );
      this.activateConnections(canvasId, multiInputIds);
      return;
    }
    this.activateConnections(canvasId, participatingConnectionIds);
  }

  private async onWorkflowChatComplete(
    params: WorkflowChatContext,
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
    strategy.onComplete(
      {
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        triggerMode: strategy.mode,
        participatingConnectionIds,
        runContext,
      },
      true,
    );
    delegate.onChatComplete(
      canvasId,
      targetPodId,
      resolveSettlementPathway(strategy.mode),
    );

    // 刻意不 await：下游 workflow 觸發獨立於當前查詢完成流程
    fireAndForget(
      this.checkAndTriggerWorkflows(canvasId, targetPodId, runContext),
      "Workflow",
      `下游 workflow 觸發失敗 (pod: ${targetPodId})`,
    );

    delegate.scheduleNextInQueue(canvasId, targetPodId);
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
    strategy.onError(
      {
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        triggerMode: strategy.mode,
        participatingConnectionIds,
        runContext,
      },
      error.message,
    );
    logger.error("Workflow", "Error", "Workflow 執行失敗", error);

    delegate.onChatError(canvasId, targetPodId, error.message);
    delegate.scheduleNextInQueue(canvasId, targetPodId);
  }

  private async executeClaudeQuery(
    params: WorkflowChatContext & { content: string },
  ): Promise<void> {
    const { canvasId, targetPodId, content, runContext, delegate } = params;
    const baseMessage = buildTransferMessage(content);
    const targetPod = podStore.getById(canvasId, targetPodId);
    const commands = await commandService.list();
    const messageToSend = buildMessageWithCommand(
      baseMessage,
      targetPod,
      commands,
    );

    // 依據是否為 Run mode 建立對應的 strategy，並透過 strategy 注入使用者訊息
    const execStrategy =
      runContext && delegate.isRunMode()
        ? new RunModeExecutionStrategy(canvasId, runContext)
        : new NormalModeExecutionStrategy(canvasId);

    await execStrategy.addUserMessage(targetPodId, messageToSend);

    await executeStreamingChat(
      {
        canvasId,
        podId: targetPodId,
        message: messageToSend,
        abortable: false,
        strategy: execStrategy,
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
