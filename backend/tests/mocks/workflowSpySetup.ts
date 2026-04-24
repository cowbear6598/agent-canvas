import { vi } from "vitest";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { workflowEventEmitter } from "../../src/services/workflow/workflowEventEmitter.js";
import { directTriggerStore } from "../../src/services/directTriggerStore.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { summaryService } from "../../src/services/summaryService.js";
import { logger } from "../../src/utils/logger.js";
import { socketService } from "../../src/services/socketService.js";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { commandService } from "../../src/services/commandService.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import type {
  Connection,
  PersistedMessage,
  Pod,
} from "../../src/types/index.js";
import type {
  WorkflowRun,
  RunPodInstance,
} from "../../src/services/runStore.js";

interface SetupAllSpiesOptions {
  podLookup?: Map<string, Pod>;
  messages?: PersistedMessage[];
  summary?: { targetPodId: string; success: boolean; summary: string };
  // 自訂 podStore.getById 實作（用於動態查詢）
  customPodGetter?: (canvasId: string, podId: string) => Pod | undefined;
  // 自訂 connectionStore.getById 返回值
  connection?: Connection;
  // 自訂 workflowStateService.getDirectConnectionCount 返回值
  directConnectionCount?: number;
  // 自訂 claudeService.executeDisposableChat 實作（保留供舊測試相容，實際已不走此路徑）
  customClaudeQuery?: (...args: any[]) => Promise<any>;
}

export function setupConnectionStoreSpy(connection?: Connection) {
  return {
    findBySourcePodId: vi
      .spyOn(connectionStore, "findBySourcePodId")
      .mockReturnValue([]),
    getById: vi.spyOn(connectionStore, "getById").mockReturnValue(connection),
    updateDecideStatus: vi
      .spyOn(connectionStore, "updateDecideStatus")
      .mockReturnValue(undefined),
    updateConnectionStatus: vi
      .spyOn(connectionStore, "updateConnectionStatus")
      .mockReturnValue(undefined),
    findByTargetPodId: vi
      .spyOn(connectionStore, "findByTargetPodId")
      .mockReturnValue([]),
    list: vi.spyOn(connectionStore, "list").mockReturnValue([]),
  };
}

export function setupPodStoreSpy(
  podLookup?: Map<string, Pod>,
  customPodGetter?: (canvasId: string, podId: string) => Pod | undefined,
) {
  const spies = {
    getById: vi
      .spyOn(podStore, "getById")
      .mockImplementation((canvasId: string, podId: string) => {
        if (customPodGetter) {
          return customPodGetter(canvasId, podId);
        }
        if (podLookup) {
          return podLookup.get(podId);
        }
        return undefined;
      }),
    /**
     * Phase 4 新增：executor 的 Claude 路徑呼叫 getByIdGlobal 取得 pod 資訊。
     * 使用與 getById 相同的 getter 邏輯，從第一個 canvasId 查詢 Pod。
     */
    getByIdGlobal: vi
      .spyOn(podStore, "getByIdGlobal")
      .mockImplementation((podId: string) => {
        let pod: Pod | undefined;
        if (customPodGetter) {
          // 嘗試以 'canvas-1' 作為 canvasId 查詢（工作流程測試固定使用此 canvasId）
          pod = customPodGetter("canvas-1", podId);
        } else if (podLookup) {
          pod = podLookup.get(podId);
        }
        if (!pod) return undefined;
        return { canvasId: pod.canvasId ?? "canvas-1", pod };
      }),
    setStatus: vi.spyOn(podStore, "setStatus").mockImplementation(() => {}),
    update: vi.spyOn(podStore, "update").mockReturnValue(undefined),
    setSessionId: vi
      .spyOn(podStore, "setSessionId")
      .mockImplementation(() => {}),
  };
  return spies;
}

export function setupMessageStoreSpy(messages?: PersistedMessage[]) {
  const spies = {
    getMessages: vi
      .spyOn(messageStore, "getMessages")
      .mockReturnValue(messages || []),
    upsertMessage: vi
      .spyOn(messageStore, "upsertMessage")
      .mockImplementation(() => {}),
    clearMessages: vi
      .spyOn(messageStore, "clearMessages")
      .mockImplementation(() => {}),
  };
  return spies;
}

export function setupWorkflowEventEmitterSpy() {
  const spies = {
    emitWorkflowComplete: vi
      .spyOn(workflowEventEmitter, "emitWorkflowComplete")
      .mockImplementation(() => {}),
    emitWorkflowAutoTriggered: vi
      .spyOn(workflowEventEmitter, "emitWorkflowAutoTriggered")
      .mockImplementation(() => {}),
    emitWorkflowPending: vi
      .spyOn(workflowEventEmitter, "emitWorkflowPending")
      .mockImplementation(() => {}),
    emitWorkflowSourcesMerged: vi
      .spyOn(workflowEventEmitter, "emitWorkflowSourcesMerged")
      .mockImplementation(() => {}),
    emitAiDecidePending: vi
      .spyOn(workflowEventEmitter, "emitAiDecidePending")
      .mockImplementation(() => {}),
    emitAiDecideResult: vi
      .spyOn(workflowEventEmitter, "emitAiDecideResult")
      .mockImplementation(() => {}),
    emitAiDecideError: vi
      .spyOn(workflowEventEmitter, "emitAiDecideError")
      .mockImplementation(() => {}),
    emitAiDecideClear: vi
      .spyOn(workflowEventEmitter, "emitAiDecideClear")
      .mockImplementation(() => {}),
    emitDirectTriggered: vi
      .spyOn(workflowEventEmitter, "emitDirectTriggered")
      .mockImplementation(() => {}),
    emitDirectWaiting: vi
      .spyOn(workflowEventEmitter, "emitDirectWaiting")
      .mockImplementation(() => {}),
    emitWorkflowQueued: vi
      .spyOn(workflowEventEmitter, "emitWorkflowQueued")
      .mockImplementation(() => {}),
    emitWorkflowQueueProcessed: vi
      .spyOn(workflowEventEmitter, "emitWorkflowQueueProcessed")
      .mockImplementation(() => {}),
    emitDirectCountdown: vi
      .spyOn(workflowEventEmitter, "emitDirectCountdown")
      .mockImplementation(() => {}),
    emitDirectMerged: vi
      .spyOn(workflowEventEmitter, "emitDirectMerged")
      .mockImplementation(() => {}),
  };
  return spies;
}

export function setupDirectTriggerStoreSpy() {
  const spies = {
    hasDirectPending: vi
      .spyOn(directTriggerStore, "hasDirectPending")
      .mockReturnValue(false),
    initializeDirectPending: vi
      .spyOn(directTriggerStore, "initializeDirectPending")
      .mockImplementation(() => {}),
    recordDirectReady: vi
      .spyOn(directTriggerStore, "recordDirectReady")
      .mockReturnValue(0),
    clearDirectPending: vi
      .spyOn(directTriggerStore, "clearDirectPending")
      .mockImplementation(() => {}),
    hasActiveTimer: vi
      .spyOn(directTriggerStore, "hasActiveTimer")
      .mockReturnValue(false),
    clearTimer: vi
      .spyOn(directTriggerStore, "clearTimer")
      .mockImplementation(() => {}),
    setTimer: vi
      .spyOn(directTriggerStore, "setTimer")
      .mockImplementation(() => {}),
    getReadySummaries: vi
      .spyOn(directTriggerStore, "getReadySummaries")
      .mockReturnValue(null),
  };
  return spies;
}

export function setupPendingTargetStoreSpy() {
  const spies = {
    hasPendingTarget: vi
      .spyOn(pendingTargetStore, "hasPendingTarget")
      .mockReturnValue(false),
    getPendingTarget: vi
      .spyOn(pendingTargetStore, "getPendingTarget")
      .mockReturnValue(undefined),
    clearPendingTarget: vi
      .spyOn(pendingTargetStore, "clearPendingTarget")
      .mockImplementation(() => {}),
    initializePendingTarget: vi
      .spyOn(pendingTargetStore, "initializePendingTarget")
      .mockImplementation(() => {}),
    recordSourceCompletion: vi
      .spyOn(pendingTargetStore, "recordSourceCompletion")
      .mockReturnValue({
        allSourcesResponded: false,
        hasRejection: false,
      }),
    recordSourceRejection: vi
      .spyOn(pendingTargetStore, "recordSourceRejection")
      .mockImplementation(() => {}),
    getCompletedSummaries: vi
      .spyOn(pendingTargetStore, "getCompletedSummaries")
      .mockReturnValue(undefined),
  };
  return spies;
}

export function setupSummaryServiceSpy(summary?: {
  targetPodId: string;
  success: boolean;
  summary: string;
}) {
  const spies = {
    generateSummaryForTarget: vi
      .spyOn(summaryService, "generateSummaryForTarget")
      .mockResolvedValue(
        summary || {
          targetPodId: "target-pod",
          success: true,
          summary: "Test summary",
        },
      ),
  };
  return spies;
}

export function setupLoggerSpy() {
  const spies = {
    log: vi.spyOn(logger, "log").mockImplementation(() => {}),
    error: vi.spyOn(logger, "error").mockImplementation(() => {}),
  };
  return spies;
}

export function setupSocketServiceSpy() {
  const spies = {
    emitToCanvas: vi
      .spyOn(socketService, "emitToCanvas")
      .mockImplementation(() => {}),
  };
  return spies;
}

export function setupWorkflowStateServiceSpy(directConnectionCount?: number) {
  const spies = {
    checkMultiInputScenario: vi
      .spyOn(workflowStateService, "checkMultiInputScenario")
      .mockReturnValue({
        isMultiInput: false,
        requiredSourcePodIds: [],
      }),
    getDirectConnectionCount: vi
      .spyOn(workflowStateService, "getDirectConnectionCount")
      .mockReturnValue(directConnectionCount ?? 0),
  };
  return spies;
}

export function setupCommandServiceSpy() {
  const spies = {
    list: vi.spyOn(commandService, "list").mockResolvedValue([]),
  };
  return spies;
}

export function setupClaudeServiceSpy(
  _customClaudeQuery?: (...args: any[]) => Promise<any>,
) {
  // Phase 5B：sendMessage 已刪除，executor 走 claudeProvider.chat 路徑。
  // 這裡保留 executeDisposableChat / executeMcpChat 的 spy 供需要的測試使用。
  const spies = {
    executeDisposableChat: vi
      .spyOn(claudeService, "executeDisposableChat")
      .mockResolvedValue({ content: "Response text", success: true }),
    executeMcpChat: vi
      .spyOn(claudeService, "executeMcpChat")
      .mockReturnValue((async function* () {})() as any),
  };
  return spies;
}

export function setupRunStoreSpy() {
  const spies = {
    createRun: vi.spyOn(runStore, "createRun").mockImplementation(
      (
        canvasId: string,
        sourcePodId: string,
        triggerMessage: string,
      ): WorkflowRun => ({
        id: "test-run-id",
        canvasId,
        sourcePodId,
        triggerMessage,
        status: "running",
        createdAt: new Date().toISOString(),
        completedAt: null,
      }),
    ),
    getRun: vi.spyOn(runStore, "getRun").mockReturnValue(undefined),
    getRunsByCanvasId: vi
      .spyOn(runStore, "getRunsByCanvasId")
      .mockReturnValue([]),
    updateRunStatus: vi
      .spyOn(runStore, "updateRunStatus")
      .mockImplementation(() => {}),
    deleteRun: vi.spyOn(runStore, "deleteRun").mockImplementation(() => {}),
    countRunsByCanvasId: vi
      .spyOn(runStore, "countRunsByCanvasId")
      .mockReturnValue(0),
    getOldestCompletedRunIds: vi
      .spyOn(runStore, "getOldestCompletedRunIds")
      .mockReturnValue([]),
    createPodInstance: vi
      .spyOn(runStore, "createPodInstance")
      .mockImplementation(
        (runId: string, podId: string): RunPodInstance => ({
          id: "test-instance-id",
          runId,
          podId,
          status: "pending",
          sessionId: null,
          errorMessage: null,
          triggeredAt: null,
          completedAt: null,
          autoPathwaySettled: "not-applicable",
          directPathwaySettled: "not-applicable",
        }),
      ),
    getPodInstance: vi
      .spyOn(runStore, "getPodInstance")
      .mockReturnValue(undefined),
    getPodInstancesByRunId: vi
      .spyOn(runStore, "getPodInstancesByRunId")
      .mockReturnValue([]),
    updatePodInstanceStatus: vi
      .spyOn(runStore, "updatePodInstanceStatus")
      .mockImplementation(() => {}),
    updatePodInstanceSessionId: vi
      .spyOn(runStore, "updatePodInstanceSessionId")
      .mockImplementation(() => {}),
    settleAutoPathway: vi
      .spyOn(runStore, "settleAutoPathway")
      .mockImplementation(() => {}),
    settleDirectPathway: vi
      .spyOn(runStore, "settleDirectPathway")
      .mockImplementation(() => {}),
    getRunningPodInstances: vi
      .spyOn(runStore, "getRunningPodInstances")
      .mockReturnValue([]),
    addRunMessage: vi
      .spyOn(runStore, "addRunMessage")
      .mockImplementation(() => ({
        id: "test-msg-id",
        role: "user" as const,
        content: "",
        timestamp: new Date().toISOString(),
      })),
    upsertRunMessage: vi
      .spyOn(runStore, "upsertRunMessage")
      .mockImplementation(() => {}),
    getRunMessages: vi.spyOn(runStore, "getRunMessages").mockReturnValue([]),
  };
  return spies;
}

export function setupRunExecutionServiceSpy() {
  const spies = {
    createRun: vi.spyOn(runExecutionService, "createRun").mockResolvedValue({
      runId: "test-run-id",
      canvasId: "canvas-1",
      sourcePodId: "source-pod",
    }),
    startPodInstance: vi
      .spyOn(runExecutionService, "startPodInstance")
      .mockImplementation(() => {}),
    settlePodTrigger: vi
      .spyOn(runExecutionService, "settlePodTrigger")
      .mockImplementation(() => {}),
    settleAndSkipPath: vi
      .spyOn(runExecutionService, "settleAndSkipPath")
      .mockImplementation(() => {}),
    errorPodInstance: vi
      .spyOn(runExecutionService, "errorPodInstance")
      .mockImplementation(() => {}),
    summarizingPodInstance: vi
      .spyOn(runExecutionService, "summarizingPodInstance")
      .mockImplementation(() => {}),
    decidingPodInstance: vi
      .spyOn(runExecutionService, "decidingPodInstance")
      .mockImplementation(() => {}),
    queuedPodInstance: vi
      .spyOn(runExecutionService, "queuedPodInstance")
      .mockImplementation(() => {}),
    waitingPodInstance: vi
      .spyOn(runExecutionService, "waitingPodInstance")
      .mockImplementation(() => {}),
    registerActiveStream: vi
      .spyOn(runExecutionService, "registerActiveStream")
      .mockImplementation(() => {}),
    unregisterActiveStream: vi
      .spyOn(runExecutionService, "unregisterActiveStream")
      .mockImplementation(() => {}),
    deleteRun: vi
      .spyOn(runExecutionService, "deleteRun")
      .mockImplementation(() => {}),
  };
  return spies;
}

export function setupRunQueueServiceSpy() {
  const spies = {
    enqueue: vi.spyOn(runQueueService, "enqueue").mockImplementation(() => {}),
    dequeue: vi.spyOn(runQueueService, "dequeue").mockReturnValue(undefined),
    getQueueSize: vi.spyOn(runQueueService, "getQueueSize").mockReturnValue(0),
    processNext: vi
      .spyOn(runQueueService, "processNext")
      .mockResolvedValue(undefined),
  };
  return spies;
}

export function setupAllSpies(options?: SetupAllSpiesOptions) {
  return {
    connectionStore: setupConnectionStoreSpy(options?.connection),
    podStore: setupPodStoreSpy(options?.podLookup, options?.customPodGetter),
    messageStore: setupMessageStoreSpy(options?.messages),
    workflowEventEmitter: setupWorkflowEventEmitterSpy(),
    directTriggerStore: setupDirectTriggerStoreSpy(),
    pendingTargetStore: setupPendingTargetStoreSpy(),
    summaryService: setupSummaryServiceSpy(options?.summary),
    logger: setupLoggerSpy(),
    socketService: setupSocketServiceSpy(),
    workflowStateService: setupWorkflowStateServiceSpy(
      options?.directConnectionCount,
    ),
    commandService: setupCommandServiceSpy(),
    claudeService: setupClaudeServiceSpy(options?.customClaudeQuery),
    runStore: setupRunStoreSpy(),
    runExecutionService: setupRunExecutionServiceSpy(),
    runQueueService: setupRunQueueServiceSpy(),
  };
}
