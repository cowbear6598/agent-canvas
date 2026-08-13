import type { RunContext } from "../../types/run.js";
import type { TriggerMode } from "../../types/index.js";
import type { SettlementPathway } from "./types.js";
import { runExecutionService } from "./runExecutionService.js";
import { runQueueService } from "./runQueueService.js";
import { workflowAsyncDispatchService } from "./workflowAsyncDispatchService.js";

export interface EnqueueItem {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  summary: string;
  isSummarized: boolean;
  triggerMode: TriggerMode;
  participatingConnectionIds?: string[];
  sourcePodIds?: string[];
  sourcePodNames?: string[];
  runContext: RunContext;
}

export interface WorkflowStatusDelegate {
  startPodExecution(
    canvasId: string,
    podId: string,
    allowSkippedReentry?: boolean,
  ): void;
  markSummarizing(canvasId: string, podId: string): void;
  markDeciding(canvasId: string, podId: string): void;
  markWaiting(canvasId: string, podId: string): void;
  onSummaryComplete(
    canvasId: string,
    podId: string,
    pathway?: SettlementPathway,
  ): void;
  onSummaryFailed(canvasId: string, podId: string, errorMessage: string): void;
  onChatComplete(
    canvasId: string,
    podId: string,
    pathway: SettlementPathway,
  ): void;
  onChatError(canvasId: string, podId: string, errorMessage: string): void;
  evaluateRun(): void;
  isBusy(canvasId: string, targetPodId: string): boolean;
  enqueue(item: EnqueueItem): void;
  scheduleNextInQueue(canvasId: string, targetPodId: string): void;
  settleAndSkipPath(
    canvasId: string,
    podId: string,
    pathway: SettlementPathway,
  ): void;
}

class RunDelegate implements WorkflowStatusDelegate {
  constructor(private readonly runContext: RunContext) {}

  startPodExecution(
    _canvasId: string,
    podId: string,
    allowSkippedReentry: boolean = false,
  ): void {
    runExecutionService.startPodInstance(
      this.runContext,
      podId,
      allowSkippedReentry,
    );
  }

  markSummarizing(_canvasId: string, podId: string): void {
    runExecutionService.summarizingPodInstance(this.runContext, podId);
  }

  markDeciding(_canvasId: string, podId: string): void {
    runExecutionService.decidingPodInstance(this.runContext, podId);
  }

  markWaiting(_canvasId: string, podId: string): void {
    runExecutionService.waitingPodInstance(this.runContext, podId);
  }

  onSummaryComplete(
    _canvasId: string,
    podId: string,
    pathway?: SettlementPathway,
  ): void {
    if (pathway) {
      this.settlePodWithoutRunEvaluation(podId, pathway);
    }
  }

  onSummaryFailed(
    _canvasId: string,
    podId: string,
    errorMessage: string,
  ): void {
    runExecutionService.errorPodInstance(this.runContext, podId, errorMessage);
  }

  onChatComplete(
    _canvasId: string,
    podId: string,
    pathway: SettlementPathway,
  ): void {
    this.settlePodWithoutRunEvaluation(podId, pathway);
  }

  private settlePodWithoutRunEvaluation(
    podId: string,
    pathway: SettlementPathway,
  ): void {
    runExecutionService.settlePodTrigger(this.runContext, podId, pathway, {
      evaluateRun: false,
    });
  }

  onChatError(_canvasId: string, podId: string, errorMessage: string): void {
    runExecutionService.errorPodInstance(this.runContext, podId, errorMessage);
  }

  evaluateRun(): void {
    runExecutionService.evaluateRun(this.runContext);
  }

  isBusy(_canvasId: string, targetPodId: string): boolean {
    return runQueueService.hasActiveItem(this.runContext, targetPodId);
  }

  enqueue(item: EnqueueItem): void {
    runQueueService.enqueue(item);
  }

  scheduleNextInQueue(canvasId: string, targetPodId: string): void {
    workflowAsyncDispatchService.dispatchRunQueueProcess(
      runQueueService.processNext(canvasId, targetPodId, this.runContext),
      this.runContext.runId,
      targetPodId,
    );
  }

  settleAndSkipPath(
    _canvasId: string,
    podId: string,
    pathway: SettlementPathway,
  ): void {
    runExecutionService.settleAndSkipPath(this.runContext, podId, pathway);
  }
}

export function createStatusDelegate(
  runContext: RunContext,
): WorkflowStatusDelegate {
  if (!runContext) {
    throw new Error("Workflow 執行缺少 RunContext，請檢查 workflow run 入口");
  }
  return new RunDelegate(runContext);
}
