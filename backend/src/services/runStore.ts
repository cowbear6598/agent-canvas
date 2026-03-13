import { randomUUID } from 'crypto';
import type { PersistedMessage, PersistedSubMessage } from '../types';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';
import { safeJsonParse } from '../utils/safeJsonParse.js';

export type RunStatus = 'running' | 'completed' | 'error';
export type RunPodInstanceStatus = 'pending' | 'running' | 'summarizing' | 'completed' | 'error' | 'skipped';

export interface WorkflowRun {
  id: string;
  canvasId: string;
  sourcePodId: string;
  triggerMessage: string;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface RunPodInstance {
  id: string;
  runId: string;
  podId: string;
  status: RunPodInstanceStatus;
  claudeSessionId: string | null;
  errorMessage: string | null;
  triggeredAt: string | null;
  completedAt: string | null;
}

export interface RunMessage {
  id: string;
  runId: string;
  podId: string;
  role: string;
  content: string;
  timestamp: string;
  subMessages?: PersistedSubMessage[];
}

interface WorkflowRunRow {
  id: string;
  canvas_id: string;
  source_pod_id: string;
  trigger_message: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface RunPodInstanceRow {
  id: string;
  run_id: string;
  pod_id: string;
  status: string;
  claude_session_id: string | null;
  error_message: string | null;
  triggered_at: string | null;
  completed_at: string | null;
}

interface RunMessageRow {
  id: string;
  run_id: string;
  pod_id: string;
  role: string;
  content: string;
  timestamp: string;
  sub_messages_json: string | null;
}

function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    sourcePodId: row.source_pod_id,
    triggerMessage: row.trigger_message,
    status: row.status as RunStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function rowToRunPodInstance(row: RunPodInstanceRow): RunPodInstance {
  return {
    id: row.id,
    runId: row.run_id,
    podId: row.pod_id,
    status: row.status as RunPodInstanceStatus,
    claudeSessionId: row.claude_session_id,
    errorMessage: row.error_message,
    triggeredAt: row.triggered_at,
    completedAt: row.completed_at,
  };
}

function rowToRunMessage(row: RunMessageRow): PersistedMessage {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.timestamp,
    ...(row.sub_messages_json
      ? { subMessages: safeJsonParse<PersistedSubMessage[]>(row.sub_messages_json) ?? undefined }
      : {}),
  };
}

const COMPLETED_TERMINAL_STATUSES: RunStatus[] = ['completed', 'error'];

class RunStore {
  private get stmts(): ReturnType<typeof getStatements> {
    return getStatements(getDb());
  }

  createRun(canvasId: string, sourcePodId: string, triggerMessage: string): WorkflowRun {
    const run: WorkflowRun = {
      id: randomUUID(),
      canvasId,
      sourcePodId,
      triggerMessage,
      status: 'running',
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.stmts.workflowRun.insert.run({
      $id: run.id,
      $canvasId: run.canvasId,
      $sourcePodId: run.sourcePodId,
      $triggerMessage: run.triggerMessage,
      $status: run.status,
      $createdAt: run.createdAt,
      $completedAt: run.completedAt,
    });

    return run;
  }

  getRun(runId: string): WorkflowRun | undefined {
    const row = this.stmts.workflowRun.selectById.get(runId) as WorkflowRunRow | undefined;
    if (!row) return undefined;
    return rowToWorkflowRun(row);
  }

  getRunsByCanvasId(canvasId: string): WorkflowRun[] {
    const rows = this.stmts.workflowRun.selectByCanvasId.all(canvasId) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    const completedAt = COMPLETED_TERMINAL_STATUSES.includes(status) ? new Date().toISOString() : null;
    this.stmts.workflowRun.updateStatus.run({
      $id: runId,
      $status: status,
      $completedAt: completedAt,
    });
  }

  deleteRun(runId: string): void {
    this.stmts.workflowRun.deleteById.run(runId);
  }

  countRunsByCanvasId(canvasId: string): number {
    const result = this.stmts.workflowRun.countByCanvasId.get(canvasId) as { count: number };
    return result.count;
  }

  getOldestCompletedRunIds(canvasId: string, limit: number): string[] {
    const rows = this.stmts.workflowRun.selectOldestCompleted.all(canvasId, limit) as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  createPodInstance(runId: string, podId: string): RunPodInstance {
    const instance: RunPodInstance = {
      id: randomUUID(),
      runId,
      podId,
      status: 'pending',
      claudeSessionId: null,
      errorMessage: null,
      triggeredAt: null,
      completedAt: null,
    };

    this.stmts.runPodInstance.insert.run({
      $id: instance.id,
      $runId: instance.runId,
      $podId: instance.podId,
      $status: instance.status,
      $claudeSessionId: instance.claudeSessionId,
      $errorMessage: instance.errorMessage,
      $triggeredAt: instance.triggeredAt,
      $completedAt: instance.completedAt,
    });

    return instance;
  }

  getPodInstance(runId: string, podId: string): RunPodInstance | undefined {
    const row = this.stmts.runPodInstance.selectByRunIdAndPodId.get({
      $runId: runId,
      $podId: podId,
    }) as RunPodInstanceRow | undefined;
    if (!row) return undefined;
    return rowToRunPodInstance(row);
  }

  getPodInstancesByRunId(runId: string): RunPodInstance[] {
    const rows = this.stmts.runPodInstance.selectByRunId.all(runId) as RunPodInstanceRow[];
    return rows.map(rowToRunPodInstance);
  }

  updatePodInstanceStatus(
    instanceId: string,
    status: RunPodInstanceStatus,
    errorMessage?: string,
  ): void {
    const triggeredAt = status === 'running' ? new Date().toISOString() : null;
    const completedAt = status === 'completed' || status === 'error' || status === 'skipped'
      ? new Date().toISOString()
      : null;
    this.stmts.runPodInstance.updateStatus.run({
      $id: instanceId,
      $status: status,
      $errorMessage: errorMessage ?? null,
      $triggeredAt: triggeredAt,
      $completedAt: completedAt,
    });
  }

  updatePodInstanceClaudeSessionId(instanceId: string, sessionId: string): void {
    this.stmts.runPodInstance.updateClaudeSessionId.run({
      $claudeSessionId: sessionId,
      $id: instanceId,
    });
  }

  getRunningPodInstances(runId: string): RunPodInstance[] {
    const rows = this.stmts.runPodInstance.selectRunningByRunId.all(runId) as RunPodInstanceRow[];
    return rows.map(rowToRunPodInstance);
  }

  addRunMessage(
    runId: string,
    podId: string,
    role: 'user' | 'assistant',
    content: string,
    subMessages?: PersistedSubMessage[],
  ): PersistedMessage {
    const message: PersistedMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(subMessages && { subMessages }),
    };

    this.stmts.runMessage.insert.run({
      $id: message.id,
      $runId: runId,
      $podId: podId,
      $role: role,
      $content: content,
      $timestamp: message.timestamp,
      $subMessagesJson: subMessages ? JSON.stringify(subMessages) : null,
    });

    return message;
  }

  upsertRunMessage(runId: string, podId: string, message: PersistedMessage): void {
    this.stmts.runMessage.upsert.run({
      $id: message.id,
      $runId: runId,
      $podId: podId,
      $role: message.role,
      $content: message.content,
      $timestamp: message.timestamp,
      $subMessagesJson: message.subMessages ? JSON.stringify(message.subMessages) : null,
    });
  }

  getRunMessages(runId: string, podId: string): PersistedMessage[] {
    const rows = this.stmts.runMessage.selectByRunIdAndPodId.all({
      $runId: runId,
      $podId: podId,
    }) as RunMessageRow[];
    return rows.map(rowToRunMessage);
  }
}

export const runStore = new RunStore();
