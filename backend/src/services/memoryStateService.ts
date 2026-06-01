import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import { getDb } from "../database/index.js";
import { getStmts } from "../database/stmtsHelper.js";
import { safeJsonParse } from "@shared/safeJsonParse.js";

const MAINTENANCE_RETENTION_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type MemoryScopeType = "pod" | "repository";

export interface PodMemoryState {
  podId: string;
  memoryEnabled: boolean;
  hasSummary: boolean;
  summary: string | null;
  summaryUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoMemoryState {
  repositoryId: string;
  memoryEnabled: boolean;
  hasSummary: boolean;
  summary: string | null;
  summaryUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryJob {
  id: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  sourcePodId: string | null;
  repositoryId: string | null;
  status: string;
  attemptCount: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface MemoryObservation {
  id: string;
  jobId: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  kind: string;
  status: string;
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateMemoryJobInput {
  scopeType: MemoryScopeType;
  scopeId: string;
  sourcePodId?: string | null;
  repositoryId?: string | null;
  status?: string;
  attemptCount?: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryJobInput {
  status: string;
  attemptCount?: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordMemoryObservationInput {
  jobId: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  kind: string;
  status?: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
}

interface PodMemoryStateRow {
  pod_id: string;
  memory_enabled: number;
  summary: string | null;
  has_summary: number;
  summary_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoMemoryStateRow {
  repository_id: string;
  memory_enabled: number;
  summary: string | null;
  has_summary: number;
  summary_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryJobRow {
  id: string;
  scope_type: string;
  scope_id: string;
  source_pod_id: string | null;
  repository_id: string | null;
  status: string;
  attempt_count: number;
  error_message: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface MemoryObservationRow {
  id: string;
  job_id: string;
  scope_type: string;
  scope_id: string;
  kind: string;
  status: string;
  summary: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function fromSqliteBoolean(value: number | null | undefined): boolean {
  return value === 1;
}

function normalizeSummary(summary: string | null | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }

  const normalized = summary.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildExpiresAt(createdAt: Date): string {
  return new Date(
    createdAt.getTime() + MAINTENANCE_RETENTION_DAYS * DAY_IN_MS,
  ).toISOString();
}

function rowToPodMemoryState(row: PodMemoryStateRow): PodMemoryState {
  return {
    podId: row.pod_id,
    memoryEnabled: fromSqliteBoolean(row.memory_enabled),
    hasSummary: fromSqliteBoolean(row.has_summary),
    summary: row.summary,
    summaryUpdatedAt: row.summary_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRepoMemoryState(row: RepoMemoryStateRow): RepoMemoryState {
  return {
    repositoryId: row.repository_id,
    memoryEnabled: fromSqliteBoolean(row.memory_enabled),
    hasSummary: fromSqliteBoolean(row.has_summary),
    summary: row.summary,
    summaryUpdatedAt: row.summary_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMemoryJob(row: MemoryJobRow): MemoryJob {
  return {
    id: row.id,
    scopeType: row.scope_type as MemoryScopeType,
    scopeId: row.scope_id,
    sourcePodId: row.source_pod_id,
    repositoryId: row.repository_id,
    status: row.status,
    attemptCount: row.attempt_count,
    errorMessage: row.error_message,
    metadata:
      safeJsonParse<Record<string, unknown>>(row.metadata_json) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function rowToMemoryObservation(row: MemoryObservationRow): MemoryObservation {
  return {
    id: row.id,
    jobId: row.job_id,
    scopeType: row.scope_type as MemoryScopeType,
    scopeId: row.scope_id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    payload:
      safeJsonParse<Record<string, unknown>>(row.payload_json) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

class MemoryStateService {
  private readonly stmtCache = new Map<string, ReturnType<Database["prepare"]>>();
  private cachedDb: Database | null = null;

  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  private getCachedStmt(
    cacheKey: string,
    buildSql: () => string,
  ): ReturnType<Database["prepare"]> {
    const database = getDb();
    if (this.cachedDb !== database) {
      this.stmtCache.clear();
      this.cachedDb = database;
    }

    let stmt = this.stmtCache.get(cacheKey);
    if (!stmt) {
      stmt = database.prepare(buildSql());
      this.stmtCache.set(cacheKey, stmt);
    }
    return stmt;
  }

  private selectPodStateRows(podIds: string[]): PodMemoryStateRow[] {
    if (podIds.length === 0) {
      return [];
    }

    const uniquePodIds = [...new Set(podIds)];
    const placeholders = uniquePodIds.map(() => "?").join(", ");
    const stmt = this.getCachedStmt(
      `podMemoryStates:${uniquePodIds.length}`,
      () =>
        `SELECT * FROM pod_memory_states WHERE pod_id IN (${placeholders})`,
    );
    return stmt.all(...uniquePodIds) as PodMemoryStateRow[];
  }

  private selectRepoStateRows(repositoryIds: string[]): RepoMemoryStateRow[] {
    if (repositoryIds.length === 0) {
      return [];
    }

    const uniqueRepositoryIds = [...new Set(repositoryIds)];
    const placeholders = uniqueRepositoryIds.map(() => "?").join(", ");
    const stmt = this.getCachedStmt(
      `repoMemoryStates:${uniqueRepositoryIds.length}`,
      () =>
        `SELECT * FROM repo_memory_states WHERE repository_id IN (${placeholders})`,
    );
    return stmt.all(...uniqueRepositoryIds) as RepoMemoryStateRow[];
  }

  private upsertPodState(
    podId: string,
    data: {
      memoryEnabled: boolean;
      summary: string | null;
      hasSummary: boolean;
      summaryUpdatedAt: string | null;
    },
  ): PodMemoryState {
    const existing = this.getPodState(podId);
    const now = new Date().toISOString();

    this.stmts.podMemoryState.upsert.run({
      $podId: podId,
      $memoryEnabled: toSqliteBoolean(data.memoryEnabled),
      $summary: data.summary,
      $hasSummary: toSqliteBoolean(data.hasSummary),
      $summaryUpdatedAt: data.summaryUpdatedAt,
      $createdAt: existing?.createdAt ?? now,
      $updatedAt: now,
    });

    return this.getPodState(podId)!;
  }

  private upsertRepoState(
    repositoryId: string,
    data: {
      memoryEnabled: boolean;
      summary: string | null;
      hasSummary: boolean;
      summaryUpdatedAt: string | null;
    },
  ): RepoMemoryState {
    const existing = this.getRepoState(repositoryId);
    const now = new Date().toISOString();

    this.stmts.repoMemoryState.upsert.run({
      $repositoryId: repositoryId,
      $memoryEnabled: toSqliteBoolean(data.memoryEnabled),
      $summary: data.summary,
      $hasSummary: toSqliteBoolean(data.hasSummary),
      $summaryUpdatedAt: data.summaryUpdatedAt,
      $createdAt: existing?.createdAt ?? now,
      $updatedAt: now,
    });

    return this.getRepoState(repositoryId)!;
  }

  getPodState(podId: string): PodMemoryState | undefined {
    const row = this.stmts.podMemoryState.selectByPodId.get(podId) as
      | PodMemoryStateRow
      | null;
    return row ? rowToPodMemoryState(row) : undefined;
  }

  listPodStates(podIds: string[]): Map<string, PodMemoryState> {
    return new Map(
      this.selectPodStateRows(podIds).map((row) => {
        const state = rowToPodMemoryState(row);
        return [state.podId, state] as const;
      }),
    );
  }

  setPodMemoryEnabled(podId: string, memoryEnabled: boolean): PodMemoryState {
    const existing = this.getPodState(podId);
    return this.upsertPodState(podId, {
      memoryEnabled,
      summary: existing?.summary ?? null,
      hasSummary: existing?.hasSummary ?? false,
      summaryUpdatedAt: existing?.summaryUpdatedAt ?? null,
    });
  }

  writePodSummary(podId: string, summary: string | null): PodMemoryState {
    const existing = this.getPodState(podId);
    const normalizedSummary = normalizeSummary(summary);

    return this.upsertPodState(podId, {
      memoryEnabled: existing?.memoryEnabled ?? false,
      summary: normalizedSummary,
      hasSummary: normalizedSummary !== null,
      summaryUpdatedAt:
        normalizedSummary !== null ? new Date().toISOString() : null,
    });
  }

  getRepoState(repositoryId: string): RepoMemoryState | undefined {
    const row = this.stmts.repoMemoryState.selectByRepositoryId.get(
      repositoryId,
    ) as RepoMemoryStateRow | null;
    return row ? rowToRepoMemoryState(row) : undefined;
  }

  listRepoStates(repositoryIds: string[]): Map<string, RepoMemoryState> {
    return new Map(
      this.selectRepoStateRows(repositoryIds).map((row) => {
        const state = rowToRepoMemoryState(row);
        return [state.repositoryId, state] as const;
      }),
    );
  }

  writeRepoSummary(
    repositoryId: string,
    summary: string | null,
  ): RepoMemoryState {
    const existing = this.getRepoState(repositoryId);
    const normalizedSummary = normalizeSummary(summary);

    return this.upsertRepoState(repositoryId, {
      memoryEnabled: existing?.memoryEnabled ?? false,
      summary: normalizedSummary,
      hasSummary: normalizedSummary !== null,
      summaryUpdatedAt:
        normalizedSummary !== null ? new Date().toISOString() : null,
    });
  }

  setRepoMemoryEnabled(
    repositoryId: string,
    memoryEnabled: boolean,
  ): RepoMemoryState {
    const existing = this.getRepoState(repositoryId);
    return this.upsertRepoState(repositoryId, {
      memoryEnabled,
      summary: existing?.summary ?? null,
      hasSummary: existing?.hasSummary ?? false,
      summaryUpdatedAt: existing?.summaryUpdatedAt ?? null,
    });
  }

  clearPodSummary(podId: string): PodMemoryState {
    return this.writePodSummary(podId, null);
  }

  clearRepoSummary(repositoryId: string): RepoMemoryState {
    return this.writeRepoSummary(repositoryId, null);
  }

  deletePodState(podId: string): void {
    this.stmts.podMemoryState.deleteByPodId.run(podId);
  }

  deleteRepoState(repositoryId: string): void {
    this.stmts.repoMemoryState.deleteByRepositoryId.run(repositoryId);
  }

  createJob(input: CreateMemoryJobInput): MemoryJob {
    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();
    const id = randomUUID();

    this.stmts.memoryJob.insert.run({
      $id: id,
      $scopeType: input.scopeType,
      $scopeId: input.scopeId,
      $sourcePodId: input.sourcePodId ?? null,
      $repositoryId: input.repositoryId ?? null,
      $status: input.status ?? "pending",
      $attemptCount: input.attemptCount ?? 0,
      $errorMessage: input.errorMessage ?? null,
      $metadataJson: JSON.stringify(input.metadata ?? {}),
      $createdAt: createdAtIso,
      $updatedAt: createdAtIso,
      $expiresAt: buildExpiresAt(createdAt),
    });

    return this.getJobById(id)!;
  }

  getJobById(jobId: string): MemoryJob | undefined {
    const row = this.stmts.memoryJob.selectById.get(jobId) as
      | MemoryJobRow
      | null;
    return row ? rowToMemoryJob(row) : undefined;
  }

  listJobsByScope(
    scopeType: MemoryScopeType,
    scopeId: string,
  ): MemoryJob[] {
    const rows = this.stmts.memoryJob.selectByScope.all({
      $scopeType: scopeType,
      $scopeId: scopeId,
    }) as MemoryJobRow[];
    return rows.map(rowToMemoryJob);
  }

  updateJob(jobId: string, input: UpdateMemoryJobInput): MemoryJob | undefined {
    const existing = this.getJobById(jobId);
    if (!existing) {
      return undefined;
    }

    this.stmts.memoryJob.updateById.run({
      $id: jobId,
      $status: input.status,
      $attemptCount: input.attemptCount ?? existing.attemptCount,
      $errorMessage:
        input.errorMessage !== undefined
          ? input.errorMessage
          : existing.errorMessage,
      $metadataJson: JSON.stringify(input.metadata ?? existing.metadata),
      $updatedAt: new Date().toISOString(),
    });

    return this.getJobById(jobId);
  }

  recordObservation(
    input: RecordMemoryObservationInput,
  ): MemoryObservation {
    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();
    const id = randomUUID();

    this.stmts.memoryObservation.insert.run({
      $id: id,
      $jobId: input.jobId,
      $scopeType: input.scopeType,
      $scopeId: input.scopeId,
      $kind: input.kind,
      $status: input.status ?? "recorded",
      $summary: normalizeSummary(input.summary),
      $payloadJson: JSON.stringify(input.payload ?? {}),
      $createdAt: createdAtIso,
      $updatedAt: createdAtIso,
      $expiresAt: buildExpiresAt(createdAt),
    });

    return this.listObservationsByJobId(input.jobId).find(
      (observation) => observation.id === id,
    )!;
  }

  listObservationsByJobId(jobId: string): MemoryObservation[] {
    const rows = this.stmts.memoryObservation.selectByJobId.all(jobId) as
      MemoryObservationRow[];
    return rows.map(rowToMemoryObservation);
  }

  listObservationsByScope(
    scopeType: MemoryScopeType,
    scopeId: string,
  ): MemoryObservation[] {
    const rows = this.stmts.memoryObservation.selectByScope.all({
      $scopeType: scopeType,
      $scopeId: scopeId,
    }) as MemoryObservationRow[];
    return rows.map(rowToMemoryObservation);
  }

  clearScopeMaintenanceRecords(
    scopeType: MemoryScopeType,
    scopeId: string,
  ): void {
    getDb().transaction(() => {
      this.stmts.memoryObservation.deleteByScope.run({
        $scopeType: scopeType,
        $scopeId: scopeId,
      });
      this.stmts.memoryJob.deleteByScope.run({
        $scopeType: scopeType,
        $scopeId: scopeId,
      });
    })();
  }

  pruneExpiredMaintenanceRecords(now: Date = new Date()): {
    deletedJobs: number;
    deletedObservations: number;
  } {
    const cutoffIso = now.toISOString();
    const deleteObservationsResult = this.stmts.memoryObservation.deleteExpired.run(
      cutoffIso,
    ) as { changes?: number };
    const deleteJobsResult = this.stmts.memoryJob.deleteExpired.run(
      cutoffIso,
    ) as { changes?: number };

    return {
      deletedJobs: deleteJobsResult.changes ?? 0,
      deletedObservations: deleteObservationsResult.changes ?? 0,
    };
  }
}

export const memoryStateService = new MemoryStateService();
