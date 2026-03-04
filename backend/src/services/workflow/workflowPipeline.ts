import type {
  PipelineContext,
  TriggerStrategy,
  ExecutionServiceMethods,
  StateServiceMethods,
  MultiInputServiceMethods,
  QueueServiceMethods,
} from './types.js';
import { podStore } from '../podStore.js';
import { logger } from '../../utils/logger.js';
import { LazyInitializable } from './lazyInitializable.js';
import { fireAndForget } from '../../utils/operationHelpers.js';

interface PipelineDeps {
  executionService: ExecutionServiceMethods;
  stateService: StateServiceMethods;
  multiInputService: MultiInputServiceMethods;
  queueService: QueueServiceMethods;
}

class WorkflowPipeline extends LazyInitializable<PipelineDeps> {

  async execute(context: PipelineContext, strategy: TriggerStrategy): Promise<void> {
    this.ensureInitialized();

    const { canvasId, sourcePodId, connection, triggerMode } = context;
    const { targetPodId, id: connectionId } = connection;

    const targetPod = podStore.getById(canvasId, targetPodId);

    if (!targetPod) {
      logger.error('Workflow', 'Pipeline', `[checkQueue] 找不到目標 Pod: ${targetPodId}`);
      return;
    }

    const sourcePodName = podStore.getById(canvasId, sourcePodId)?.name ?? sourcePodId;

    logger.log('Workflow', 'Pipeline', `開始執行 Pipeline："${sourcePodName}" → "${targetPod.name}" (${triggerMode})`);

    const summaryResult = await this.deps.executionService.generateSummaryWithFallback(
      canvasId,
      sourcePodId,
      targetPodId
    );

    if (!summaryResult) {
      logger.error('Workflow', 'Pipeline', `[generateSummary] 無法生成摘要或取得備用內容`);
      return;
    }

    const collectResult = await this.runCollectSourcesStage(context, strategy, summaryResult.content, summaryResult.isSummarized);
    if (!collectResult) return;

    const { finalSummary, finalIsCondensedSummary, participatingConnectionIds } = collectResult;

    if (targetPod.status !== 'idle') {
      logger.log('Workflow', 'Pipeline', `[checkQueue] 目標 Pod 忙碌中 (${targetPod.status})，加入佇列`);
      this.deps.queueService.enqueue({
        canvasId,
        connectionId,
        sourcePodId,
        targetPodId,
        summary: finalSummary,
        isSummarized: finalIsCondensedSummary,
        triggerMode,
        participatingConnectionIds,
      });
      // 安全網：立即嘗試消化佇列，防止 enqueue 發生在最後一次 scheduleNextInQueue 之後導致佇列卡住
      fireAndForget(
        this.deps.queueService.processNextInQueue(canvasId, targetPodId),
        'Workflow',
        `[checkQueue] enqueue 後嘗試消化佇列失敗`
      );
      return;
    }

    await this.deps.executionService.triggerWorkflowWithSummary({
      canvasId,
      connectionId,
      summary: finalSummary,
      isSummarized: finalIsCondensedSummary,
      participatingConnectionIds,
      strategy,
    });
  }

  private async runCollectSourcesStage(
    context: PipelineContext,
    strategy: TriggerStrategy,
    summaryContent: string,
    summaryIsCondensedSummary: boolean
  ): Promise<{ finalSummary: string; finalIsCondensedSummary: boolean; participatingConnectionIds?: string[] } | null> {
    this.ensureInitialized();
    const { canvasId, sourcePodId, connection, triggerMode } = context;
    const { targetPodId } = connection;

    if (strategy.collectSources) {
      const collectResult = await strategy.collectSources({
        canvasId,
        sourcePodId,
        connection,
        summary: summaryContent,
      });

      if (!collectResult.ready) {
        return null;
      }

      const { participatingConnectionIds } = collectResult;

      if (collectResult.mergedContent) {
        return { finalSummary: collectResult.mergedContent, finalIsCondensedSummary: collectResult.isSummarized ?? true, participatingConnectionIds };
      }

      return { finalSummary: summaryContent, finalIsCondensedSummary: summaryIsCondensedSummary, participatingConnectionIds };
    }

    const { isMultiInput, requiredSourcePodIds } = this.deps.stateService.checkMultiInputScenario(
      canvasId,
      targetPodId
    );

    if (isMultiInput) {
      await this.deps.multiInputService.handleMultiInputForConnection({
        canvasId,
        sourcePodId,
        connection,
        requiredSourcePodIds,
        summary: summaryContent,
        triggerMode: triggerMode as 'auto' | 'ai-decide',
      });
      return null;
    }

    return { finalSummary: summaryContent, finalIsCondensedSummary: summaryIsCondensedSummary };
  }
}

export const workflowPipeline = new WorkflowPipeline();
