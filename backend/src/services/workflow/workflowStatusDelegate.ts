import type { RunContext } from "../../types/run.js";
import type { TriggerMode } from "../../types/index.js";
import type { SettlementPathway } from "./types.js";
import { runStore } from "../runStore.js";
import { runExecutionService } from "./runExecutionService.js";
import { runQueueService } from "./runQueueService.js";
import { fireAndForget } from "../../utils/operationHelpers.js";

export interface EnqueueItem {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  summary: string;
  isSummarized: boolean;
  triggerMode: TriggerMode;
  participatingConnectionIds?: string[];
  runContext?: RunContext;
}

export interface WorkflowStatusDelegate {
  isRunMode(): boolean;
  startPodExecution(canvasId: string, podId: string): void;
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
  shouldEnqueue(): boolean;
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

  isRunMode(): boolean {
    return true;
  }

  startPodExecution(_canvasId: string, podId: string): void {
    runExecutionService.startPodInstance(this.runContext, podId);
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
      runExecutionService.settlePodTrigger(this.runContext, podId, pathway);
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
    runExecutionService.settlePodTrigger(this.runContext, podId, pathway);
  }

  onChatError(_canvasId: string, podId: string, errorMessage: string): void {
    runExecutionService.errorPodInstance(this.runContext, podId, errorMessage);
  }

  shouldEnqueue(): boolean {
    return true;
  }

  isBusy(_canvasId: string, targetPodId: string): boolean {
    const instance = runStore.getPodInstance(
      this.runContext.runId,
      targetPodId,
    );
    return instance?.status === "running";
  }

  enqueue(item: EnqueueItem): void {
    if (!item.runContext) return;
    runQueueService.enqueue({ ...item, runContext: item.runContext });
  }

  scheduleNextInQueue(canvasId: string, targetPodId: string): void {
    fireAndForget(
      runQueueService.processNext(canvasId, targetPodId, this.runContext),
      "Run",
      "[RunDelegate] 處理 Run 佇列下一項時發生錯誤",
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

class NoopStatusDelegate implements WorkflowStatusDelegate {
  isRunMode(): boolean {
    return false;
  }
  startPodExecution(): void {}
  markSummarizing(): void {}
  markDeciding(): void {}
  markWaiting(): void {}
  onSummaryComplete(): void {}
  onSummaryFailed(): void {}
  onChatComplete(): void {}
  onChatError(): void {}
  shouldEnqueue(): boolean {
    return false;
  }
  isBusy(): boolean {
    return false;
  }
  enqueue(): void {}
  scheduleNextInQueue(): void {}
  settleAndSkipPath(): void {}
}

const noopStatusDelegate = new NoopStatusDelegate();

export function createStatusDelegate(
  runContext?: RunContext,
): WorkflowStatusDelegate {
  if (!runContext) {
    return noopStatusDelegate;
  }
  return new RunDelegate(runContext);
}
