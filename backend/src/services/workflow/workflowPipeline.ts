import type {
  PipelineContext,
  TriggerStrategy,
  ExecutionServiceMethods,
  MultiInputServiceMethods,
  QueueServiceMethods,
} from "./types.js";
import type { WorkflowStatusDelegate } from "./workflowStatusDelegate.js";
import { podStore } from "../podStore.js";
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

    if (runContext) {
      const targetInstance = runStore.getPodInstance(
        runContext.runId,
        targetPodId,
      );
      if (targetInstance && !TRIGGERABLE_STATUSES.has(targetInstance.status)) {
        logger.log(
          "Workflow",
          "Pipeline",
          `目標 Pod「${targetPod.name}」已為 ${targetInstance.status} 狀態，跳過觸發`,
        );
        return;
      }
    }

    const sourcePodName =
      podStore.getById(canvasId, sourcePodId)?.name ?? sourcePodId;

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
        runContext,
        connection.summaryModel,
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
      await this.deps.multiInputService.handleMultiInputForConnection({
        canvasId,
        sourcePodId,
        connection,
        summary: summaryContent,
        triggerMode: triggerMode as "auto" | "ai-decide",
        runContext: context.runContext,
      });
      return null;
    }

    return { finalSummary: summaryContent, finalIsSummarized: isSummarized };
  }
}

export const workflowPipeline = new WorkflowPipeline();
