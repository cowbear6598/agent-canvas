import {
  runStore,
  NEVER_TRIGGERED_STATUSES,
  IN_PROGRESS_STATUSES,
  TERMINAL_POD_STATUSES,
} from "../runStore.js";
import type { RunPodInstance, RunPodInstanceStatus } from "../runStore.js";
import { isAllPathwaysSettled } from "../../utils/pathwayHelpers.js";
import type { PathwayState } from "../../types/run.js";
import { connectionStore } from "../connectionStore.js";
import type { Connection } from "../../types/index.js";
import { podStore } from "../podStore.js";
import { socketService } from "../socketService.js";
import { claudeService } from "../claude/claudeService.js";
import { logger } from "../../utils/logger.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { isAutoTriggerable, buildRunQueueKey } from "./workflowHelpers.js";
import { runQueueService } from "./runQueueService.js";
import type { SettlementPathway } from "./types.js";
import type {
  RunContext,
  RunCreatedPayload,
  RunStatusChangedPayload,
  RunPodStatusChangedPayload,
  RunDeletedPayload,
} from "../../types/run.js";
import { gitService } from "../workspace/gitService.js";
import { config } from "../../config/index.js";
import path from "path";
import { getResultErrorString } from "../../types/result.js";

const MAX_RUNS_PER_CANVAS = 30;

export function isInstanceUnreachable(
  instance: RunPodInstance,
  incomingConns: Connection[],
  allInstances: RunPodInstance[],
): { autoUnreachable: boolean; directUnreachable: boolean } {
  const autoConns = incomingConns.filter((c) =>
    isAutoTriggerable(c.triggerMode),
  );
  const directConns = incomingConns.filter((c) => c.triggerMode === "direct");

  const autoUnreachable =
    instance.autoPathwaySettled === "pending" &&
    autoConns.length > 0 &&
    autoConns.some((c) => {
      const src = allInstances.find((i) => i.podId === c.sourcePodId);
      return src && (src.status === "skipped" || src.status === "error");
    });

  const directUnreachable =
    instance.directPathwaySettled === "pending" &&
    directConns.length > 0 &&
    directConns.every((c) => {
      const src = allInstances.find((i) => i.podId === c.sourcePodId);
      return src && (src.status === "skipped" || src.status === "error");
    });

  return { autoUnreachable, directUnreachable };
}

/**
 * 偵測並 settle 單一 instance 的不可達路徑。
 * 若有任何路徑被 settle，回傳 true；否則回傳 false。
 * @mutates instance - 會直接修改 instance 的 autoPathwaySettled、directPathwaySettled、status 欄位
 */
export function settleInstanceIfUnreachable(
  instance: RunPodInstance,
  connections: Connection[],
  instances: RunPodInstance[],
  instancePodIds: Set<string>,
): boolean {
  if (!NEVER_TRIGGERED_STATUSES.has(instance.status)) return false;

  const incomingConns = connections.filter(
    (c) =>
      c.targetPodId === instance.podId && instancePodIds.has(c.sourcePodId),
  );
  const { autoUnreachable, directUnreachable } = isInstanceUnreachable(
    instance,
    incomingConns,
    instances,
  );

  if (autoUnreachable) {
    runStore.settleAutoPathway(instance.id);
    instance.autoPathwaySettled = "settled";
  }

  if (directUnreachable) {
    runStore.settleDirectPathway(instance.id);
    instance.directPathwaySettled = "settled";
  }

  if (!autoUnreachable && !directUnreachable) return false;

  if (
    isAllPathwaysSettled(
      instance.autoPathwaySettled,
      instance.directPathwaySettled,
    )
  ) {
    const newStatus = NEVER_TRIGGERED_STATUSES.has(instance.status)
      ? "skipped"
      : "completed";
    runStore.updatePodInstanceStatus(instance.id, newStatus);
    instance.status = newStatus;
  }

  return true;
}

class RunExecutionService {
  // key: runId, value: Set<podId> — 追蹤每個 run 中正在活躍串流的 pod
  private activeRunStreams: Map<string, Set<string>> = new Map();

  async createRun(
    canvasId: string,
    sourcePodId: string,
    triggerMessage: string,
  ): Promise<RunContext> {
    const workflowRun = runStore.createRun(
      canvasId,
      sourcePodId,
      triggerMessage,
    );

    const chainPodIds = this.collectChainPodIds(canvasId, sourcePodId);
    const instances = await Promise.all(
      chainPodIds.map(async (podId) => {
        const pathways = this.calculatePathways(
          canvasId,
          podId,
          sourcePodId,
          chainPodIds,
        );

        const worktreePath = await this.resolveWorktreePath(
          canvasId,
          podId,
          workflowRun.id,
        );

        return runStore.createPodInstance(
          workflowRun.id,
          podId,
          pathways.autoPathwaySettled,
          pathways.directPathwaySettled,
          worktreePath,
        );
      }),
    );

    const instancesWithNames = instances.map((instance) => {
      const { worktreePath: _worktreePath, ...instanceData } = instance;
      const pod = podStore.getById(canvasId, instance.podId);
      return {
        ...instanceData,
        podName: pod?.name ?? instance.podId,
      };
    });

    const sourcePodName =
      instancesWithNames.find((i) => i.podId === sourcePodId)?.podName ??
      sourcePodId;

    logger.log(
      "Run",
      "Create",
      `建立 Run ${workflowRun.id}，共 ${instances.length} 個 pod instance`,
    );

    socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CREATED, {
      canvasId,
      run: { ...workflowRun, podInstances: instancesWithNames, sourcePodName },
    } as RunCreatedPayload);

    this.enforceRunLimit(canvasId);

    return { runId: workflowRun.id, canvasId, sourcePodId };
  }

  private async resolveWorktreePath(
    canvasId: string,
    podId: string,
    runId: string,
  ): Promise<string | null> {
    const pod = podStore.getById(canvasId, podId);
    if (!pod?.repositoryId) return null;

    const repoPath = path.join(config.repositoriesRoot, pod.repositoryId);
    const isGitResult = await gitService.isGitRepository(repoPath);
    if (!isGitResult.success || !isGitResult.data) return null;

    // 空的 repo（尚無任何 commit）無法建立 worktree，直接回傳 null 不印錯誤
    const hasCommitsResult = await gitService.hasCommits(repoPath);
    if (!hasCommitsResult.success || !hasCommitsResult.data) return null;

    const worktreePath = path.join(
      config.repositoriesRoot,
      `${pod.repositoryId}-run-${runId}-${podId}`,
    );

    const createResult = await gitService.createDetachedWorktree(
      repoPath,
      worktreePath,
    );

    if (!createResult.success) {
      logger.warn(
        "Run",
        "Warn",
        `建立 Detached Worktree 失敗，fallback 到原始路徑 (podId=${podId}, runId=${runId}): ${createResult.error}`,
      );
      return null;
    }

    return worktreePath;
  }

  private collectChainPodIds(canvasId: string, sourcePodId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [sourcePodId];
    visited.add(sourcePodId);

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) break;

      const connections = connectionStore.findBySourcePodId(
        canvasId,
        currentId,
      );
      for (const conn of connections) {
        if (!visited.has(conn.targetPodId)) {
          visited.add(conn.targetPodId);
          queue.push(conn.targetPodId);
        }
      }
    }

    return [...visited];
  }

  private calculatePathways(
    canvasId: string,
    podId: string,
    sourcePodId: string,
    chainPodIds: string[],
  ): { autoPathwaySettled: PathwayState; directPathwaySettled: PathwayState } {
    if (podId === sourcePodId) {
      return {
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      };
    }

    const connections = connectionStore.findByTargetPodId(canvasId, podId);
    const chainConnections = connections.filter((c) =>
      chainPodIds.includes(c.sourcePodId),
    );

    if (chainConnections.length === 0) {
      return {
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      };
    }

    const hasAutoTriggerable = chainConnections.some((c) =>
      isAutoTriggerable(c.triggerMode),
    );
    const hasDirect = chainConnections.some((c) => c.triggerMode === "direct");

    return {
      autoPathwaySettled: hasAutoTriggerable ? "pending" : "not-applicable",
      directPathwaySettled: hasDirect ? "pending" : "not-applicable",
    };
  }

  private enforceRunLimit(canvasId: string): void {
    const count = runStore.countRunsByCanvasId(canvasId);
    if (count <= MAX_RUNS_PER_CANVAS) return;

    const overflow = count - MAX_RUNS_PER_CANVAS;
    const oldestIds = runStore.getOldestCompletedRunIds(canvasId, overflow);
    for (const runId of oldestIds) {
      void this.deleteRun(runId);
    }
  }

  startPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "running");
  }

  private settlePathwayAndRefresh(
    runContext: RunContext,
    podId: string,
    pathway: SettlementPathway,
    callerName: string,
  ): RunPodInstance | null {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn(
        "Run",
        "Warn",
        `${callerName}：找不到 instance (runId=${runContext.runId}, podId=${podId})`,
      );
      return null;
    }

    if (pathway === "auto") {
      runStore.settleAutoPathway(instance.id);
    } else {
      runStore.settleDirectPathway(instance.id);
    }

    const updated = runStore.getPodInstance(runContext.runId, podId);
    if (!updated) {
      logger.warn(
        "Run",
        "Warn",
        `${callerName}：settle 後找不到 instance (runId=${runContext.runId}, podId=${podId})`,
      );
      return null;
    }

    return updated;
  }

  settlePodTrigger(
    runContext: RunContext,
    podId: string,
    pathway: SettlementPathway,
  ): void {
    const updated = this.settlePathwayAndRefresh(
      runContext,
      podId,
      pathway,
      "settlePodTrigger",
    );
    if (!updated) return;

    if (
      !isAllPathwaysSettled(
        updated.autoPathwaySettled,
        updated.directPathwaySettled,
      )
    )
      return;
    if (NEVER_TRIGGERED_STATUSES.has(updated.status)) return;

    const key = buildRunQueueKey(runContext.runId, podId);
    if (runQueueService.getQueueSize(key) > 0) {
      // 佇列中還有待處理項目，不提前標記 completed，等佇列消化完再說
      return;
    }

    this.updateAndEmitPodInstanceStatus(runContext, podId, "completed", {
      evaluateRun: true,
    });
  }

  settleAndSkipPath(
    runContext: RunContext,
    podId: string,
    pathway: SettlementPathway,
  ): void {
    const updated = this.settlePathwayAndRefresh(
      runContext,
      podId,
      pathway,
      "settleAndSkipPath",
    );
    if (
      !updated ||
      !isAllPathwaysSettled(
        updated.autoPathwaySettled,
        updated.directPathwaySettled,
      )
    )
      return;

    if (NEVER_TRIGGERED_STATUSES.has(updated.status)) {
      this.updateAndEmitPodInstanceStatus(runContext, podId, "skipped", {
        evaluateRun: true,
      });
    } else {
      this.updateAndEmitPodInstanceStatus(runContext, podId, "completed", {
        evaluateRun: true,
      });
    }
  }

  /**
   * 在 evaluateRunStatus 前呼叫，偵測不可達路徑並直接更新 DB + emit WebSocket。
   * 不呼叫 settleAndSkipPath，避免遞迴觸發 evaluateRunStatus。
   * while 迴圈確保多層級聯 skip 能完整處理。
   * Auto 路徑：ANY auto-triggerable source skipped/error → 不可達
   * Direct 路徑：ALL direct sources skipped/error → 不可達
   */
  private settleUnreachablePaths(runId: string, canvasId: string): void {
    const instances = runStore.getPodInstancesByRunId(runId);
    const connections = connectionStore.list(canvasId);
    const instancePodIds = new Set(instances.map((i) => i.podId));
    let safetyLimit = instances.length;

    while (safetyLimit-- > 0) {
      let changed = false;

      for (const instance of instances) {
        const settled = settleInstanceIfUnreachable(
          instance,
          connections,
          instances,
          instancePodIds,
        );
        if (!settled) continue;

        changed = true;

        // 所有路徑已 settled 且狀態已更新時，發送 WebSocket 通知
        if (
          isAllPathwaysSettled(
            instance.autoPathwaySettled,
            instance.directPathwaySettled,
          ) &&
          (instance.status === "skipped" || instance.status === "completed")
        ) {
          socketService.emitToCanvas(
            canvasId,
            WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
            {
              runId,
              canvasId,
              podId: instance.podId,
              status: instance.status,
              completedAt: new Date().toISOString(),
              autoPathwaySettled: instance.autoPathwaySettled,
              directPathwaySettled: instance.directPathwaySettled,
            } satisfies RunPodStatusChangedPayload,
          );
        }
      }

      if (!changed) break;
    }

    if (safetyLimit <= 0) {
      logger.warn(
        "Run",
        "Warn",
        `settleUnreachablePaths 達到迭代上限 (runId: ${runId})`,
      );
    }
  }

  errorPodInstance(
    runContext: RunContext,
    podId: string,
    errorMessage: string,
  ): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "error", {
      evaluateRun: true,
      errorMessage,
    });
  }

  summarizingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "summarizing");
  }

  decidingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "deciding");
  }

  queuedPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "queued");
  }

  waitingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "waiting");
  }

  private updateAndEmitPodInstanceStatus(
    runContext: RunContext,
    podId: string,
    status: RunPodInstanceStatus,
    options?: { evaluateRun?: boolean; errorMessage?: string },
  ): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn(
        "Run",
        "Warn",
        `更新 pod instance 狀態失敗：找不到 instance (runId=${runContext.runId}, podId=${podId})`,
      );
      return;
    }

    if (options?.errorMessage) {
      runStore.updatePodInstanceStatus(
        instance.id,
        status,
        options.errorMessage,
      );
    } else {
      runStore.updatePodInstanceStatus(instance.id, status);
    }

    // running 時記錄啟動時間；其他狀態保留原有的 triggeredAt（與 SQL CASE WHEN 邏輯一致）
    const triggeredAt =
      status === "running"
        ? new Date().toISOString()
        : (instance.triggeredAt ?? undefined);
    const isTerminal = TERMINAL_POD_STATUSES.has(status);
    const completedAt = isTerminal
      ? new Date().toISOString()
      : (instance.completedAt ?? undefined);

    socketService.emitToCanvas(
      runContext.canvasId,
      WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
      {
        runId: runContext.runId,
        canvasId: runContext.canvasId,
        podId,
        status,
        errorMessage:
          options?.errorMessage ?? instance.errorMessage ?? undefined,
        triggeredAt,
        completedAt,
        autoPathwaySettled: instance.autoPathwaySettled,
        directPathwaySettled: instance.directPathwaySettled,
      } satisfies RunPodStatusChangedPayload,
    );

    if (options?.evaluateRun) {
      this.evaluateRunStatus(runContext.runId, runContext.canvasId);
    }
  }

  /**
   * 清理指定 Run 的所有 worktree。
   * 冪等：worktree 已不存在時只 log warning，不拋出錯誤。
   */
  private async cleanupRunWorktrees(runId: string): Promise<void> {
    const entries = runStore.getWorktreePathsByRunId(runId);
    if (entries.length === 0) return;

    await Promise.all(
      entries.map(async (entry) => {
        const podResult = podStore.getByIdGlobal(entry.podId);
        if (!podResult) {
          logger.warn(
            "Run",
            "Warn",
            `清理 worktree 失敗：找不到 pod (podId=${entry.podId}, runId=${runId})`,
          );
          return;
        }

        const pod = podResult.pod;
        if (!pod.repositoryId) return;

        const parentRepoPath = path.join(
          config.repositoriesRoot,
          pod.repositoryId,
        );
        const result = await gitService.removeWorktree(
          parentRepoPath,
          entry.worktreePath,
        );

        if (!result.success) {
          logger.warn(
            "Run",
            "Warn",
            `移除 worktree 失敗（已忽略），runId=${runId}, podId=${entry.podId}, path=${entry.worktreePath}: ${getResultErrorString(result.error)}`,
          );
        }
      }),
    );
  }

  /**
   * 判斷規則：
   * - 全部 completed/skipped → completed
   * - 有 error 且無 running/pending/summarizing → error
   * - 其他 → 維持 running（不更新）
   * 巢狀條件超過閾值，加此說明
   */
  private evaluateRunStatus(runId: string, canvasId: string): void {
    this.settleUnreachablePaths(runId, canvasId);

    const instances = runStore.getPodInstancesByRunId(runId);
    if (instances.length === 0) return;

    const hasError = instances.some((i) => i.status === "error");
    const hasInProgress = instances.some((i) =>
      IN_PROGRESS_STATUSES.has(i.status),
    );
    const allDone = instances.every(
      (i) => i.status === "completed" || i.status === "skipped",
    );

    let newStatus: "completed" | "error" | null = null;

    if (allDone) {
      newStatus = "completed";
    } else if (hasError && !hasInProgress) {
      newStatus = "error";
    }

    if (!newStatus) return;

    runStore.updateRunStatus(runId, newStatus);
    const updatedRun = runStore.getRun(runId);

    logger.log("Run", "Complete", `Run ${runId} 狀態變更為 ${newStatus}`);

    // Run 自然完成時立即回收所有 worktree
    void this.cleanupRunWorktrees(runId);

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      {
        runId,
        canvasId,
        status: newStatus,
        completedAt: updatedRun?.completedAt ?? undefined,
      } as RunStatusChangedPayload,
    );
  }

  registerActiveStream(runId: string, podId: string): void {
    if (!this.activeRunStreams.has(runId)) {
      this.activeRunStreams.set(runId, new Set());
    }
    this.activeRunStreams.get(runId)!.add(podId);
  }

  unregisterActiveStream(runId: string, podId: string): void {
    const streams = this.activeRunStreams.get(runId);
    if (!streams) return;

    streams.delete(podId);
    if (streams.size === 0) {
      this.activeRunStreams.delete(runId);
    }
  }

  /**
   * 找出目前所有包含指定 podId 的活躍 runId 列表。
   * 用於刪除 Pod 時中止 Run 模式的查詢。
   */
  getActiveRunIdsForPod(podId: string): string[] {
    const runIds: string[] = [];
    for (const [runId, podIds] of this.activeRunStreams) {
      if (podIds.has(podId)) {
        runIds.push(runId);
      }
    }
    return runIds;
  }

  async deleteRun(runId: string): Promise<void> {
    const activePodIds = this.activeRunStreams.get(runId);
    if (activePodIds) {
      for (const podId of activePodIds) {
        try {
          // Run mode 的 query key 是 ${runId}:${podId}
          claudeService.abortQuery(`${runId}:${podId}`);
        } catch (error) {
          // Claude SDK 內部在 abort 時可能拋出 "Operation aborted" 錯誤，忽略即可
          logger.warn(
            "Run",
            "Delete",
            `中止 Pod ${podId} 時發生非致命錯誤: ${error}`,
          );
        }
      }
      this.activeRunStreams.delete(runId);
    }

    const run = runStore.getRun(runId);
    const canvasId = run?.canvasId ?? "";

    // 防禦性清理：處理 Run 中途被砍、或 evaluateRunStatus 清理失敗的情況
    await this.cleanupRunWorktrees(runId);

    runStore.deleteRun(runId);
    logger.log("Run", "Delete", `刪除 Run ${runId}`);

    if (canvasId) {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_DELETED,
        {
          runId,
          canvasId,
        } as RunDeletedPayload,
      );
    }
  }
}

export const runExecutionService = new RunExecutionService();
