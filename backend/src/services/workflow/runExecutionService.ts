import {
  runStore,
  NEVER_TRIGGERED_STATUSES,
} from "../runStore.js";
import type { RunPodInstance, RunPodInstanceStatus } from "../runStore.js";
import { isAllPathwaysSettled } from "../../utils/pathwayHelpers.js";
import type { PathwayState } from "../../types/run.js";
import { connectionStore } from "../connectionStore.js";
import type { Connection } from "../../types/index.js";
import { podStore } from "../podStore.js";
import { socketService } from "../socketService.js";
import { abortRegistry } from "../provider/abortRegistry.js";
import { logger } from "../../utils/logger.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { isAutoTriggerable, buildRunQueueKey } from "./workflowHelpers.js";
import { runQueueService } from "./runQueueService.js";
import type { SettlementPathway } from "./types.js";
import {
  decidePodStatusAfterSkipSettlement,
  decidePodStatusAfterTriggerSettlement,
  decideRunTerminalStatus,
  isTerminalPodStatus,
} from "./workflowRunDecisions.js";
import type {
  RunContext,
  RunCreatedPayload,
  RunStatusChangedPayload,
  RunPodStatusChangedPayload,
  RunDeletedPayload,
} from "../../types/run.js";
import { fireAndForget } from "../../utils/operationHelpers.js";
import { config } from "../../config/index.js";
import path from "path";
import { promises as fs } from "fs";
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import {
  provisionRunExecutionResources,
  type ProvisionedRunExecutionResources,
} from "../runtime/runExecutionResources.js";
import { ensureGoalRuntime, removeGoalRuntimeRun } from "../goalRuntime.js";
import { cleanupOpencodeRunServers } from "../provider/opencodeProvider.js";

const MAX_RUNS_PER_CANVAS = 30;

export function isInstanceUnreachable(
  instance: RunPodInstance,
  incomingConns: Connection[],
  allInstances: RunPodInstance[],
  // 可選的 Map 索引，由呼叫方預先建立以避免反覆 find()；
  // 未提供時退回線性搜尋（保持向下相容）
  instanceMap?: Map<string, RunPodInstance>,
): { autoUnreachable: boolean; directUnreachable: boolean } {
  const autoConns = incomingConns.filter((c) =>
    isAutoTriggerable(c.triggerMode),
  );
  const directConns = incomingConns.filter((c) => c.triggerMode === "direct");

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
      return src && (src.status === "skipped" || src.status === "error");
    });

  const directUnreachable =
    instance.directPathwaySettled === "pending" &&
    directConns.length > 0 &&
    directConns.every((c) => {
      const src = findInstance(c.sourcePodId);
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
  // 可選的 Map 索引，由呼叫方預先建立以避免反覆 find()；
  // 未提供時退回線性搜尋（保持向下相容）
  instanceMap?: Map<string, RunPodInstance>,
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
    const runContext: RunContext = {
      runId: workflowRun.id,
      canvasId,
      sourcePodId,
    };
    // 同一 Run 內相同 repositoryId 的 Pod 共用同一份 repo-level workspace
    const runRepoCache = new Map<
      string,
      { workspacePath: string; runRepoPath: string | null }
    >();
    const instances: ReturnType<typeof runStore.createPodInstance>[] = [];
    const provisioningErrors: Array<{ podId: string; error: string }> = [];
    for (const podId of chainPodIds) {
      const pathways = this.calculatePathways(
        canvasId,
        podId,
        sourcePodId,
        chainPodIds,
      );

      const pod = podStore.getById(canvasId, podId);
      if (!pod) {
        instances.push(
          runStore.createPodInstance(
            workflowRun.id,
            podId,
            pathways.autoPathwaySettled,
            pathways.directPathwaySettled,
          ),
        );
        logger.warn(
          "Run",
          "Warn",
          `建立 Run 時找不到 pod，略過隔離資源配置（runId=${workflowRun.id}, podId=${podId})`,
        );
        continue;
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

      // managed MCP entries 由 provider.buildOptions 在實際 chat 啟動時各自取得，
      // 不再 run pre-provisioning 階段建立 surface（每 pod 子程序 lifecycle 由 provider 管）。

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
        ...instanceData
      } = instance;
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

    if (provisioningErrors.length > 0) {
      this.evaluateRunStatus(workflowRun.id, canvasId);
    }

    this.enforceRunLimit(canvasId);

    return runContext;
  }

  private collectChainPodIds(canvasId: string, sourcePodId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [sourcePodId];
    let queueHead = 0;
    visited.add(sourcePodId);

    while (queueHead < queue.length) {
      const currentId = queue[queueHead];
      queueHead += 1;
      if (!currentId) continue;

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
    if (oldestIds.length === 0) return;

    void this.cleanupOverflowRuns(oldestIds);
  }

  private async cleanupOverflowRuns(runIds: string[]): Promise<void> {
    for (const runId of runIds) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await this.deleteRun(runId);
          break;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (attempt === 2) {
            logger.error(
              "Run",
              "Delete",
              `清理舊 Run 失敗（runId=${runId}，已重試 2 次）: ${errorMessage}`,
            );
            break;
          }
          logger.warn(
            "Run",
            "Delete",
            `清理舊 Run 失敗，準備重試（runId=${runId}）: ${errorMessage}`,
          );
        }
      }
    }
  }

  startPodInstance(runContext: RunContext, podId: string): void {
    const instance = runStore.getPodInstance(runContext.runId, podId);
    if (!instance) {
      logger.warn(
        "Run",
        "Warn",
        `更新 pod instance 狀態失敗：找不到 instance (runId=${runContext.runId}, podId=${podId})`,
      );
      return;
    }
    if (isTerminalPodStatus(instance.status)) {
      return;
    }
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

    const key = buildRunQueueKey(runContext.runId, podId);
    const nextStatus = decidePodStatusAfterTriggerSettlement(
      updated,
      runQueueService.getQueueSize(key),
    );
    if (!nextStatus) return;

    this.updateAndEmitPodInstanceStatus(runContext, podId, nextStatus, {
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
    if (!updated) return;

    const nextStatus = decidePodStatusAfterSkipSettlement(updated);
    if (!nextStatus) return;

    this.updateAndEmitPodInstanceStatus(runContext, podId, nextStatus, {
      evaluateRun: true,
    });
  }

  /**
   * 在 evaluateRunStatus 前呼叫，偵測不可達路徑並直接更新 DB + emit WebSocket。
   * 不呼叫 settleAndSkipPath，避免遞迴觸發 evaluateRunStatus。
   * Auto 路徑：ANY auto-triggerable source skipped/error → 不可達
   * Direct 路徑：ALL direct sources skipped/error → 不可達
   *
   * 效能優化：
   * 1. 預先建立 Map<podId, instance> 索引，將 isInstanceUnreachable 內部的 find() O(N) 降為 O(1)。
   * 2. 使用 BFS 佇列取代「每輪掃描全部 instances」的作法：
   *    只把「剛被 settle 的 instance 的直接下游」加入待處理佇列，
   *    避免 O(N²) 的反覆全掃描。
   */
  private settleUnreachablePaths(runId: string, canvasId: string): void {
    const instances = runStore.getPodInstancesByRunId(runId);
    const connections = connectionStore.list(canvasId);
    const instancePodIds = new Set(instances.map((i) => i.podId));

    // 建立 podId → instance 的 Map 索引，查找 O(1)，避免 find() 線性搜尋
    const instanceMap = new Map<string, RunPodInstance>(
      instances.map((i) => [i.podId, i]),
    );

    // 預先建立 targetPodId → Connection[] 的索引，快速找出某 pod 的下游
    const downstreamMap = new Map<string, string[]>();
    for (const conn of connections) {
      if (!instancePodIds.has(conn.sourcePodId)) continue;
      if (!downstreamMap.has(conn.sourcePodId)) {
        downstreamMap.set(conn.sourcePodId, []);
      }
      downstreamMap.get(conn.sourcePodId)!.push(conn.targetPodId);
    }

    // 初始佇列：所有尚未進入終態的 instance（首輪需全部掃描一次）
    const queue: RunPodInstance[] = instances.filter((i) =>
      NEVER_TRIGGERED_STATUSES.has(i.status),
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
      );
      if (!settled) continue;

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

      // 只將剛 settle 的 instance 的直接下游加入佇列，
      // 避免重新掃描全部 instances（O(N) → O(下游數量)）
      const downstreamPodIds = downstreamMap.get(instance.podId) ?? [];
      for (const podId of downstreamPodIds) {
        if (inQueue.has(podId)) continue;
        const downstream = instanceMap.get(podId);
        if (downstream && NEVER_TRIGGERED_STATUSES.has(downstream.status)) {
          queue.push(downstream);
          inQueue.add(podId);
        }
      }
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
    // deleteRun race guard — see runExecutionService.deleteRun
    // 兩階段過濾：先用 activeRunStreams 做 O(1) 廉價判斷，
    // 只有 activeRunStreams 已不含此 runId（cancellation 已啟動）時，才 fallback 查 DB 確認。
    if (!this.activeRunStreams.has(runContext.runId)) {
      const run = runStore.getRun(runContext.runId);
      if (!run || run.status === "cancelled") {
        return;
      }
    }

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

    const updatedInstance = runStore.getPodInstance(runContext.runId, podId);
    if (!updatedInstance) {
      return;
    }

    // running 時記錄啟動時間；其他狀態保留原有的 triggeredAt（與 SQL CASE WHEN 邏輯一致）
    const triggeredAt =
      status === "running"
        ? new Date().toISOString()
        : (updatedInstance.triggeredAt ?? undefined);
    const isTerminal = isTerminalPodStatus(status);
    const completedAt = isTerminal
      ? new Date().toISOString()
      : (updatedInstance.completedAt ?? undefined);

    socketService.emitToCanvas(
      runContext.canvasId,
      WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
      {
        runId: runContext.runId,
        canvasId: runContext.canvasId,
        podId,
        status,
        lastResponseSummary: updatedInstance.lastResponseSummary ?? undefined,
        errorMessage:
          options?.errorMessage ?? updatedInstance.errorMessage ?? undefined,
        triggeredAt,
        completedAt,
        autoPathwaySettled: updatedInstance.autoPathwaySettled,
        directPathwaySettled: updatedInstance.directPathwaySettled,
      } satisfies RunPodStatusChangedPayload,
    );

    if (options?.evaluateRun) {
      this.evaluateRunStatus(runContext.runId, runContext.canvasId);
    }
  }

  private async removeRunDirectory(
    dirPath: string,
    label: string,
  ): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        "Run",
        "Warn",
        `移除 ${label} 失敗（已忽略），path=${dirPath}: ${String(error)}`,
      );
    }
  }

  /**
   * 將 runDir 安全地從檔案系統刪除：先檢查路徑邊界，通過再委派給 removeRunDirectory。
   */
  private async removeRunRepoDirectory(dirPath: string): Promise<void> {
    if (
      !isPathWithinDirectory(
        path.resolve(dirPath),
        path.resolve(config.repositoriesRoot),
      )
    ) {
      logger.warn(
        "Run",
        "Warn",
        `清理 run repo 失敗：路徑越界（path=${dirPath}）`,
      );
      return;
    }
    await this.removeRunDirectory(dirPath, "run repo");
  }

  /**
   * 清理指定 Run 的所有隔離資源。
   * 包含 per-Run MCP surface、repo clone、run sandbox home 與 Goal Runtime tmp 目錄。
   */
  private async cleanupRunResources(runId: string): Promise<void> {
    // managed MCP 子程序由各 provider 子程序 lifecycle 管，不需要 run 層級 cleanup。
    // 關閉本 Run 期間 opencode provider 建立的 transient server 快取；
    // 否則 transient server 會殘留到後端重啟。
    cleanupOpencodeRunServers(runId);
    removeGoalRuntimeRun(runId);

    const entries = runStore.getExecutionPathsByRunId(runId);
    if (entries.length === 0) return;

    const uniqueRunRepos = new Set<string>();

    for (const entry of entries) {
      if (entry.runRepoPath) {
        uniqueRunRepos.add(entry.runRepoPath);
      }
    }

    await Promise.all(
      [...uniqueRunRepos].map((runRepoPath) =>
        this.removeRunRepoDirectory(runRepoPath),
      ),
    );

    runStore.clearExecutionPathsByRunId(runId);
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

    const newStatus = decideRunTerminalStatus(instances);
    if (!newStatus) return;

    runStore.updateRunStatus(runId, newStatus);
    const updatedRun = runStore.getRun(runId);

    // Run 自然完成時立即回收所有 run 級隔離資源
    fireAndForget(
      this.cleanupRunResources(runId),
      "Run",
      "清理 Run 隔離資源失敗",
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

  hasActiveStream(runId: string, podId: string): boolean {
    const streams = this.activeRunStreams.get(runId);
    return streams !== undefined && streams.has(podId);
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
    const activePodIds = this.activeRunStreams.get(runId);
    if (activePodIds) {
      this.activeRunStreams.delete(runId);
    }

    // 步驟 2：標記 DB 終態，供 fallback DB 查詢使用。
    if (run) {
      runStore.updateRunStatus(runId, "cancelled");
    }

    // 步驟 3：中止各 pod 串流（使用步驟 1 前取得的 snapshot）。
    if (activePodIds) {
      for (const podId of activePodIds) {
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
    await this.cleanupRunResources(runId);

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
