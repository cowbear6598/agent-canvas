import type {
  PipelineContext,
  TriggerStrategy,
  ExecutionServiceMethods,
  MultiInputServiceMethods,
} from "./types.js";
import { podStore } from "../podStore.js";
import { configStore } from "../configStore.js";
import { runStore, TRIGGERABLE_STATUSES } from "../runStore.js";
import { logger } from "../../utils/logger.js";
import { LazyInitializable } from "./lazyInitializable.js";
import {
  resolveSettlementPathway,
  getMultiInputGroupConnections,
} from "./workflowHelpers.js";
import {
  enqueueWorkflowTriggerStage,
  runWorkflowSummaryStage,
} from "./workflowTriggerStages.js";

interface PipelineDeps {
  executionService: ExecutionServiceMethods;
  multiInputService: MultiInputServiceMethods;
}

class WorkflowPipeline extends LazyInitializable<PipelineDeps> {
  /**
   * 純函數：判斷 run instance 下的目標 Pod 是否可被觸發。
   * 回傳 false 表示應跳過觸發。
   */
  private isRunInstanceTriggerable(
    runContext: PipelineContext["runContext"],
    sourcePodId: string,
    targetPodId: string,
  ): boolean {
    const targetInstance = runStore.getPodInstance(
      runContext.runId,
      targetPodId,
    );
    if (!targetInstance) return true;
    if (TRIGGERABLE_STATUSES.has(targetInstance.status)) return true;
    if (
      targetInstance.status === "skipped" &&
      this.deps.executionService.isCyclicPod(runContext, sourcePodId)
    ) {
      return true;
    }
    return (
      this.deps.executionService.isCyclicPod(runContext, targetPodId) &&
      (targetInstance.status === "summarizing" ||
        targetInstance.status === "completed")
    );
  }

  private isRunActive(runContext: PipelineContext["runContext"]): boolean {
    return runStore.getRun(runContext.runId)?.status === "running";
  }

  /**
   * 【效能說明 — fan-out 批次處理】
   *
   * execute() 一次僅處理「單一 connection」（一個 sourcePod → 一個 targetPod）。
   * fan-out 場景（一個 sourcePod 觸發多個下游 targetPod）是由上層呼叫方
   *（workflowService / triggerService 等）對每條 connection 個別呼叫 execute()。
   *
   * 因此「N 條 connection 在同一個 execute() 內同時廣播」的場景並不存在。
   *
   * 若未來上層改為在單一 execute() 內處理多條 connection，
   * 應在此處改用 Promise.all 並行 update，再合併成一個 batch 廣播事件。
   */
  async execute(
    context: PipelineContext,
    strategy: TriggerStrategy,
  ): Promise<void> {
    try {
      await this.executeStages(context, strategy);
    } finally {
      context.delegate.evaluateRun();
    }
  }

  private async executeStages(
    context: PipelineContext,
    strategy: TriggerStrategy,
  ): Promise<void> {
    const { canvasId, sourcePodId, connection, triggerMode, runContext } =
      context;
    const { targetPodId, id: connectionId } = connection;

    if (!this.isRunActive(runContext)) return;

    const targetPod = podStore.getById(canvasId, targetPodId);
    if (!targetPod) {
      logger.error(
        "Workflow",
        "Pipeline",
        `[checkQueue] 找不到目標 Pod: ${targetPodId}`,
      );
      return;
    }

    if (!this.isRunInstanceTriggerable(runContext, sourcePodId, targetPodId)) {
      const targetInstance = runStore.getPodInstance(
        runContext.runId,
        targetPodId,
      );
      logger.log(
        "Workflow",
        "Pipeline",
        `目標 Pod「${targetPod.name}」已為 ${targetInstance?.status} 狀態，跳過觸發`,
      );
      return;
    }

    const sourcePod = podStore.getById(canvasId, sourcePodId);
    const sourcePodName = sourcePod?.name ?? sourcePodId;
    const {
      connectionLineProvider,
      connectionLineModel,
      connectionLineThinkingLevel,
    } = configStore.getConnectionLineModelConfig();

    logger.log(
      "Workflow",
      "Pipeline",
      `開始執行 Pipeline："${sourcePodName}" → "${targetPod.name}" (${triggerMode})`,
    );

    const pathway = resolveSettlementPathway(triggerMode);
    const delegate = context.delegate;
    const summaryResult = await runWorkflowSummaryStage({
      canvasId,
      sourcePodId,
      targetPodId,
      provider: connectionLineProvider,
      summaryModel: connectionLineModel,
      summaryThinkingLevel: connectionLineThinkingLevel,
      runContext,
      pathway,
      delegate,
      generateSummaryWithFallback:
        this.deps.executionService.generateSummaryWithFallback.bind(
          this.deps.executionService,
        ),
    });

    if (!summaryResult) {
      return;
    }

    // 摘要查詢期間使用者可能刪除 Run，不可再啟動下一輪。
    if (!this.isRunActive(runContext)) return;

    const collectResult = await this.runCollectSourcesStage(
      context,
      strategy,
      summaryResult.content,
      summaryResult.isSummarized,
    );
    if (!collectResult) return;

    const {
      finalSummary,
      finalIsSummarized,
      participatingConnectionIds,
      sourcePodIds,
      sourcePodNames,
    } = collectResult;

    // 砍除 normal mode 後唯一的 enqueue 路徑：透過 delegate 的 per-run target 佇列機制處理排隊
    if (
      enqueueWorkflowTriggerStage(delegate, {
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        summary: finalSummary,
        isSummarized: finalIsSummarized,
        triggerMode,
        participatingConnectionIds,
        sourcePodIds,
        sourcePodNames,
        runContext,
      })
    ) {
      return;
    }

    await this.deps.executionService.triggerWorkflowWithSummary({
      canvasId,
      connectionId,
      summary: finalSummary,
      isSummarized: finalIsSummarized,
      triggerMode,
      participatingConnectionIds,
      sourcePodIds,
      sourcePodNames,
      strategy,
      runContext,
      delegate,
    });
  }

  /** strategy.collectSources 路徑：委派給策略自行收集來源並決定是否繼續。 */
  private async runStrategyCollectSources(
    context: PipelineContext,
    strategy: Required<Pick<TriggerStrategy, "collectSources">>,
    summaryContent: string,
    isSummarized: boolean,
  ): Promise<{
    finalSummary: string;
    finalIsSummarized: boolean;
    participatingConnectionIds?: string[];
    sourcePodIds?: string[];
    sourcePodNames?: string[];
  } | null> {
    const { canvasId, sourcePodId, connection } = context;

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

    const { participatingConnectionIds, sourcePodIds, sourcePodNames } =
      collectResult;

    if (collectResult.mergedContent) {
      return {
        finalSummary: collectResult.mergedContent,
        finalIsSummarized: collectResult.isSummarized ?? true,
        participatingConnectionIds,
        sourcePodIds,
        sourcePodNames,
      };
    }

    return {
      finalSummary: summaryContent,
      finalIsSummarized: isSummarized,
      participatingConnectionIds,
      sourcePodIds,
      sourcePodNames,
    };
  }

  /** multi-input 路徑：等待所有上游來源完成後才觸發下游。 */
  private async runMultiInputCollectStage(
    context: PipelineContext,
    summaryContent: string,
  ): Promise<null> {
    const { canvasId, sourcePodId, connection, triggerMode } = context;

    // multi-input 路徑僅允許 "auto" 與 "branch"，
    // "direct" 不應進入此分支（direct 有自己的 collectSources 路徑）。
    // 以 if 守門縮窄型別，避免強制斷言。
    if (triggerMode !== "auto" && triggerMode !== "branch") {
      logger.warn(
        "Workflow",
        "Pipeline",
        `[runCollectSourcesStage] 不預期的 triggerMode "${triggerMode}" 進入 multi-input 分支，跳過處理`,
      );
      return null;
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

  /** 直通路徑：直接以摘要內容觸發下游，不需額外收集。 */
  private runDirectPassthrough(
    summaryContent: string,
    isSummarized: boolean,
  ): {
    finalSummary: string;
    finalIsSummarized: boolean;
    participatingConnectionIds?: string[];
    sourcePodIds?: string[];
    sourcePodNames?: string[];
  } {
    return { finalSummary: summaryContent, finalIsSummarized: isSummarized };
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
    sourcePodIds?: string[];
    sourcePodNames?: string[];
  } | null> {
    const { canvasId, connection } = context;
    const { targetPodId } = connection;

    if (strategy.collectSources) {
      return this.runStrategyCollectSources(
        context,
        strategy as Required<Pick<TriggerStrategy, "collectSources">>,
        summaryContent,
        isSummarized,
      );
    }

    if (context.triggerMode === "direct") {
      return this.runDirectPassthrough(summaryContent, isSummarized);
    }

    const isMultiInput =
      getMultiInputGroupConnections(canvasId, targetPodId).length > 1;

    if (isMultiInput) {
      return this.runMultiInputCollectStage(context, summaryContent);
    }

    return this.runDirectPassthrough(summaryContent, isSummarized);
  }
}

export const workflowPipeline = new WorkflowPipeline();
