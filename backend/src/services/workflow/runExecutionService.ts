import {
  runStore,
  NEVER_TRIGGERED_STATUSES,
  RUN_TERMINAL_STATUSES,
  RUN_HISTORY_RETENTION_COUNT,
} from "../runStore.js";
import type { RunPodInstance, RunPodInstanceStatus } from "../runStore.js";
import { isAllPathwaysSettled } from "../../utils/pathwayHelpers.js";
import type { PathwayState } from "../../types/run.js";
import type { Connection } from "../../types/index.js";
import { socketService } from "../socketService.js";
import { abortRegistry } from "../provider/abortRegistry.js";
import { logger } from "../../utils/logger.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { isAutoTriggerable, buildRunQueueKey } from "./workflowHelpers.js";
import { runQueueService } from "./runQueueService.js";
import type { SettlementPathway } from "./types.js";
import {
  decidePodStartStatus,
  decidePodStatusAfterPathwaySettlement,
  decidePodStatusAfterTriggerSettlement,
  decideRunTerminalStatus,
  isTerminalPodStatus,
  shouldIgnorePodStatusUpdateForRun,
  shouldMarkRunCancelled,
} from "./runStatusMachine.js";
import type {
  RunContext,
  RunCreatedPayload,
  RunStatusChangedPayload,
  RunPodStatusChangedPayload,
  RunDeletedPayload,
} from "../../types/run.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import {
  provisionRunExecutionResources,
  type ProvisionedRunExecutionResources,
} from "../runtime/runExecutionResources.js";
import { ensureGoalRuntime } from "../goalRuntime.js";
import { runRepoActivitySnapshotService } from "../runRepoActivitySnapshotService.js";
import { memoryMaintainerService } from "../memoryMaintainerService.js";
import { RunActiveStreamRegistry } from "./runActiveStreamRegistry.js";
import {
  buildCompletedRunSnapshotEntries,
  completeRunLifecycle,
} from "./runCompletionLifecycle.js";
import { RunResourceLifecycleService } from "./runResourceLifecycleService.js";
import { collectCyclicPodIds } from "./workflowLoopPolicy.js";
import { runWorkflowSnapshotStore } from "./runWorkflowSnapshotStore.js";

const GOAL_BLOCKED_STOP_WORKFLOW_MESSAGE =
  "Goal 已標記為 blocked，workflow 已停止觸發下游 Pod";

function shouldSettleDownstreamAsUnreachable(
  status: RunPodInstanceStatus,
): boolean {
  return status === "skipped" || status === "error" || status === "blocked";
}

export function isInstanceUnreachable(
  instance: RunPodInstance,
  incomingConns: Connection[],
  allInstances: RunPodInstance[],
  // 可選的 Map 索引，由呼叫方預先建立以避免反覆 find()；
  // 未提供時退回線性搜尋（保持向下相容）
  instanceMap?: Map<string, RunPodInstance>,
): { autoUnreachable: boolean; directUnreachable: boolean } {
  const autoConns = incomingConns.filter((c) =>
    isAutoTriggerable(c.triggerMode) && !c.direct,
  );
  const directConns = incomingConns.filter((c) => c.direct);

  // 使用 Map 直接查找 O(1)，否則退回 find() O(N)
  const findInstance = (podId: string): RunPodInstance | undefined =>
    instanceMap
      ? instanceMap.get(podId)
      : allInstances.find((i) => i.podId === podId);

  const autoUnreachable =
    instance.autoPathwaySettled === "pending" &&
    autoConns.length > 0 &&
    autoConns.some((c) => {
      const src = findInstance(c.sourcePodId);
      return src ? shouldSettleDownstreamAsUnreachable(src.status) : false;
    });

  const directUnreachable =
    instance.directPathwaySettled === "pending" &&
    directConns.length > 0 &&
    directConns.every((c) => {
      const src = findInstance(c.sourcePodId);
      return src ? shouldSettleDownstreamAsUnreachable(src.status) : false;
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
  // 可選的 Map 索引，由呼叫方預先建立以避免反覆 find()；
  // 未提供時退回線性搜尋（保持向下相容）
  instanceMap?: Map<string, RunPodInstance>,
  incomingConnectionsMap?: Map<string, Connection[]>,
  options: { allowRunning?: boolean } = {},
): boolean {
  const canSettle =
    NEVER_TRIGGERED_STATUSES.has(instance.status) ||
    (options.allowRunning === true && instance.status === "running");
  if (!canSettle) return false;

  const incomingConns =
    incomingConnectionsMap?.get(instance.podId) ??
    connections.filter(
      (c) =>
        c.targetPodId === instance.podId && instancePodIds.has(c.sourcePodId),
    );
  const { autoUnreachable, directUnreachable } = isInstanceUnreachable(
    instance,
    incomingConns,
    instances,
    instanceMap,
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

  const newStatus = decidePodStatusAfterPathwaySettlement(instance);
  if (newStatus) {
    runStore.updatePodInstanceStatus(instance.id, newStatus);
    instance.status = newStatus;
  }

  return true;
}

class RunExecutionService {
  private readonly activeStreams = new RunActiveStreamRegistry();

  private readonly resourceLifecycle = new RunResourceLifecycleService();

  private readonly cyclicPodIdsByRun = new Map<string, Set<string>>();

  private canSettleUnreachableInstance(
    runId: string,
    instance: RunPodInstance,
  ): boolean {
    if (NEVER_TRIGGERED_STATUSES.has(instance.status)) return true;

    return (
      instance.status === "running" &&
      !this.activeStreams.hasActiveStream(runId, instance.podId)
    );
  }

  async createRun(
    canvasId: string,
    sourcePodId: string,
    triggerMessage: string,
  ): Promise<RunContext> {
    // snapshot 必須先完整建立，才允許寫入 Run history。
    const workflowSnapshot = runWorkflowSnapshotStore.capture(
      canvasId,
      sourcePodId,
    );
    const workflowRun = runStore.createRun(
      canvasId,
      sourcePodId,
      triggerMessage,
    );
    const runContext: RunContext = {
      runId: workflowRun.id,
      canvasId,
      sourcePodId,
    };
    try {
      runWorkflowSnapshotStore.set(workflowRun.id, workflowSnapshot);
      const chainPodIds = new Set(workflowSnapshot.pods.keys());
      const snapshotConnections = [
        ...workflowSnapshot.connections.values(),
      ] as Connection[];
      this.cyclicPodIdsByRun.set(
        workflowRun.id,
        collectCyclicPodIds(chainPodIds, snapshotConnections),
      );
      // 同一 Run 內相同 repositoryId 的 Pod 共用同一份 repo-level workspace
      const runRepoCache = new Map<
        string,
        { workspacePath: string; runRepoPath: string | null }
      >();
      const instances: ReturnType<typeof runStore.createPodInstance>[] = [];
      const provisioningErrors: Array<{ podId: string; error: string }> = [];
      for (const podId of chainPodIds) {
        const pathways = this.calculatePathways(
          podId,
          sourcePodId,
          chainPodIds,
          snapshotConnections,
        );
        const pod = runWorkflowSnapshotStore.getPod(workflowRun.id, podId);
        if (!pod) {
          throw new Error(`Workflow snapshot 找不到 Pod ${podId}`);
        }

        ensureGoalRuntime(pod, runContext);

        let provisioned: ProvisionedRunExecutionResources;
        try {
          provisioned = await provisionRunExecutionResources({
            pod,
            runId: workflowRun.id,
            runRepoCache,
          });
        } catch (error) {
          const message = "建立 run 隔離資源失敗，請稍後再試";
          logger.error(
            "Run",
            "Error",
            `建立 run 隔離資源失敗（runId=${workflowRun.id}, podId=${podId}）：${error instanceof Error ? error.message : String(error)}`,
          );
          const instance = runStore.createPodInstance(
            workflowRun.id,
            podId,
            pathways.autoPathwaySettled,
            pathways.directPathwaySettled,
          );
          runStore.updatePodInstanceStatus(instance.id, "error", message);
          provisioningErrors.push({ podId, error: message });
          instances.push(
            runStore.getPodInstance(workflowRun.id, podId) ?? instance,
          );
          continue;
        }

        instances.push(
          runStore.createPodInstance(
            workflowRun.id,
            podId,
            pathways.autoPathwaySettled,
            pathways.directPathwaySettled,
            provisioned,
          ),
        );
      }

      const instancesWithNames = instances.map((instance) => {
        const {
          runRepoPath: _runRepoPath,
          workspacePath: _workspacePath,
          sessionId: _sessionId,
          ...instanceData
        } = instance;
        const pod = runWorkflowSnapshotStore.getPod(
          workflowRun.id,
          instance.podId,
        );
        return { ...instanceData, podName: pod?.name ?? instance.podId };
      });
      const sourcePodName =
        instancesWithNames.find((instance) => instance.podId === sourcePodId)
          ?.podName ?? sourcePodId;

      logger.log(
        "Run",
        "Create",
        `建立 Run ${workflowRun.id}，共 ${instances.length} 個 pod instance`,
      );
      socketService.emitToCanvas(canvasId, WebSocketResponseEvents.RUN_CREATED, {
        canvasId,
        run: { ...workflowRun, podInstances: instancesWithNames, sourcePodName },
      } as RunCreatedPayload);

      if (provisioningErrors.length > 0) {
        this.evaluateRunStatus(workflowRun.id, canvasId);
      }
      this.enforceRunLimit(canvasId);
      return runContext;
    } catch (error) {
      this.cyclicPodIdsByRun.delete(workflowRun.id);
      runWorkflowSnapshotStore.delete(workflowRun.id);
      try {
        await this.resourceLifecycle.cleanupRunResources(workflowRun.id);
      } finally {
        runStore.deleteRun(workflowRun.id);
      }
      throw error;
    }
  }

  private calculatePathways(
    podId: string,
    sourcePodId: string,
    chainPodIds: Set<string>,
    connections: Connection[],
  ): { autoPathwaySettled: PathwayState; directPathwaySettled: PathwayState } {
    if (podId === sourcePodId) {
      return {
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      };
    }

    const chainConnections = connections.filter(
      (connection) =>
        connection.targetPodId === podId &&
        chainPodIds.has(connection.sourcePodId),
    );

    if (chainConnections.length === 0) {
      return {
        autoPathwaySettled: "pending",
        directPathwaySettled: "not-applicable",
      };
    }

    const hasAutoTriggerable = chainConnections.some((c) =>
      isAutoTriggerable(c.triggerMode) && !c.direct,
    );
    const hasDirect = chainConnections.some((c) => c.direct);

    return {
      autoPathwaySettled: hasAutoTriggerable ? "pending" : "not-applicable",
      directPathwaySettled: hasDirect ? "pending" : "not-applicable",
    };
  }

  private getOverflowTerminalRunIds(canvasId: string): string[] {
    const count = runStore.countRunsByCanvasId(canvasId);
    if (count <= RUN_HISTORY_RETENTION_COUNT) return [];

    return runStore.getOverflowTerminalRunIds(
      canvasId,
      RUN_HISTORY_RETENTION_COUNT,
      count - RUN_HISTORY_RETENTION_COUNT,
    );
  }

  private enforceRunLimit(canvasId: string): void {
    const overflowRunIds = this.getOverflowTerminalRunIds(canvasId);
    if (overflowRunIds.length === 0) return;

    void this.cleanupOverflowRuns(overflowRunIds);
  }

  private async deleteRunWithRetry(runId: string): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.deleteRun(runId);
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (attempt === 2) {
          logger.error(
            "Run",
            "Delete",
            `清理舊 Run 失敗（runId=${runId}，已重試 2 次）: ${errorMessage}`,
          );
          return;
        }
        logger.warn(
          "Run",
          "Delete",
          `清理舊 Run 失敗，準備重試（runId=${runId}）: ${errorMessage}`,
        );
      }
    }
  }

  private async cleanupOverflowRuns(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      await this.deleteRunWithRetry(runId);
    }
  }

  private cleanupTerminalOverflowRun(
    runId: string,
    lifecyclePromise: Promise<void>,
    shouldCleanup: boolean,
  ): void {
    fireAndForget(
      (async (): Promise<void> => {
        try {
          await lifecyclePromise;
        } catch {
          // lifecycle 錯誤已由既有 fireAndForget 記錄；此處仍要繼續做保留清理
        }

        if (!shouldCleanup) {
          return;
        }

        await this.cleanupOverflowRuns([runId]);
      })(),
      "Run",
      "清理終態 overflow Run 失敗",
    );
  }

  startPodInstance(
    runContext: RunContext,
    podId: string,
    allowSkippedReentry: boolean = false,
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
    const canReenter =
      (allowSkippedReentry && instance.status === "skipped") ||
      (this.isCyclicPod(runContext, podId) && instance.status === "completed");
    const nextStatus = canReenter
      ? "running"
      : decidePodStartStatus(instance.status);
    if (!nextStatus) return;
    this.updateAndEmitPodInstanceStatus(runContext, podId, nextStatus);
  }

  isCyclicPod(runContext: RunContext, podId: string): boolean {
    let cyclicPodIds = this.cyclicPodIdsByRun.get(runContext.runId);
    if (!cyclicPodIds) {
      const instances = runStore.getPodInstancesByRunId(runContext.runId);
      cyclicPodIds = collectCyclicPodIds(
        instances.map((instance) => instance.podId),
        runWorkflowSnapshotStore.listConnections(runContext.runId),
      );
      this.cyclicPodIdsByRun.set(runContext.runId, cyclicPodIds);
    }
    return cyclicPodIds.has(podId);
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
    options: { evaluateRun?: boolean } = {},
  ): void {
    const updated = this.settlePathwayAndRefresh(
      runContext,
      podId,
      pathway,
      "settlePodTrigger",
    );
    if (!updated) return;

    const key = buildRunQueueKey(runContext.runId, podId);
    const nextStatus = decidePodStatusAfterTriggerSettlement(
      updated,
      runQueueService.getQueueSize(key),
    );
    if (!nextStatus) return;

    this.updateAndEmitPodInstanceStatus(runContext, podId, nextStatus, {
      evaluateRun: options.evaluateRun ?? true,
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
    if (!updated) return;

    const nextStatus = decidePodStatusAfterPathwaySettlement(updated);
    if (!nextStatus) return;

    this.updateAndEmitPodInstanceStatus(runContext, podId, nextStatus, {
      evaluateRun: true,
    });
  }

  /**
   * 在 evaluateRunStatus 前呼叫，偵測不可達路徑並直接更新 DB + emit WebSocket。
   * 不呼叫 settleAndSkipPath，避免遞迴觸發 evaluateRunStatus。
   * Auto 路徑：ANY auto-triggerable source skipped/blocked/error → 不可達
   * Direct 路徑：ALL direct sources skipped/blocked/error → 不可達
   *
   * 效能優化：
   * 1. 預先建立 Map<podId, instance> 索引，將 isInstanceUnreachable 內部的 find() O(N) 降為 O(1)。
   * 2. 使用 BFS 佇列取代「每輪掃描全部 instances」的作法：
   *    只把「剛被 settle 的 instance 的直接下游」加入待處理佇列，
   *    避免 O(N²) 的反覆全掃描。
   */
  private settleUnreachablePaths(runId: string, canvasId: string): void {
    const instances = runStore.getPodInstancesByRunId(runId);
    const connections = runWorkflowSnapshotStore.listConnections(runId);
    const instancePodIds = new Set(instances.map((i) => i.podId));

    // 建立 podId → instance 的 Map 索引，查找 O(1)，避免 find() 線性搜尋
    const instanceMap = new Map<string, RunPodInstance>(
      instances.map((i) => [i.podId, i]),
    );

    // 預先建立 targetPodId → incoming connections 的索引，避免每個 instance 重掃全部 connections
    const incomingConnectionsMap = new Map<string, Connection[]>();

    // 預先建立 sourcePodId → downstream targetPodIds 的索引，快速找出某 pod 的下游
    const downstreamMap = new Map<string, string[]>();
    for (const conn of connections) {
      if (!instancePodIds.has(conn.sourcePodId)) continue;

      if (!incomingConnectionsMap.has(conn.targetPodId)) {
        incomingConnectionsMap.set(conn.targetPodId, []);
      }
      incomingConnectionsMap.get(conn.targetPodId)!.push(conn);

      if (!downstreamMap.has(conn.sourcePodId)) {
        downstreamMap.set(conn.sourcePodId, []);
      }
      downstreamMap.get(conn.sourcePodId)!.push(conn.targetPodId);
    }

    // 已執行過的 running instance 只有在整段串流結束後才能結算剩餘路徑，
    // 避免 Goal retry 的 turn 間隙被提前標記為 completed。
    const queue: RunPodInstance[] = instances.filter((instance) =>
      this.canSettleUnreachableInstance(runId, instance),
    );
    let queueHead = 0;
    const inQueue = new Set<string>(queue.map((i) => i.podId));

    while (queueHead < queue.length) {
      const instance = queue[queueHead];
      queueHead += 1;
      if (!instance) {
        continue;
      }
      inQueue.delete(instance.podId);

      const settled = settleInstanceIfUnreachable(
        instance,
        connections,
        instances,
        instancePodIds,
        instanceMap,
        incomingConnectionsMap,
        { allowRunning: instance.status === "running" },
      );
      if (!settled) continue;

      this.emitSettledInstanceStatus(runId, canvasId, instance);

      // 只將剛 settle 的 instance 的直接下游加入佇列，
      // 避免重新掃描全部 instances（O(N) → O(下游數量)）
      const downstreamPodIds = downstreamMap.get(instance.podId) ?? [];
      for (const podId of downstreamPodIds) {
        if (inQueue.has(podId)) continue;
        const downstream = instanceMap.get(podId);
        if (
          downstream &&
          this.canSettleUnreachableInstance(runId, downstream)
        ) {
          queue.push(downstream);
          inQueue.add(podId);
        }
      }
    }
  }

  private emitSettledInstanceStatus(
    runId: string,
    canvasId: string,
    instance: RunPodInstance,
  ): void {
    const isSettled = isAllPathwaysSettled(
      instance.autoPathwaySettled,
      instance.directPathwaySettled,
    );
    const hasSettledStatus =
      instance.status === "skipped" || instance.status === "completed";
    if (!isSettled || !hasSettledStatus) return;

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

  blockedPodInstance(
    runContext: RunContext,
    podId: string,
    blockedReason: string | null,
  ): void {
    const errorMessage = blockedReason
      ? `${GOAL_BLOCKED_STOP_WORKFLOW_MESSAGE}：${blockedReason}`
      : GOAL_BLOCKED_STOP_WORKFLOW_MESSAGE;

    this.updateAndEmitPodInstanceStatus(runContext, podId, "blocked", {
      evaluateRun: true,
      errorMessage,
    });
  }

  summarizingPodInstance(runContext: RunContext, podId: string): void {
    this.updateAndEmitPodInstanceStatus(runContext, podId, "summarizing");
  }

  decidingPodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (instance && isTerminalPodStatus(instance.status)) return;
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
    if (this.shouldIgnoreStatusUpdate(runContext.runId)) return;

    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn(
        "Run",
        "Warn",
        `更新 pod instance 狀態失敗：找不到 instance (runId=${runContext.runId}, podId=${podId})`,
      );
      return;
    }

    this.persistPodInstanceStatus(instance.id, status, options?.errorMessage);

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    if (!updatedInstance) {
      return;
    }

    this.emitPodInstanceStatus(
      runContext,
      podId,
      status,
      updatedInstance,
      options?.errorMessage,
    );

    if (options?.evaluateRun) {
      this.evaluateRunStatus(runContext.runId, runContext.canvasId);
    }
  }

  private shouldIgnoreStatusUpdate(runId: string): boolean {
    if (this.activeStreams.hasRun(runId)) return false;
    return shouldIgnorePodStatusUpdateForRun(runStore.getRun(runId));
  }

  private persistPodInstanceStatus(
    instanceId: string,
    status: RunPodInstanceStatus,
    errorMessage?: string,
  ): void {
    if (errorMessage) {
      runStore.updatePodInstanceStatus(instanceId, status, errorMessage);
      return;
    }
    runStore.updatePodInstanceStatus(instanceId, status);
  }

  private emitPodInstanceStatus(
    runContext: RunContext,
    podId: string,
    status: RunPodInstanceStatus,
    instance: RunPodInstance,
    errorMessage?: string,
  ): void {
    const triggeredAt =
      status === "running"
        ? new Date().toISOString()
        : (instance.triggeredAt ?? undefined);
    const completedAt = isTerminalPodStatus(status)
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
        lastResponseSummary: instance.lastResponseSummary ?? undefined,
        errorMessage: errorMessage ?? instance.errorMessage ?? undefined,
        triggeredAt,
        completedAt,
        autoPathwaySettled: instance.autoPathwaySettled,
        directPathwaySettled: instance.directPathwaySettled,
      } satisfies RunPodStatusChangedPayload,
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
    const existingRun = runStore.getRun(runId);
    if (!existingRun || RUN_TERMINAL_STATUSES.has(existingRun.status)) return;
    if (!runWorkflowSnapshotStore.has(runId)) {
      logger.error(
        "Run",
        "Error",
        `執行中的 Run 缺少 Workflow snapshot（runId=${runId}）`,
      );
      return;
    }
    this.settleUnreachablePaths(runId, canvasId);

    const instances = runStore.getPodInstancesByRunId(runId);
    if (instances.length === 0) return;

    const newStatus = decideRunTerminalStatus(instances);
    if (!newStatus) return;

    const currentRun = runStore.getRun(runId);
    if (
      !currentRun ||
      (currentRun.status === newStatus && RUN_TERMINAL_STATUSES.has(newStatus))
    ) {
      return;
    }

    this.completeTerminalRun(runId, canvasId, currentRun, instances, newStatus);
  }

  private completeTerminalRun(
    runId: string,
    canvasId: string,
    currentRun: NonNullable<ReturnType<typeof runStore.getRun>>,
    instances: RunPodInstance[],
    newStatus: Parameters<typeof runStore.updateRunStatus>[1],
  ): void {

    runStore.updateRunStatus(runId, newStatus);
    const updatedRun = runStore.getRun(runId);
    const shouldCleanupTerminalRun = runStore.isOverflowTerminalRun(
      canvasId,
      runId,
      RUN_HISTORY_RETENTION_COUNT,
    );
    const maintenanceContext: RunContext = {
      runId,
      canvasId,
      sourcePodId: currentRun.sourcePodId,
    };
    const snapshotEntries = buildCompletedRunSnapshotEntries(
      canvasId,
      instances,
      (_entryCanvasId, podId) => runWorkflowSnapshotStore.getPod(runId, podId),
    );
    const definitionPods = [
      ...runWorkflowSnapshotStore.getRequired(runId).pods.values(),
    ];
    // 定義 snapshot 僅屬於 active Run；進入任一終態即同步移除。
    runWorkflowSnapshotStore.delete(runId);

    // Run 自然完成時立即回收所有 run 級隔離資源
    const completionLifecycle = completeRunLifecycle({
      runId,
      maintenanceContext,
      snapshotEntries,
      captureSnapshot: (lifecycleRunId, podId, snapshotPath) =>
        runRepoActivitySnapshotService.captureSnapshot(
          lifecycleRunId,
          podId,
          snapshotPath,
        ),
      scheduleRepositoriesForCompletedRun: (runContext) =>
        memoryMaintainerService.scheduleRepositoriesForCompletedRun(
          runContext,
          definitionPods,
        ),
      cleanupRunResources: (lifecycleRunId) =>
        this.resourceLifecycle.cleanupRunResources(lifecycleRunId),
    });

    fireAndForget(
      completionLifecycle,
      "Run",
      "清理 Run 隔離資源失敗",
    );
    this.cleanupTerminalOverflowRun(
      runId,
      completionLifecycle,
      shouldCleanupTerminalRun,
    );

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

  evaluateRun(runContext: RunContext): void {
    this.evaluateRunStatus(runContext.runId, runContext.canvasId);
  }

  registerActiveStream(runId: string, podId: string): void {
    this.activeStreams.register(runId, podId);
  }

  unregisterActiveStream(runId: string, podId: string): void {
    this.activeStreams.unregister(runId, podId);
  }

  hasActiveStream(runId: string, podId: string): boolean {
    return this.activeStreams.hasActiveStream(runId, podId);
  }

  /**
   * 找出目前所有包含指定 podId 的活躍 runId 列表。
   * 用於刪除 Pod 時中止 Run 模式的查詢。
   */
  getActiveRunIdsForPod(podId: string): string[] {
    return this.activeStreams.getActiveRunIdsForPod(podId);
  }

  /**
   * deleteRun 的 race condition 防護策略
   *
   * 問題：背景 agent stream callback（persistMessage、updateAndEmitPodInstanceStatus 等）
   * 可能在 run row 已被 DELETE 後才執行，導致 FOREIGN KEY constraint failed。
   *
   * 防護流程（順序嚴格）：
   *   1. `activeRunStreams.delete(runId)`：先從活躍串流 Map 移除，
   *      建立 invariant：`!activeRunStreams.has(runId)` ⟹ 「cancellation 已啟動」。
   *      各 guard 點用此 Map 做廉價快速過濾（O(1)），避免每次都打 DB。
   *   2. `runStore.updateRunStatus(runId, "cancelled")`：將 run 標記為終態，
   *      提供 DB 層的二次確認——當 activeRunStreams 不含 runId 時，guard 才 fallback 查 DB。
   *   3. `abortRegistry.abort(...)` loop：中止各 pod 的 stream，
   *      仍使用步驟 1 前取得的 activePodIds snapshot，確保全部 pod 都被中止。
   *   4. `cleanupRunResources` → `runStore.deleteRun`：清理資源、刪除 row。
   *
   * 各 guard 點（deleteRun race guard）：
   *   - executionStrategy.ts `persistMessage`
   *   - runChatHelpers.ts `injectRunUserMessage`
   *   - runExecutionService.ts `updateAndEmitPodInstanceStatus`（hot path，使用雙階段過濾）
   */
  async deleteRun(runId: string): Promise<void> {
    const run = runStore.getRun(runId);
    const canvasId = run?.canvasId ?? "";

    // 步驟 1：先從 activeRunStreams 移除，建立廉價 guard 的 invariant。
    // 必須在 updateRunStatus 之前執行，確保 hot path guard 可用 Map 做 O(1) 過濾。
    const activePodCounts = this.activeStreams.takeRunPodCounts(runId);
    this.cyclicPodIdsByRun.delete(runId);
    runQueueService.clearRun(runId);

    // 步驟 2：標記 DB 終態，供 fallback DB 查詢使用。
    if (shouldMarkRunCancelled(run)) {
      runStore.updateRunStatus(runId, "cancelled");
    }

    // 步驟 3：中止各 pod 串流（使用步驟 1 前取得的 snapshot）。
    if (activePodCounts) {
      for (const podId of activePodCounts.keys()) {
        try {
          // Run mode 的 query key 是 ${runId}:${podId}
          abortRegistry.abort(`${runId}:${podId}`);
        } catch (error) {
          // Claude SDK 內部在 abort 時可能拋出 "Operation aborted" 錯誤，忽略即可
          logger.warn(
            "Run",
            "Delete",
            `中止 Pod ${podId} 時發生非致命錯誤: ${error}`,
          );
        }
      }
    }

    // 步驟 4：清理資源、刪除 row。
    // 防禦性清理：處理 Run 中途被砍、或 evaluateRunStatus 清理失敗的情況
    await this.resourceLifecycle.cleanupRunResources(runId);
    runRepoActivitySnapshotService.clearRun(runId);
    runWorkflowSnapshotStore.delete(runId);

    runStore.deleteRun(runId);

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
