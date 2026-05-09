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
import type { ConnectionUpdatedPayload } from "../../types/index.js";
import { branchDecisionService } from "./branchDecisionService.js";
import { workflowEventEmitter } from "./workflowEventEmitter.js";
import { connectionStore } from "../connectionStore.js";
import { socketService } from "../socketService.js";
import { podStore } from "../podStore.js";
import { workflowStateService } from "./workflowStateService.js";
import { pendingTargetStore } from "../pendingTargetStore.js";
import { workflowPipeline } from "./workflowPipeline.js";
import { workflowMultiInputService } from "./workflowMultiInputService.js";
import { abortRegistry } from "../provider/abortRegistry.js";
import {
  forEachMultiInputGroupConnection,
  formatConnectionLog,
  buildQueuedPayload,
  createMultiInputCompletionHandlers,
  emitQueueProcessed,
} from "./workflowHelpers.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage, isAbortError } from "../../utils/errorHelpers.js";
import { LazyInitializable } from "./lazyInitializable.js";
import { createStatusDelegate } from "./workflowStatusDelegate.js";
import { WebSocketResponseEvents } from "../../schemas/index.js";

type BranchDecisionService = typeof branchDecisionService;
type WorkflowEventEmitter = typeof workflowEventEmitter;
type ConnectionStore = typeof connectionStore;
type PodStore = typeof podStore;
type WorkflowStateService = typeof workflowStateService;
type PendingTargetStore = typeof pendingTargetStore;
type WorkflowPipeline = typeof workflowPipeline;
type WorkflowMultiInputService = typeof workflowMultiInputService;

interface BranchTriggerDependencies {
  branchDecisionService: BranchDecisionService;
  eventEmitter: WorkflowEventEmitter;
  connectionStore: ConnectionStore;
  podStore: PodStore;
  stateService: WorkflowStateService;
  pendingTargetStore: PendingTargetStore;
  pipeline: WorkflowPipeline;
  multiInputService: WorkflowMultiInputService;
}

class WorkflowBranchTriggerService
  extends LazyInitializable<BranchTriggerDependencies>
  implements TriggerStrategy
{
  readonly mode = "branch" as const;

  onTrigger(context: TriggerLifecycleContext): void {
    if (context.runContext) return;
    this.deps.eventEmitter.emitBranchTriggered(
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

  /**
   * decide() 將 processBranchConnections 的結果攤平為 TriggerDecideResult[]。
   * 供 TriggerStrategy 介面使用（通常由 pipeline 呼叫）。
   * 注意：branch 模式下，decide() 本身不負責 abort 處理，
   * abort 邏輯統一由 processBranchConnections 管理。
   */
  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    const { canvasId, sourcePodId, connections, runContext } = context;

    try {
      const { selectedConnectionId, rejectedConnectionIds } =
        await this.deps.branchDecisionService.decideBranch(
          canvasId,
          sourcePodId,
          connections,
          runContext,
        );

      logger.log(
        "Workflow",
        "Update",
        `[Branch] decideBranch 結果：selected=${selectedConnectionId ?? "None"}，rejected=${rejectedConnectionIds.join(", ")}`,
      );

      return connections.map((conn) => ({
        connectionId: conn.id,
        approved: conn.id === selectedConnectionId,
        reason: null,
        isError: false,
      }));
    } catch (error) {
      if (isAbortError(error)) {
        logger.log(
          "Workflow",
          "Update",
          `[Branch] decideBranch 被 abort，canvasId=${canvasId} sourcePodId=${sourcePodId}`,
        );
        // abort 情況：全部標記為 rejected（但由 processBranchConnections 處理撤回狀態）
        return connections.map((conn) => ({
          connectionId: conn.id,
          approved: false,
          reason: null,
          isError: false,
        }));
      }

      logger.error(
        "Workflow",
        "Error",
        "[Branch] branchDecisionService.decideBranch 失敗",
        error,
      );

      return connections.map((conn) => ({
        connectionId: conn.id,
        approved: false,
        reason: `錯誤：${getErrorMessage(error)}`,
        isError: true,
      }));
    }
  }

  /**
   * 廣播 CONNECTION_UPDATED 事件給所有在 canvas 的 socket clients。
   * 取回最新 connection 後構造 payload 廣播。
   */
  private broadcastConnectionUpdated(
    canvasId: string,
    connectionId: string,
  ): void {
    const updated = this.deps.connectionStore.getById(canvasId, connectionId);
    if (!updated) return;
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
      this.broadcastConnectionUpdated(canvasId, connection.id);
    }
  }

  /**
   * 撤回整批 connections 的 deciding 狀態（abort 情況使用）。
   * 將 connection status 清回 idle，decideStatus 清為 none。
   */
  private clearConnectionsDecidingStatus(
    canvasId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): void {
    if (runContext) return;
    for (const connection of connections) {
      this.deps.connectionStore.updateConnectionStatus(
        canvasId,
        connection.id,
        "idle",
      );
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "none",
        null,
      );
      this.broadcastConnectionUpdated(canvasId, connection.id);
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

  private handleApprovedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    runContext?: RunContext,
  ): void {
    if (!runContext) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "approved",
        null,
      );
      this.broadcastConnectionUpdated(canvasId, connection.id);
    }
    const connLog = this.buildConnectionLog(canvasId, sourcePodId, connection);
    logger.log("Workflow", "Create", `Branch 選中${connLog}`);
  }

  private triggerApprovedPipeline(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    delegate: ReturnType<typeof createStatusDelegate>,
    runContext?: RunContext,
  ): void {
    const decideResult: TriggerDecideResult = {
      connectionId: connection.id,
      approved: true,
      reason: null,
      isError: false,
    };
    const pipelineContext: PipelineContext = {
      canvasId,
      sourcePodId,
      connection,
      triggerMode: "branch",
      decideResult,
      runContext,
    };

    this.deps.pipeline
      .execute(pipelineContext, this)
      .catch((error: unknown) => {
        logger.error(
          "Workflow",
          "Error",
          `Branch Workflow 執行失敗，連線 ${connection.id}`,
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
            triggerMode: "branch",
          });
        }
      });
  }

  private emitRejectionEvents(
    canvasId: string,
    connection: Connection,
    sourcePodId: string,
    runContext?: RunContext,
  ): void {
    if (runContext) return;
    // 不發 per-connection branchResult；
    // 前端 handleBranchResult 會依 sourcePodId 撈整組 branch，
    // 由「approved 那次」的單一事件一併把其餘標 ai-rejected。
    // 若這裡再 emit selectedLabel=null，會把 approved 那條樣式覆寫掉。
    const connLog = this.buildConnectionLog(canvasId, sourcePodId, connection);
    logger.log("Workflow", "Update", `Branch 拒絕${connLog}`);
  }

  private shouldDeferToMultiInput(
    canvasId: string,
    targetPodId: string,
    _runContext?: RunContext,
  ): boolean {
    const { isMultiInput } = this.deps.stateService.checkMultiInputScenario(
      canvasId,
      targetPodId,
    );
    return isMultiInput;
  }

  private async handleRejectedConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    delegate: ReturnType<typeof createStatusDelegate>,
    runContext?: RunContext,
  ): Promise<void> {
    if (!delegate.isRunMode()) {
      this.deps.connectionStore.updateDecideStatus(
        canvasId,
        connection.id,
        "rejected",
        null,
      );
      this.broadcastConnectionUpdated(canvasId, connection.id);
    } else {
      delegate.settleAndSkipPath(canvasId, connection.targetPodId, "auto");
    }
    this.emitRejectionEvents(canvasId, connection, sourcePodId, runContext);

    if (
      this.shouldDeferToMultiInput(canvasId, connection.targetPodId, runContext)
    ) {
      await this.handleRejectedMultiInput(canvasId, sourcePodId, connection);
    }
  }

  private async handleRejectedMultiInput(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
  ): Promise<void> {
    const { requiredSourcePodIds } =
      this.deps.stateService.checkMultiInputScenario(
        canvasId,
        connection.targetPodId,
      );
    this.deps.pendingTargetStore.recordSourceRejection(
      connection.targetPodId,
      sourcePodId,
      "",
      requiredSourcePodIds,
    );
    this.deps.stateService.emitPendingStatus(canvasId, connection.targetPodId);
  }

  /**
   * 處理所有 branch connections 的決策流程。
   *
   * 流程：
   * 1. 發 pending 事件 + 設定 connections 為 ai-deciding 狀態
   * 2. 取得 abortSignal（若有）
   * 3. 呼叫 branchDecisionService.decideBranch 取得選中/拒絕 connectionId
   * 4. 若 abort：撤回狀態，結束
   * 5. 若有 selectedConnectionId：走 approved 流程 + triggerApprovedPipeline
   * 6. rejectedConnectionIds：走 rejected 流程（含 multi-input 路徑）
   */
  async processBranchConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<void> {
    const delegate = createStatusDelegate(runContext);

    this.setConnectionsToDeciding(canvasId, connections, runContext);

    const targetPodIds = [
      ...new Set(connections.map((conn) => conn.targetPodId)),
    ];
    for (const targetPodId of targetPodIds) {
      delegate.markDeciding(canvasId, targetPodId);
    }

    // 嘗試從 abortRegistry 取得 source pod 的 abortSignal
    // key 慣例：podId（normal mode）或 `${runId}:${podId}`（run mode）
    // 使用 get() 而非 register()，避免意外 abort 掉正在執行的 source pod streaming
    const abortKey = runContext
      ? `${runContext.runId}:${sourcePodId}`
      : sourcePodId;
    const abortSignal = abortRegistry.get(abortKey)?.signal;

    let selectedConnectionId: string | null = null;
    let rejectedConnectionIds: string[] = [];

    try {
      const result = await this.deps.branchDecisionService.decideBranch(
        canvasId,
        sourcePodId,
        connections,
        runContext,
        abortSignal,
      );
      selectedConnectionId = result.selectedConnectionId;
      rejectedConnectionIds = result.rejectedConnectionIds;
    } catch (error) {
      if (isAbortError(error)) {
        logger.log(
          "Workflow",
          "Update",
          `[Branch] 決策被 abort，撤回狀態，canvasId=${canvasId} sourcePodId=${sourcePodId}`,
        );
        // 非 run mode：清回 idle 狀態
        this.clearConnectionsDecidingStatus(canvasId, connections, runContext);
        // run mode：透過 delegate 讓所有 target pod 走 auto pathway 繼續流程
        if (runContext) {
          for (const connection of connections) {
            delegate.settleAndSkipPath(
              canvasId,
              connection.targetPodId,
              "auto",
            );
          }
        }
        return;
      }

      // 非 abort 的例外：branchDecisionService 內部應已處理並回傳結果，
      // 若仍拋出則視為全部拒絕（防禦性處理）
      logger.error(
        "Workflow",
        "Error",
        `[Branch] decideBranch 意外拋出例外，全部拒絕，canvasId=${canvasId}`,
        error,
      );
      selectedConnectionId = null;
      rejectedConnectionIds = connections.map((c) => c.id);
    }

    // 處理 approved connection
    if (selectedConnectionId !== null) {
      const approvedConn = connections.find(
        (c) => c.id === selectedConnectionId,
      );
      if (approvedConn) {
        this.handleApprovedConnection(
          canvasId,
          sourcePodId,
          approvedConn,
          runContext,
        );
        this.triggerApprovedPipeline(
          canvasId,
          sourcePodId,
          approvedConn,
          delegate,
          runContext,
        );
      }
    } else {
      // AI 選 None：所有 connections 皆拒絕（已在 rejectedConnectionIds）
      // rejected path 已在 handleRejectedConnection 逐條廣播 CONNECTION_UPDATED，不需額外 emit
      logger.log(
        "Workflow",
        "Update",
        `[Branch] AI 選 None，不觸發任何 pipeline，canvasId=${canvasId} sourcePodId=${sourcePodId}`,
      );
    }

    // 處理 rejected connections
    const rejectedSet = new Set(rejectedConnectionIds);
    for (const connection of connections) {
      if (!rejectedSet.has(connection.id)) continue;
      await this.handleRejectedConnection(
        canvasId,
        sourcePodId,
        connection,
        delegate,
        runContext,
      );
    }
  }
}

export const workflowBranchTriggerService = new WorkflowBranchTriggerService();
