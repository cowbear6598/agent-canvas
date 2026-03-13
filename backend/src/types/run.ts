import type { WorkflowRun, RunPodInstance } from '../services/runStore.js';
import type { PersistedMessage } from './persistence.js';
import type { MessageRole } from './message.js';

export type { WorkflowRun, RunPodInstance };

export interface RunContext {
  runId: string;
  canvasId: string;
  sourcePodId: string;
}

/** 前端 WorkflowRun 包含內嵌的 podInstances，用於 wire format */
export interface WorkflowRunWithInstances extends WorkflowRun {
  podInstances: RunPodInstance[];
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
