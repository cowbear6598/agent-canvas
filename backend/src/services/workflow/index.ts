export { workflowExecutionService } from "./workflowExecutionService.js";
export { workflowAutoTriggerService } from "./workflowAutoTriggerService.js";
export { workflowMultiInputService } from "./workflowMultiInputService.js";
export { workflowDirectTriggerService } from "./workflowDirectTriggerService.js";
export { branchDecisionService } from "./branchDecisionService.js";
export { workflowBranchTriggerService } from "./workflowBranchTriggerService.js";
export { runQueueService } from "./runQueueService.js";
export { workflowPipeline } from "./workflowPipeline.js";
export { runExecutionService } from "./runExecutionService.js";
export type * from "./types.js";

import { workflowPipeline } from "./workflowPipeline.js";
import { workflowAutoTriggerService } from "./workflowAutoTriggerService.js";
import { workflowBranchTriggerService } from "./workflowBranchTriggerService.js";
import { workflowDirectTriggerService } from "./workflowDirectTriggerService.js";
import { workflowMultiInputService } from "./workflowMultiInputService.js";
import { workflowExecutionService } from "./workflowExecutionService.js";
import { runQueueService } from "./runQueueService.js";
import { runExecutionService } from "./runExecutionService.js";
import { branchDecisionService } from "./branchDecisionService.js";
import { canvasStore } from "../canvasStore.js";
import { pendingTargetStore } from "../pendingTargetStore.js";
export function initWorkflowServices(): void {
  const sharedStrategies = {
    auto: workflowAutoTriggerService,
    direct: workflowDirectTriggerService,
    branch: workflowBranchTriggerService,
  };

  workflowPipeline.init({
    executionService: workflowExecutionService,
    multiInputService: workflowMultiInputService,
  });

  workflowAutoTriggerService.init({ pipeline: workflowPipeline });

  workflowBranchTriggerService.init({
    branchDecisionService,
    canvasStore,
    pendingTargetStore,
    pipeline: workflowPipeline,
    multiInputService: workflowMultiInputService,
  });

  workflowMultiInputService.init({
    executionService: workflowExecutionService,
    strategies: sharedStrategies,
  });

  runQueueService.init({
    executionService: workflowExecutionService,
    strategies: sharedStrategies,
    queuedPodInstance: (ctx, podId) =>
      runExecutionService.queuedPodInstance(ctx, podId),
    errorPodInstance: (ctx, podId, errorMessage) =>
      runExecutionService.errorPodInstance(ctx, podId, errorMessage),
    hasActiveStream: (runId, podId) =>
      runExecutionService.hasActiveStream(runId, podId),
  });

  workflowExecutionService.init({
    pipeline: workflowPipeline,
    branchTriggerService: workflowBranchTriggerService,
    autoTriggerService: workflowAutoTriggerService,
    directTriggerService: workflowDirectTriggerService,
  });
}

initWorkflowServices();
