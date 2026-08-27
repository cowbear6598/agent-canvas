import type {
  RunPodInstance,
  RunPodInstanceStatus,
  RunStatus,
  WorkflowRun,
} from "../runStore.js";
import {
  IN_PROGRESS_STATUSES,
  NEVER_TRIGGERED_STATUSES,
  RUN_TERMINAL_STATUSES,
  TERMINAL_POD_STATUSES,
} from "../runStore.js";
import { isAllPathwaysSettled } from "../../utils/pathwayHelpers.js";

export type RunQueueSettlementDecision =
  | "wait-for-active-stream"
  | "empty"
  | "process-next";

export function isTerminalPodStatus(status: RunPodInstanceStatus): boolean {
  return TERMINAL_POD_STATUSES.has(status);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.has(status);
}

export function decidePodStartStatus(
  currentStatus: RunPodInstanceStatus,
): "running" | null {
  return isTerminalPodStatus(currentStatus) ? null : "running";
}

export function shouldIgnorePodStatusUpdateForRun(
  run: Pick<WorkflowRun, "status"> | null | undefined,
): boolean {
  return !run || run.status === "cancelled";
}

export function shouldMarkRunCancelled(
  run: Pick<WorkflowRun, "status"> | null | undefined,
): boolean {
  return run != null && !isTerminalRunStatus(run.status);
}

export function decidePodStatusAfterPathwaySettlement(
  instance: Pick<
    RunPodInstance,
    "status" | "autoPathwaySettled" | "directPathwaySettled"
  >,
): RunPodInstanceStatus | null {
  if (
    !isAllPathwaysSettled(
      instance.autoPathwaySettled,
      instance.directPathwaySettled,
    )
  ) {
    return null;
  }

  const shouldRemainSkipped =
    instance.status === "skipped" ||
    NEVER_TRIGGERED_STATUSES.has(instance.status);
  return shouldRemainSkipped ? "skipped" : "completed";
}

export function decidePodStatusAfterTriggerSettlement(
  instance: Pick<
    RunPodInstance,
    "status" | "autoPathwaySettled" | "directPathwaySettled"
  >,
  queueSize: number,
): RunPodInstanceStatus | null {
  if (
    !isAllPathwaysSettled(
      instance.autoPathwaySettled,
      instance.directPathwaySettled,
    )
  ) {
    return null;
  }

  if (NEVER_TRIGGERED_STATUSES.has(instance.status)) return null;
  if (queueSize > 0) return null;
  return "completed";
}

export function decideRunTerminalStatus(
  instances: Array<Pick<RunPodInstance, "status">>,
): "completed" | "error" | null {
  if (instances.length === 0) return null;

  const allDone = instances.every(
    (instance) =>
      instance.status === "completed" || instance.status === "skipped",
  );
  if (allDone) return "completed";

  const hasTerminalFailure = instances.some(
    (instance) =>
      instance.status === "error" || instance.status === "blocked",
  );
  const hasInProgress = instances.some((instance) =>
    IN_PROGRESS_STATUSES.has(instance.status),
  );

  if (hasTerminalFailure && !hasInProgress) return "error";
  return null;
}

export function decideRunQueueSettlement(
  hasActiveStream: boolean,
  queueSize: number,
): RunQueueSettlementDecision {
  if (hasActiveStream) return "wait-for-active-stream";
  if (queueSize <= 0) return "empty";
  return "process-next";
}
