import type { WorkflowRun, RunPodInstance } from "../services/runStore.js";
import type { PersistedMessage } from "./persistence.js";
import type { MessageRole } from "./message.js";

/** not-applicable: 該路徑不存在; pending: 尚未 settle; settled: 已完成 settle */
export type PathwayState = "not-applicable" | "pending" | "settled";

export type { WorkflowRun, RunPodInstance };

export interface RunContext {
  runId: string;
  canvasId: string;
  sourcePodId: string;
}

/** 前端使用的 RunPodInstance，去除內部路徑資訊並附加 Pod 名稱 */
export type RunPodInstancePublic = Omit<RunPodInstance, "worktreePath"> & {
  podName: string;
};

/** 前端 WorkflowRun 包含內嵌的 podInstances，用於 wire format */
export interface WorkflowRunWithInstances extends WorkflowRun {
  podInstances: RunPodInstancePublic[];
  sourcePodName: string;
}

export interface RunCreatedPayload {
  canvasId: string;
  run: WorkflowRunWithInstances;
}

export interface RunStatusChangedPayload {
  runId: string;
  canvasId: string;
  status: string;
  completedAt?: string;
}

export interface RunPodStatusChangedPayload {
  runId: string;
  canvasId: string;
  podId: string;
  status: string;
  errorMessage?: string;
  lastResponseSummary?: string;
  triggeredAt?: string;
  completedAt?: string;
  autoPathwaySettled?: PathwayState;
  directPathwaySettled?: PathwayState;
}

export interface RunMessagePayload {
  runId: string;
  canvasId: string;
  podId: string;
  messageId: string;
  content: string;
  isPartial: boolean;
  role: MessageRole;
}

export interface RunChatCompletePayload {
  runId: string;
  canvasId: string;
  podId: string;
  messageId: string;
  fullContent: string;
}

export interface RunDeletedPayload {
  runId: string;
  canvasId: string;
}

export interface RunsLoadedPayload {
  requestId: string;
  success: boolean;
  runs: WorkflowRunWithInstances[];
}

export interface RunPodMessagesLoadedPayload {
  requestId: string;
  success: boolean;
  runId: string;
  podId: string;
  messages: PersistedMessage[];
}
