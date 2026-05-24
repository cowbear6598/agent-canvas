import { randomUUID } from "crypto";
import type {
  PersistedMessage,
  PersistedRunGoalRoundDivider,
  PersistedSubMessage,
} from "../types";
import type { MessageRole, SystemMessageMetadata } from "../types/message.js";
import type {
  RunChatTimelineItem,
  RunMessagesPageCursor,
  RunMessagesPageInfo,
} from "../types/run.js";
import type { PathwayState } from "../types/run.js";
import { getStmts } from "../database/stmtsHelper.js";
import { safeJsonParse } from "@shared/safeJsonParse.js";
import {
  pathwayStateToSqliteInt,
  sqliteIntToPathwayState,
} from "../utils/pathwayHelpers.js";

export type RunStatus = "running" | "completed" | "error" | "cancelled";
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
// cancelled：使用者主動刪除執行中的 Run，標記後立即 DELETE 以避免背景 callback 寫 DB
export const RUN_TERMINAL_STATUSES = new Set<RunStatus>([
  "completed",
  "error",
  "cancelled",
]);

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
  sessionId: string | null;
  errorMessage: string | null;
  lastResponseSummary: string | null;
  triggeredAt: string | null;
  completedAt: string | null;
  autoPathwaySettled: PathwayState;
  directPathwaySettled: PathwayState;
  runRepoPath: string | null;
  workspacePath: string | null;
}

export interface RunPodInstancePaths {
  runRepoPath?: string | null;
  workspacePath?: string | null;
}

export interface RunMessage {
  id: string;
  runId: string;
  podId: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: SystemMessageMetadata;
  subMessages?: PersistedSubMessage[];
}

export interface GetRunMessagesPageOptions {
  limit?: number;
  cursor?: RunMessagesPageCursor | null;
}

export interface RunMessagesPage {
  messages: PersistedMessage[];
  timelineItems: RunChatTimelineItem[];
  pageInfo: RunMessagesPageInfo;
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
  session_id: string | null;
  error_message: string | null;
  last_response_summary: string | null;
  triggered_at: string | null;
  completed_at: string | null;
  auto_pathway_settled: number | null;
  direct_pathway_settled: number | null;
  run_repo_path: string | null;
  workspace_path: string | null;
}

interface RunMessageRow {
  id: string;
  run_id: string;
  pod_id: string;
  role: string;
  content: string;
  timestamp: string;
  sub_messages_json: string | null;
  metadata_json: string | null;
}

interface RunGoalRoundDividerRow {
  id: string;
  run_id: string;
  pod_id: string;
  source_pod_ids_json: string;
  source_pod_names_json: string;
  status: string;
  blocked_reason: string | null;
  completed_at: string;
  connection_ids_json: string;
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
    sessionId: row.session_id,
    errorMessage: row.error_message,
    lastResponseSummary: row.last_response_summary,
    triggeredAt: row.triggered_at,
    completedAt: row.completed_at,
    autoPathwaySettled: sqliteIntToPathwayState(row.auto_pathway_settled),
    directPathwaySettled: sqliteIntToPathwayState(row.direct_pathway_settled),
    runRepoPath: row.run_repo_path,
    workspacePath: row.workspace_path,
  };
}

function rowToRunMessage(row: RunMessageRow): PersistedMessage {
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    timestamp: row.timestamp,
    ...(row.metadata_json
      ? {
          metadata:
            safeJsonParse<SystemMessageMetadata>(row.metadata_json) ??
            undefined,
        }
      : {}),
    ...(row.sub_messages_json
      ? {
          subMessages:
            safeJsonParse<PersistedSubMessage[]>(row.sub_messages_json) ??
            undefined,
        }
      : {}),
  };
}

function rowToRunGoalRoundDivider(
  row: RunGoalRoundDividerRow,
): PersistedRunGoalRoundDivider {
  return {
    type: "goal-round-divider",
    id: row.id,
    runId: row.run_id,
    podId: row.pod_id,
    sourcePodIds: safeJsonParse<string[]>(row.source_pod_ids_json) ?? [],
    sourcePodNames: safeJsonParse<string[]>(row.source_pod_names_json) ?? [],
    status: row.status === "blocked" ? "blocked" : "completed",
    blockedReason: row.blocked_reason,
    completedAt: row.completed_at,
    connectionIds: safeJsonParse<string[]>(row.connection_ids_json) ?? [],
  };
}

function isRunGoalRoundDivider(
  item: RunChatTimelineItem,
): item is PersistedRunGoalRoundDivider {
  return "type" in item && item.type === "goal-round-divider";
}

function getRunTimelineTimestamp(item: RunChatTimelineItem): string {
  return isRunGoalRoundDivider(item) ? item.completedAt : item.timestamp;
}

function getRunTimelineKindOrder(item: RunChatTimelineItem): number {
  return isRunGoalRoundDivider(item) ? 1 : 0;
}

function sortRunTimelineItems(
  items: RunChatTimelineItem[],
): RunChatTimelineItem[] {
  return [...items].sort((a, b) => {
    const aTimestamp = getRunTimelineTimestamp(a);
    const bTimestamp = getRunTimelineTimestamp(b);
    const timestampOrder = aTimestamp.localeCompare(bTimestamp);
    if (timestampOrder !== 0) return timestampOrder;
    const kindOrder = getRunTimelineKindOrder(a) - getRunTimelineKindOrder(b);
    if (kindOrder !== 0) return kindOrder;
    return a.id.localeCompare(b.id);
  });
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
    const rows = this.stmts.workflowRun.selectRunning.all() as WorkflowRunRow[];
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
    paths: RunPodInstancePaths | string | null = {},
  ): RunPodInstance {
    const normalizedPaths =
      typeof paths === "string" ? { runRepoPath: paths } : (paths ?? {});

    const instance: RunPodInstance = {
      id: randomUUID(),
      runId,
      podId,
      status: "pending",
      sessionId: null,
      errorMessage: null,
      lastResponseSummary: null,
      triggeredAt: null,
      completedAt: null,
      autoPathwaySettled,
      directPathwaySettled,
      runRepoPath: normalizedPaths.runRepoPath ?? null,
      workspacePath: normalizedPaths.workspacePath ?? null,
    };

    this.stmts.runPodInstance.insert.run({
      $id: instance.id,
      $runId: instance.runId,
      $podId: instance.podId,
      $status: instance.status,
      $sessionId: instance.sessionId,
      $errorMessage: instance.errorMessage,
      $lastResponseSummary: instance.lastResponseSummary,
      $triggeredAt: instance.triggeredAt,
      $completedAt: instance.completedAt,
      $autoPathwaySettled: pathwayStateToSqliteInt(autoPathwaySettled),
      $directPathwaySettled: pathwayStateToSqliteInt(directPathwaySettled),
      $runRepoPath: instance.runRepoPath,
      $workspacePath: instance.workspacePath,
    });

    return instance;
  }

  settleAutoPathway(instanceId: string): void {
    this.stmts.runPodInstance.settleAutoPathway.run({ $id: instanceId });
  }

  settleDirectPathway(instanceId: string): void {
    this.stmts.runPodInstance.settleDirectPathway.run({ $id: instanceId });
  }

  getRunRepoPathsByRunId(
    runId: string,
  ): Array<{ podId: string; runRepoPath: string }> {
    const rows = this.stmts.runPodInstance.selectRunRepoPathsByRunId.all(
      runId,
    ) as Array<{
      pod_id: string;
      run_repo_path: string;
    }>;
    return rows.map((r) => ({
      podId: r.pod_id,
      runRepoPath: r.run_repo_path,
    }));
  }

  getExecutionPathsByRunId(runId: string): Array<{
    podId: string;
    runRepoPath: string | null;
    workspacePath: string | null;
  }> {
    const rows = this.stmts.runPodInstance.selectExecutionPathsByRunId.all(
      runId,
    ) as Array<{
      pod_id: string;
      run_repo_path: string | null;
      workspace_path: string | null;
    }>;

    return rows.map((row) => ({
      podId: row.pod_id,
      runRepoPath: row.run_repo_path,
      workspacePath: row.workspace_path,
    }));
  }

  /**
   * 清除指定 Run 所有 pod instance 的 run_repo_path。
   * 在 run repo 實際刪除成功後呼叫，防止二次清理。
   */
  clearRunRepoPathsByRunId(runId: string): void {
    this.stmts.runPodInstance.clearRunRepoPathsByRunId.run(runId);
  }

  clearExecutionPathsByRunId(runId: string): void {
    this.stmts.runPodInstance.clearExecutionPathsByRunId.run(runId);
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

  updatePodInstanceSessionId(instanceId: string, sessionId: string): void {
    this.stmts.runPodInstance.updateSessionId.run({
      $sessionId: sessionId,
      $id: instanceId,
    });
  }

  updatePodInstanceLastResponseSummary(
    instanceId: string,
    lastResponseSummary: string | null,
  ): void {
    this.stmts.runPodInstance.updateLastResponseSummary.run({
      $id: instanceId,
      $lastResponseSummary: lastResponseSummary,
    });
  }

  getRunningPodInstances(runId: string): RunPodInstance[] {
    const rows = this.stmts.runPodInstance.selectRunningByRunId.all(
      runId,
    ) as RunPodInstanceRow[];
    return rows.map(rowToRunPodInstance);
  }

  /**
   * 新增一筆 Run 訊息到 DB 並回傳完整 PersistedMessage。
   *
   * @param id - 選填。當 caller 需要讓「外部資源（如附件目錄）的路徑」與 message id 對齊時，
   *             可預先產生 uuid 並傳入；未傳則由函式內部自動產生。
   */
  addRunMessage(
    runId: string,
    podId: string,
    role: MessageRole,
    content: string,
    subMessages?: PersistedSubMessage[],
    id?: string,
    metadata?: SystemMessageMetadata,
  ): PersistedMessage {
    const message: PersistedMessage = {
      id: id ?? randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
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
      $metadataJson: metadata ? JSON.stringify(metadata) : null,
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
      $metadataJson: message.metadata ? JSON.stringify(message.metadata) : null,
    });
  }

  getRunMessages(runId: string, podId: string): PersistedMessage[] {
    const rows = this.stmts.runMessage.selectByRunIdAndPodId.all({
      $runId: runId,
      $podId: podId,
    }) as RunMessageRow[];
    return rows.map(rowToRunMessage);
  }

  addRunGoalRoundDivider(input: {
    runId: string;
    podId: string;
    sourcePodIds: string[];
    sourcePodNames: string[];
    status: PersistedRunGoalRoundDivider["status"];
    blockedReason?: string | null;
    completedAt?: string;
    connectionIds: string[];
    id?: string;
  }): PersistedRunGoalRoundDivider {
    const divider: PersistedRunGoalRoundDivider = {
      type: "goal-round-divider",
      id: input.id ?? randomUUID(),
      runId: input.runId,
      podId: input.podId,
      sourcePodIds: input.sourcePodIds,
      sourcePodNames: input.sourcePodNames,
      status: input.status,
      blockedReason: input.blockedReason ?? null,
      completedAt: input.completedAt ?? new Date().toISOString(),
      connectionIds: input.connectionIds,
    };

    this.stmts.runGoalRoundDivider.insert.run({
      $id: divider.id,
      $runId: divider.runId,
      $podId: divider.podId,
      $sourcePodIdsJson: JSON.stringify(divider.sourcePodIds),
      $sourcePodNamesJson: JSON.stringify(divider.sourcePodNames),
      $status: divider.status,
      $blockedReason: divider.blockedReason,
      $completedAt: divider.completedAt,
      $connectionIdsJson: JSON.stringify(divider.connectionIds),
    });

    return divider;
  }

  getRunGoalRoundDividers(
    runId: string,
    podId: string,
  ): PersistedRunGoalRoundDivider[] {
    const rows = this.stmts.runGoalRoundDivider.selectByRunIdAndPodId.all({
      $runId: runId,
      $podId: podId,
    }) as RunGoalRoundDividerRow[];
    return rows.map(rowToRunGoalRoundDivider);
  }

  getRunTimelineItems(runId: string, podId: string): RunChatTimelineItem[] {
    return sortRunTimelineItems([
      ...this.getRunMessages(runId, podId),
      ...this.getRunGoalRoundDividers(runId, podId),
    ]);
  }

  getRunMessagesPage(
    runId: string,
    podId: string,
    options: GetRunMessagesPageOptions = {},
  ): RunMessagesPage {
    const limit = options.limit ?? 50;
    const cursor = options.cursor ?? null;
    const rows = this.stmts.runMessage.selectPageByRunIdAndPodId.all({
      $runId: runId,
      $podId: podId,
      $hasCursor: cursor ? 1 : 0,
      $beforeTimestamp: cursor?.beforeTimestamp ?? "",
      $beforeMessageId: cursor?.beforeMessageId ?? "",
      $limitPlusOne: limit + 1,
    }) as RunMessageRow[];

    const hasMore = rows.length > limit;
    const pageRows = (hasMore ? rows.slice(0, limit) : rows).reverse();
    const messages = pageRows.map(rowToRunMessage);
    const oldestMessage = messages[0];
    const dividers = this.getRunGoalRoundDividers(runId, podId).filter(
      (divider) => {
        if (!oldestMessage) return true;
        const newestMessage = messages[messages.length - 1];
        if (!newestMessage) return false;
        if (!cursor) {
          return divider.completedAt >= oldestMessage.timestamp;
        }
        return (
          divider.completedAt >= oldestMessage.timestamp &&
          divider.completedAt <= newestMessage.timestamp
        );
      },
    );

    return {
      messages,
      timelineItems: sortRunTimelineItems([...messages, ...dividers]),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && oldestMessage
            ? {
                beforeTimestamp: oldestMessage.timestamp,
                beforeMessageId: oldestMessage.id,
              }
            : null,
      },
    };
  }

  /**
   * 查詢 run_pod_instances 表，判斷指定 pod 是否有任何 active 狀態的 instance。
   * 用於取代原本 pod.status busy 概念，判斷 pod 是否正在執行中。
   */
  hasActiveRunForPod(podId: string): boolean {
    const row = this.stmts.runPodInstance.selectActiveByPodId.get(podId) as {
      id: string;
    } | null;
    return row !== null;
  }
}

export const runStore = new RunStore();
