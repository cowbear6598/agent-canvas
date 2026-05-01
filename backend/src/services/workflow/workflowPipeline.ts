import type {
  PipelineContext,
  TriggerStrategy,
  ExecutionServiceMethods,
  MultiInputServiceMethods,
  QueueServiceMethods,
} from "./types.js";
import type { WorkflowStatusDelegate } from "./workflowStatusDelegate.js";
import { podStore } from "../podStore.js";
import { connectionStore } from "../connectionStore.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/index.js";
import type { ConnectionUpdatedPayload } from "../../types/index.js";
import { runStore, TRIGGERABLE_STATUSES } from "../runStore.js";
import { logger } from "../../utils/logger.js";
import { LazyInitializable } from "./lazyInitializable.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import {
  resolveSettlementPathway,
  getMultiInputGroupConnections,
} from "./workflowHelpers.js";

interface PipelineDeps {
  executionService: ExecutionServiceMethods;
  multiInputService: MultiInputServiceMethods;
  queueService: QueueServiceMethods;
}

/** 佇列操作的共用參數 */
interface EnqueueParams {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  finalSummary: string;
  finalIsSummarized: boolean;
  triggerMode: PipelineContext["triggerMode"];
  participatingConnectionIds?: string[];
  runContext: PipelineContext["runContext"];
}

class WorkflowPipeline extends LazyInitializable<PipelineDeps> {
  /**
   * 純函數：判斷 run instance 下的目標 Pod 是否可被觸發。
   * 回傳 false 表示應跳過觸發。
   */
  private isRunInstanceTriggerable(
    runContext: PipelineContext["runContext"],
    targetPodId: string,
  ): boolean {
    if (!runContext) return true;
    const targetInstance = runStore.getPodInstance(
      runContext.runId,
      targetPodId,
    );
    return !targetInstance || TRIGGERABLE_STATUSES.has(targetInstance.status);
  }

  /**
   * lazy 修正：若 disposableChatService 因 model 不合法做了 fallback，
   * 將合法的 resolvedModel 寫回 DB 並廣播 CONNECTION_UPDATED，
   * 讓前端右鍵選單下次拿到合法的 model 值。
   */
  private reconcileSummaryModelIfNeeded(
    canvasId: string,
    connectionId: string,
    connection: PipelineContext["connection"],
    resolvedModel: string,
  ): void {
    if (resolvedModel === connection.summaryModel) return;

    const updatedConnection = connectionStore.update(canvasId, connectionId, {
      summaryModel: resolvedModel,
    });
    if (!updatedConnection) return;

    const broadcastPayload: ConnectionUpdatedPayload = {
      requestId: "",
      canvasId,
      success: true,
      connection: updatedConnection,
    };
    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.CONNECTION_UPDATED,
      broadcastPayload,
    );
    logger.log(
      "Workflow",
      "Pipeline",
      `[lazyModel] connection "${connectionId}" summaryModel 已由 "${connection.summaryModel}" 修正為 "${resolvedModel}"`,
    );
  }

  /**
   * 【效能說明 — fan-out 批次處理】
   *
   * execute() 一次僅處理「單一 connection」（一個 sourcePod → 一個 targetPod）。
   * fan-out 場景（一個 sourcePod 觸發多個下游 targetPod）是由上層呼叫方
   *（workflowService / triggerService 等）對每條 connection 個別呼叫 execute()。
   *
   * 因此「N 條 connection 在同一個 execute() 內同時修正 summaryModel 並廣播」的場景
   * 並不存在——每次呼叫只可能有一次 DB write 與一次廣播，不需要在 execute() 內
   * 做批次合併。
   *
   * 若未來上層改為在單一 execute() 內處理多條 connection，
   * 應在此處改用 Promise.all 並行 update，再合併成一個 batch 廣播事件。
   */
  async execute(
    context: PipelineContext,
    strategy: TriggerStrategy,
  ): Promise<void> {
    const { canvasId, sourcePodId, connection, triggerMode, runContext } =
      context;
    const { targetPodId, id: connectionId } = connection;

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      logger.error(
        "Workflow",
        "Pipeline",
        `[checkQueue] 找不到目標 Pod: ${targetPodId}`,
      );
      return;
    }

    if (!this.isRunInstanceTriggerable(runContext, targetPodId)) {
      const targetInstance = runContext
        ? runStore.getPodInstance(runContext.runId, targetPodId)
        : null;
      logger.log(
        "Workflow",
        "Pipeline",
        `目標 Pod「${targetPod.name}」已為 ${targetInstance?.status} 狀態，跳過觸發`,
      );
      return;
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    const sourcePodName = sourcePod?.name ?? sourcePodId;
    // summaryProvider 為 NULL 時 fallback 為 sourcePod.provider，保留升級前舊 Connection 的 summary 行為；
    // sourcePod 找不到時再 fallback 為 "claude"，確保向下相容。
    const provider =
      connection.summaryProvider ?? sourcePod?.provider ?? "claude";

    logger.log(
      "Workflow",
      "Pipeline",
      `開始執行 Pipeline："${sourcePodName}" → "${targetPod.name}" (${triggerMode})`,
    );

    const pathway = resolveSettlementPathway(triggerMode);
    const delegate = context.delegate;
    const summaryResult =
      await this.deps.executionService.generateSummaryWithFallback(
        canvasId,
        sourcePodId,
        targetPodId,
        provider,
        connection.summaryModel,
        runContext,
        pathway,
        delegate,
      );

    if (!summaryResult) {
      logger.error(
        "Workflow",
        "Pipeline",
        `[generateSummary] 無法生成摘要或取得備用內容`,
      );
      return;
    }

    if (summaryResult.resolvedModel) {
      this.reconcileSummaryModelIfNeeded(
        canvasId,
        connectionId,
        connection,
        summaryResult.resolvedModel,
      );
    }

    const collectResult = await this.runCollectSourcesStage(
      context,
      strategy,
      summaryResult.content,
      summaryResult.isSummarized,
    );
    if (!collectResult) return;

    const { finalSummary, finalIsSummarized, participatingConnectionIds } =
      collectResult;

    const enqueueParams: EnqueueParams = {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      finalSummary,
      finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      runContext,
    };

    // Run mode（有 delegate）：透過 delegate 的佇列機制處理排隊
    if (delegate) {
      if (this.enqueueForRunMode(delegate, enqueueParams)) return;
    } else {
      // Normal mode（無 delegate）：透過 queueService 處理排隊
      if (this.enqueueForNormalMode(targetPod.status, enqueueParams)) return;
    }

    await this.deps.executionService.triggerWorkflowWithSummary({
      canvasId,
      connectionId,
      summary: finalSummary,
      isSummarized: finalIsSummarized,
      participatingConnectionIds,
      strategy,
      runContext,
      delegate,
    });
  }

  /**
   * Run mode 佇列邏輯（delegate 存在時）。
   *
   * Run mode 下，delegate 依 Pod instance 的 running 狀態判斷是否忙碌，
   * 並透過 RunModeDelegate 或 NormalModeDelegate 各自的佇列實作排隊。
   * 回傳 true 表示已加入佇列，呼叫方應立即 return。
   */
  private enqueueForRunMode(
    delegate: WorkflowStatusDelegate,
    params: EnqueueParams,
  ): boolean {
    const {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      finalSummary,
      finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      runContext,
    } = params;

    if (!delegate.shouldEnqueue() || !delegate.isBusy(canvasId, targetPodId)) {
      return false;
    }

    logger.log(
      "Workflow",
      "Pipeline",
      `[checkQueue] 目標 Pod 忙碌中，加入佇列`,
    );
    delegate.enqueue({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      summary: finalSummary,
      isSummarized: finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      runContext,
    });
    // 安全網：立即嘗試消化佇列，防止 enqueue 發生在最後一次 scheduleNextInQueue 之後導致佇列卡住
    delegate.scheduleNextInQueue(canvasId, targetPodId);
    return true;
  }

  /**
   * Normal mode 佇列邏輯（無 delegate 時的備用路徑）。
   *
   * Normal mode 下，直接以 Pod 的 status 判斷是否忙碌，
   * 並透過 queueService 排隊，再嘗試立即消化佇列。
   * 回傳 true 表示已加入佇列，呼叫方應立即 return。
   */
  private enqueueForNormalMode(
    targetPodStatus: string,
    params: EnqueueParams,
  ): boolean {
    const {
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      finalSummary,
      finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      runContext,
    } = params;

    if (targetPodStatus === "idle") {
      return false;
    }

    logger.log(
      "Workflow",
      "Pipeline",
      `[checkQueue] 目標 Pod 忙碌中 (${targetPodStatus})，加入佇列`,
    );
    this.deps.queueService.enqueue({
      canvasId,
      connectionId,
      sourcePodId,
      targetPodId,
      summary: finalSummary,
      isSummarized: finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      runContext,
    });
    // 安全網：立即嘗試消化佇列，防止 enqueue 發生在最後一次 scheduleNextInQueue 之後導致佇列卡住
    fireAndForget(
      this.deps.queueService.processNextInQueue(canvasId, targetPodId),
      "Workflow",
      `[checkQueue] enqueue 後嘗試消化佇列失敗`,
    );
    return true;
  }

  private async runCollectSourcesStage(
    context: PipelineContext,
    strategy: TriggerStrategy,
    summaryContent: string,
    isSummarized: boolean,
  ): Promise<{
    finalSummary: string;
    finalIsSummarized: boolean;
    participatingConnectionIds?: string[];
  } | null> {
    const { canvasId, sourcePodId, connection, triggerMode } = context;
    const { targetPodId } = connection;

    if (strategy.collectSources) {
      const collectResult = await strategy.collectSources({
        canvasId,
        sourcePodId,
        connection,
        summary: summaryContent,
        runContext: context.runContext,
      });

      if (!collectResult.ready) {
        return null;
      }

      const { participatingConnectionIds } = collectResult;

      if (collectResult.mergedContent) {
        return {
          finalSummary: collectResult.mergedContent,
          finalIsSummarized: collectResult.isSummarized ?? true,
          participatingConnectionIds,
        };
      }

      return {
        finalSummary: summaryContent,
        finalIsSummarized: isSummarized,
        participatingConnectionIds,
      };
    }

    const isMultiInput =
      getMultiInputGroupConnections(canvasId, targetPodId).length > 1;

    if (isMultiInput) {
      // multi-input 路徑僅允許 "auto" 與 "ai-decide"，
      // "direct" 不應進入此分支（direct 有自己的 collectSources 路徑）。
      // 以 if 守門縮窄型別，避免強制斷言。
      if (triggerMode !== "auto" && triggerMode !== "ai-decide") {
        logger.warn(
          "Workflow",
          "Pipeline",
          `[runCollectSourcesStage] 不預期的 triggerMode "${triggerMode}" 進入 multi-input 分支，跳過處理`,
        );
        return {
          finalSummary: summaryContent,
          finalIsSummarized: isSummarized,
        };
      }
      await this.deps.multiInputService.handleMultiInputForConnection({
        canvasId,
        sourcePodId,
        connection,
        summary: summaryContent,
        triggerMode,
        runContext: context.runContext,
      });
      return null;
    }

    return { finalSummary: summaryContent, finalIsSummarized: isSummarized };
  }
}

export const workflowPipeline = new WorkflowPipeline();
