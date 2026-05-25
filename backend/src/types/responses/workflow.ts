import type { TriggerMode } from "../connection.js";

export interface WorkflowAutoTriggeredPayload {
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  transferredContent: string;
  isSummarized: boolean;
}

export interface WorkflowPendingPayload {
  canvasId: string;
  targetPodId: string;
  completedSourcePodIds: string[];
  pendingSourcePodIds: string[];
  totalSources: number;
  completedCount: number;
  rejectedSourcePodIds?: string[];
  hasRejectedSources?: boolean;
}

export interface WorkflowSourcesMergedPayload {
  canvasId: string;
  targetPodId: string;
  sourcePodIds: string[];
  mergedContentPreview: string;
}

export interface WorkflowBranchTriggeredPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
}

export interface WorkflowDirectTriggeredPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  transferredContent: string;
  isSummarized: boolean;
}

export interface WorkflowQueuedPayload {
  canvasId: string;
  targetPodId: string;
  connectionId: string;
  sourcePodId: string;
  position: number;
  queueSize: number;
  triggerMode: TriggerMode;
}

export interface WorkflowQueueProcessedPayload {
  canvasId: string;
  targetPodId: string;
  connectionId: string;
  sourcePodId: string;
  remainingQueueSize: number;
  triggerMode: TriggerMode;
}
