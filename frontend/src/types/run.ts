import type { Message } from "./chat";

export type RunStatus = 'running' | 'completed' | 'error'

export type RunPodStatus = 'pending' | 'running' | 'summarizing' | 'deciding' | 'queued' | 'waiting' | 'completed' | 'error' | 'skipped'

export type RunGoalRoundDividerStatus = "completed" | "blocked";

export interface RunGoalRoundDivider {
  type: "goal-round-divider";
  id: string;
  runId: string;
  podId: string;
  sourcePodIds: string[];
  sourcePodNames: string[];
  status: RunGoalRoundDividerStatus;
  blockedReason: string | null;
  completedAt: string;
  connectionIds: string[];
}

export type RunChatTimelineItem = Message | RunGoalRoundDivider;

/** not-applicable: 該路徑不存在; pending: 尚未 settle; settled: 已完成 settle */
export type PathwayState = 'not-applicable' | 'pending' | 'settled'

export interface RunPodInstance {
  id: string
  runId: string
  podId: string
  podName: string
  status: RunPodStatus
  errorMessage?: string
  lastResponseSummary?: string
  triggeredAt?: string
  completedAt?: string
  autoPathwaySettled: PathwayState
  directPathwaySettled: PathwayState
}

export interface WorkflowRun {
  id: string
  canvasId: string
  sourcePodId: string
  sourcePodName: string
  triggerMessage: string
  status: RunStatus
  podInstances: RunPodInstance[]
  createdAt: string
  completedAt?: string
}

export interface RunMessagesPageCursor {
  beforeTimestamp: string
  beforeMessageId: string
}

export interface RunMessagesPageInfo {
  hasMore: boolean
  nextCursor: RunMessagesPageCursor | null
}
