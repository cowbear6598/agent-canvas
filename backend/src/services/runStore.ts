import { randomUUID } from "crypto";
import type { PersistedMessage, PersistedSubMessage } from "../types";
import type { PathwayState } from "../types/run.js";
import { getStmts } from "../database/stmtsHelper.js";
import { getDb } from "../database/index.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";
import {
  pathwayStateToSqliteInt,
  sqliteIntToPathwayState,
} from "../utils/pathwayHelpers.js";

export type RunStatus = "running" | "completed" | "error";
export type RunPodInstanceStatus =
  | "pending"
  | "running"
  | "summarizing"
  | "deciding"
  | "queued"
  | "waiting"
  | "completed"
  | "error"
  | "skipped";

export const NEVER_TRIGGERED_STATUSES = new Set<RunPodInstanceStatus>([
  "pending",
  "deciding",
  "queued",
  "waiting",
]);
export const IN_PROGRESS_STATUSES = new Set<RunPodInstanceStatus>([
  "running",
  "pending",
  "summarizing",
  "deciding",
  "queued",
  "waiting",
]);
export const TRIGGERABLE_STATUSES = new Set<RunPodInstanceStatus>([
  "pending",
  "deciding",
  "queued",
  "waiting",
  "running",
]);
export const TERMINAL_POD_STATUSES = new Set<RunPodInstanceStatus>([
  "completed",
  "error",
  "skipped",
]);
// Run 層級終態（不含 skipped，skipped 只存在於 pod 層級）
export const RUN_TERMINAL_STATUSES = new Set<RunStatus>(["completed", "error"]);

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
  autoPathwaySettled: PathwayState;
  directPathwaySettled: PathwayState;
  worktreePath: string | null;
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
  auto_pathway_settled: number | null;
  direct_pathway_settled: number | null;
  worktree_path: string | null;
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
    autoPathwaySettled: sqliteIntToPathwayState(row.auto_pathway_settled),
    directPathwaySettled: sqliteIntToPathwayState(row.direct_pathway_settled),
    worktreePath: row.worktree_path,
  };
}

function rowToRunMessage(row: RunMessageRow): PersistedMessage {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    timestamp: row.timestamp,
    ...(row.sub_messages_json
      ? {
          subMessages:
            safeJsonParse<PersistedSubMessage[]>(row.sub_messages_json) ??
            undefined,
        }
      : {}),
  };
}

class RunStore {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  createRun(
    canvasId: string,
    sourcePodId: string,
    triggerMessage: string,
  ): WorkflowRun {
    const run: WorkflowRun = {
      id: randomUUID(),
      canvasId,
      sourcePodId,
      triggerMessage,
      status: "running",
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
    const row = this.stmts.workflowRun.selectById.get(runId) as
      | WorkflowRunRow
      | undefined;
    if (!row) return undefined;
    return rowToWorkflowRun(row);
  }

  getRunsByCanvasId(canvasId: string): WorkflowRun[] {
    const rows = this.stmts.workflowRun.selectByCanvasId.all(
      canvasId,
    ) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  /**
   * 取得所有 status 為 running 的 WorkflowRun
   * 用於 graceful shutdown 時清理未完成的 Run
   */
  getRunningRuns(): WorkflowRun[] {
    const rows = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE status = 'running'")
      .all() as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    const completedAt = RUN_TERMINAL_STATUSES.has(status)
      ? new Date().toISOString()
      : null;
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
    const result = this.stmts.workflowRun.countByCanvasId.get(canvasId) as {
      count: number;
    };
    return result.count;
  }

  getOldestCompletedRunIds(canvasId: string, limit: number): string[] {
    const rows = this.stmts.workflowRun.selectOldestCompleted.all(
      canvasId,
      limit,
    ) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  createPodInstance(
    runId: string,
    podId: string,
    autoPathwaySettled: PathwayState = "not-applicable",
    directPathwaySettled: PathwayState = "not-applicable",
    worktreePath: string | null = null,
  ): RunPodInstance {
    const instance: RunPodInstance = {
      id: randomUUID(),
      runId,
      podId,
      status: "pending",
      claudeSessionId: null,
      errorMessage: null,
      triggeredAt: null,
      completedAt: null,
      autoPathwaySettled,
      directPathwaySettled,
      worktreePath,
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
      $autoPathwaySettled: pathwayStateToSqliteInt(autoPathwaySettled),
      $directPathwaySettled: pathwayStateToSqliteInt(directPathwaySettled),
      $worktreePath: worktreePath,
    });

    return instance;
  }

  settleAutoPathway(instanceId: string): void {
    this.stmts.runPodInstance.settleAutoPathway.run({ $id: instanceId });
  }

  settleDirectPathway(instanceId: string): void {
    this.stmts.runPodInstance.settleDirectPathway.run({ $id: instanceId });
  }

  getWorktreePathsByRunId(
    runId: string,
  ): Array<{ podId: string; worktreePath: string }> {
    const rows = this.stmts.runPodInstance.selectWorktreePathsByRunId.all(
      runId,
    ) as Array<{
      pod_id: string;
      worktree_path: string;
    }>;
    return rows.map((r) => ({
      podId: r.pod_id,
      worktreePath: r.worktree_path,
    }));
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
    const rows = this.stmts.runPodInstance.selectByRunId.all(
      runId,
    ) as RunPodInstanceRow[];
    return rows.map(rowToRunPodInstance);
  }

  updatePodInstanceStatus(
    instanceId: string,
    status: RunPodInstanceStatus,
    errorMessage?: string,
  ): void {
    // triggeredAt 只在 running 時設定，SQL 層會用 CASE WHEN 保護非 running 狀態不覆蓋已有值
    const triggeredAt = status === "running" ? new Date().toISOString() : null;
    const completedAt = TERMINAL_POD_STATUSES.has(status)
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

  updatePodInstanceClaudeSessionId(
    instanceId: string,
    sessionId: string,
  ): void {
    this.stmts.runPodInstance.updateClaudeSessionId.run({
      $claudeSessionId: sessionId,
      $id: instanceId,
    });
  }

  getRunningPodInstances(runId: string): RunPodInstance[] {
    const rows = this.stmts.runPodInstance.selectRunningByRunId.all(
      runId,
    ) as RunPodInstanceRow[];
    return rows.map(rowToRunPodInstance);
  }

  addRunMessage(
    runId: string,
    podId: string,
    role: "user" | "assistant",
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

  upsertRunMessage(
    runId: string,
    podId: string,
    message: PersistedMessage,
  ): void {
    this.stmts.runMessage.upsert.run({
      $id: message.id,
      $runId: runId,
      $podId: podId,
      $role: message.role,
      $content: message.content,
      $timestamp: message.timestamp,
      $subMessagesJson: message.subMessages
        ? JSON.stringify(message.subMessages)
        : null,
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
