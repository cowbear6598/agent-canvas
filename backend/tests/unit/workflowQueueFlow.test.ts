// Phase 4：executor 的 Claude 路徑已改走 claudeProvider.chat(ctx)，
// 需要 mock provider 模組避免呼叫真實 SDK。
vi.mock("../../src/services/provider/index.js", () => ({
  getProvider: vi.fn(() => ({
    chat: vi.fn(async function* () {
      // 預設產出 turn_complete 讓串流正常結束
      yield { type: "turn_complete" };
    }),
    cancel: vi.fn(() => false),
    buildOptions: vi.fn().mockResolvedValue({}),
  })),
}));

// Phase 4：abortRegistry mock 避免 Map 操作與清理副作用
vi.mock("../../src/services/provider/abortRegistry.js", () => ({
  abortRegistry: {
    register: vi.fn(() => ({
      signal: { aborted: false, addEventListener: vi.fn() },
    })),
    abort: vi.fn(() => false),
    unregister: vi.fn(() => {}),
    abortAll: vi.fn(() => 0),
    has: vi.fn(() => false),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { workflowExecutionService } from "../../src/services/workflow";
import { workflowQueueService } from "../../src/services/workflow";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { workflowEventEmitter } from "../../src/services/workflow/workflowEventEmitter.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { logger } from "../../src/utils/logger.js";
import { socketService } from "../../src/services/socketService.js";
import { workflowStateService } from "../../src/services/workflow/workflowStateService.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runQueueService } from "../../src/services/workflow/runQueueService.js";
import { getProvider } from "../../src/services/provider/index.js";
import type { Connection } from "../../src/types";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";
import type { PersistedMessage, Pod } from "../../src/types/index.js";
import path from "path";
import { config } from "../../src/config/index.js";

// ─── 常數 ────────────────��─────────────────────────���─────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";

// ─── 工廠函式 ────────────────────────────���────────────────────────────────────

function makePod(overrides?: Partial<Pod>): Pod {
  return {
    id: "test-pod",
    name: "Test Pod",
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, "test-canvas", "pod-test"),
    commandId: null,
    status: "idle" as const,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
    ...overrides,
  } as Pod;
}

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    label: "Checklist",
    description: undefined,
    branchProvider: "claude",
    branchModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makeMessages(): PersistedMessage[] {
  return [
    {
      id: "msg-1",
      role: "user" as const,
      content: "Test user message",
      timestamp: new Date().toISOString(),
    },
    {
      id: "msg-2",
      role: "assistant" as const,
      content: "Test assistant response",
      timestamp: new Date().toISOString(),
    },
  ] as PersistedMessage[];
}

function makeStrategy(
  mode: "auto" | "direct" | "branch",
  overrides?: Partial<TriggerStrategy>,
): TriggerStrategy {
  return {
    mode,
    decide: vi.fn().mockResolvedValue([]),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
    ...overrides,
  } as unknown as TriggerStrategy;
}

function clearAllQueues(targetPodIds: string[]): void {
  targetPodIds.forEach((podId) => {
    while (workflowQueueService.getQueueSize(podId) > 0)
      workflowQueueService.dequeue(podId);
  });
}

// ─── 共用 spy 設置 ─────────────────────────────────────��─────────────────��────

function setupCommonSpies(
  messages: PersistedMessage[],
  customPodGetter: (cId: string, podId: string) => Pod | undefined,
) {
  vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "getById").mockReturnValue(undefined);
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([]);
  vi.spyOn(connectionStore, "list").mockReturnValue([]);

  vi.spyOn(podStore, "getById").mockImplementation(
    (cId: string, podId: string) => customPodGetter(cId, podId),
  );
  vi.spyOn(podStore, "getByIdGlobal").mockImplementation((podId: string) => {
    const pod = customPodGetter(CANVAS_ID, podId);
    if (!pod) return undefined;
    return { canvasId: CANVAS_ID, pod };
  });
  vi.spyOn(podStore, "setStatus").mockImplementation(() => {});
  vi.spyOn(podStore, "update").mockReturnValue(undefined);
  vi.spyOn(podStore, "setSessionId").mockImplementation(() => {});

  vi.spyOn(messageStore, "getMessages").mockReturnValue(messages);
  vi.spyOn(messageStore, "upsertMessage").mockImplementation(() => {});
  vi.spyOn(messageStore, "clearMessages").mockImplementation(() => {});

  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowAutoTriggered",
  ).mockImplementation(() => {});
  vi.spyOn(workflowEventEmitter, "emitWorkflowPending").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowSourcesMerged",
  ).mockImplementation(() => {});
  vi.spyOn(workflowEventEmitter, "emitDirectTriggered").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectWaiting").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowQueueProcessed",
  ).mockImplementation(() => {});
  vi.spyOn(workflowEventEmitter, "emitDirectCountdown").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectMerged").mockImplementation(
    () => {},
  );

  vi.spyOn(pendingTargetStore, "hasPendingTarget").mockReturnValue(false);
  vi.spyOn(pendingTargetStore, "getPendingTarget").mockReturnValue(undefined);
  vi.spyOn(pendingTargetStore, "clearPendingTarget").mockImplementation(
    () => {},
  );
  vi.spyOn(pendingTargetStore, "initializePendingTarget").mockImplementation(
    () => {},
  );
  vi.spyOn(pendingTargetStore, "recordSourceCompletion").mockReturnValue({
    allSourcesResponded: false,
    hasRejection: false,
  });
  vi.spyOn(pendingTargetStore, "recordSourceRejection").mockImplementation(
    () => {},
  );
  vi.spyOn(pendingTargetStore, "getCompletedSummaries").mockReturnValue(
    undefined,
  );

  vi.spyOn(logger, "log").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});

  vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

  vi.spyOn(workflowStateService, "checkMultiInputScenario").mockReturnValue({
    isMultiInput: false,
    requiredSourcePodIds: [],
  });
  vi.spyOn(workflowStateService, "getDirectConnectionCount").mockReturnValue(0);

  vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
  vi.spyOn(runStore, "getPodInstancesByRunId").mockReturnValue([]);
  vi.spyOn(runStore, "updatePodInstanceStatus").mockImplementation(() => {});
  vi.spyOn(runStore, "settleAutoPathway").mockImplementation(() => {});
  vi.spyOn(runStore, "settleDirectPathway").mockImplementation(() => {});

  vi.spyOn(runExecutionService, "startPodInstance").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "settlePodTrigger").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "settleAndSkipPath").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "summarizingPodInstance").mockImplementation(
    () => {},
  );
  vi.spyOn(runExecutionService, "decidingPodInstance").mockImplementation(
    () => {},
  );

  vi.spyOn(runQueueService, "enqueue").mockImplementation(
    () => ({ position: 1, queueSize: 1 }) as any,
  );
  vi.spyOn(runQueueService, "dequeue").mockReturnValue(undefined);
  vi.spyOn(runQueueService, "getQueueSize").mockReturnValue(0);
  vi.spyOn(runQueueService, "processNext").mockResolvedValue(undefined);
}

// ─── テスト ───────────────────────���──────────────────────────────────���───────

describe("WorkflowQueueFlow - Queue 處理、混合場景、錯誤恢復", () => {
  let mockSourcePod: Pod;
  let mockTargetPod: Pod;
  let mockAutoConnection: Connection;
  let mockDirectConnection: Connection;
  let mockMessages: PersistedMessage[];
  let mockAutoStrategy: TriggerStrategy;
  let mockDirectStrategy: TriggerStrategy;
  let mockAiDecideStrategy: TriggerStrategy;

  beforeEach(() => {
    mockSourcePod = makePod({
      id: SOURCE_POD_ID,
      name: "Source Pod",
      status: "idle",
    });
    mockTargetPod = makePod({
      id: TARGET_POD_ID,
      name: "Target Pod",
      status: "idle",
    });
    mockAutoConnection = makeConnection({
      id: "conn-auto-1",
      sourcePodId: SOURCE_POD_ID,
      targetPodId: TARGET_POD_ID,
      triggerMode: "auto",
    });
    mockDirectConnection = makeConnection({
      id: "conn-direct-1",
      sourcePodId: SOURCE_POD_ID,
      targetPodId: "target-pod-3",
      triggerMode: "direct",
    });
    mockMessages = makeMessages();
    mockAutoStrategy = makeStrategy("auto");
    mockDirectStrategy = makeStrategy("direct");
    mockAiDecideStrategy = makeStrategy("branch");

    const customPodGetter = (_cId: string, podId: string): Pod | undefined => {
      if (podId === SOURCE_POD_ID) return { ...mockSourcePod };
      if (podId.startsWith("target-pod"))
        return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
      return undefined;
    };

    setupCommonSpies(mockMessages, customPodGetter);

    workflowQueueService.init({
      executionService: workflowExecutionService,
      strategies: {
        auto: mockAutoStrategy,
        direct: mockDirectStrategy,
        branch: mockAiDecideStrategy,
      },
    });
    clearAllQueues([TARGET_POD_ID, "target-pod-2", "target-pod-3"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("C1: Queue - Workflow 完成後自動 dequeue 下一項", () => {
    it("processNextInQueue 正確 dequeue 並觸發下一個 workflow", async () => {
      const queuedConnection: Connection = {
        id: "conn-queued",
        sourcePodId: "source-pod-2",
        sourceAnchor: "right",
        targetPodId: TARGET_POD_ID,
        targetAnchor: "left",
        triggerMode: "auto",
        decideStatus: "none",
        decideReason: null,
        connectionStatus: "idle",
      };

      expect(workflowQueueService.getQueueSize(TARGET_POD_ID)).toBe(0);

      workflowQueueService.enqueue({
        canvasId: CANVAS_ID,
        connectionId: queuedConnection.id,
        sourcePodId: queuedConnection.sourcePodId,
        targetPodId: TARGET_POD_ID,
        summary: "Queued summary",
        isSummarized: true,
        triggerMode: "auto",
      });

      expect(workflowQueueService.getQueueSize(TARGET_POD_ID)).toBe(1);

      vi.spyOn(connectionStore, "getById").mockReturnValue(queuedConnection);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === TARGET_POD_ID)
          return { ...mockTargetPod, status: "idle" };
        return { ...mockSourcePod, id: podId };
      }) as any);

      await workflowQueueService.processNextInQueue(CANVAS_ID, TARGET_POD_ID);

      expect(workflowQueueService.getQueueSize(TARGET_POD_ID)).toBe(0);

      expect(mockAutoStrategy.onQueueProcessed).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          targetPodId: TARGET_POD_ID,
          connectionId: queuedConnection.id,
          sourcePodId: queuedConnection.sourcePodId,
          remainingQueueSize: 0,
          triggerMode: "auto",
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      // Phase 4：Claude 路徑已改走 claudeProvider.chat(ctx)，驗證 getProvider 被呼叫
      expect(getProvider).toHaveBeenCalled();
    });
  });

  describe("C2: processNextInQueue 是 fire-and-forget，不阻塞呼叫者", () => {
    it("executeClaudeQuery 完成後呼叫 processNextInQueue 不 await，不阻塞", async () => {
      vi.spyOn(connectionStore, "getById").mockReturnValue(mockAutoConnection);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === TARGET_POD_ID)
          return { ...mockTargetPod, status: "idle" };
        if (podId === SOURCE_POD_ID) return mockSourcePod;
        return undefined;
      }) as any);

      let processNextInQueueCalled = false;
      const processNextInQueueSpy = vi
        .spyOn(workflowQueueService, "processNextInQueue")
        .mockImplementation(async () => {
          processNextInQueueCalled = true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        });

      const triggerPromise =
        workflowExecutionService.triggerWorkflowWithSummary({
          canvasId: CANVAS_ID,
          connectionId: mockAutoConnection.id,
          summary: "Test summary",
          isSummarized: true,
          participatingConnectionIds: undefined,
          strategy: mockAutoStrategy,
        });

      // fire-and-forget 不應阻塞呼叫端
      await triggerPromise;

      // 等待 fire-and-forget 完成
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(processNextInQueueCalled).toBe(true);
      expect(processNextInQueueSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        TARGET_POD_ID,
      );
    });
  });

  describe("C3: Queue 中不同 triggerMode 的 strategy 處理", () => {
    it("direct 模式的 item：strategy.onTrigger 被呼叫", async () => {
      const directConn: Connection = {
        ...mockDirectConnection,
        targetPodId: "target-pod-direct",
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(directConn);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === directConn.targetPodId)
          return {
            ...mockTargetPod,
            id: directConn.targetPodId,
            status: "idle",
          };
        return { ...mockSourcePod, id: podId };
      }) as any);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: directConn.id,
        summary: "Direct summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockDirectStrategy,
      });

      expect(mockDirectStrategy.onTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: directConn.id,
          summary: "Direct summary",
          isSummarized: true,
        }),
      );
    });

    it("auto 模式的 item：strategy.onTrigger 被呼叫", async () => {
      const autoConn: Connection = {
        ...mockAutoConnection,
        targetPodId: "target-pod-auto",
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(autoConn);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === autoConn.targetPodId)
          return {
            ...mockTargetPod,
            id: autoConn.targetPodId,
            status: "idle",
          };
        return { ...mockSourcePod, id: podId };
      }) as any);

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: autoConn.id,
        summary: "Auto summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockAutoStrategy,
      });

      expect(mockAutoStrategy.onTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: autoConn.id,
          summary: "Auto summary",
          isSummarized: true,
        }),
      );
    });
  });

  describe("C4: onQueueProcessed 不設定 connection 為 active", () => {
    it("processNextInQueue 呼叫後 onQueueProcessed 被觸發，但 connection 狀態不應直接變為 active", async () => {
      const queuedConnection: Connection = {
        id: "conn-queued-active-check",
        sourcePodId: "source-pod-2",
        sourceAnchor: "right",
        targetPodId: TARGET_POD_ID,
        targetAnchor: "left",
        triggerMode: "auto",
        decideStatus: "none",
        decideReason: null,
        connectionStatus: "queued",
      };

      workflowQueueService.enqueue({
        canvasId: CANVAS_ID,
        connectionId: queuedConnection.id,
        sourcePodId: queuedConnection.sourcePodId,
        targetPodId: TARGET_POD_ID,
        summary: "Active check summary",
        isSummarized: true,
        triggerMode: "auto",
      });

      vi.spyOn(connectionStore, "getById").mockReturnValue(queuedConnection);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        queuedConnection,
      ]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === TARGET_POD_ID)
          return { ...mockTargetPod, status: "idle" };
        return { ...mockSourcePod, id: podId };
      }) as any);

      const updateConnectionStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      await workflowQueueService.processNextInQueue(CANVAS_ID, TARGET_POD_ID);

      expect(mockAutoStrategy.onQueueProcessed).toHaveBeenCalled();

      // onQueueProcessed 被呼叫後，updateConnectionStatus 不應以 active 被呼叫（active 在 triggerWorkflowWithSummary 設定）
      // 此時 triggerWorkflowWithSummary 尚未完成（fire-and-forget），所以 active 還沒被設定
      expect(mockAutoStrategy.onQueueProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: queuedConnection.id }),
      );

      // active 狀態改由 triggerWorkflowWithSummary 設定，等待 async 完成後才會出現
      await new Promise((resolve) => setTimeout(resolve, 50));
      const activeCallsAfterTrigger =
        updateConnectionStatusSpy.mock.calls.filter(
          ([, , status]) => status === "active",
        );
      expect(activeCallsAfterTrigger.length).toBeGreaterThanOrEqual(1);
      expect(activeCallsAfterTrigger[0]).toEqual([
        CANVAS_ID,
        queuedConnection.id,
        "active",
      ]);
    });
  });

  describe("E1: Workflow 執行失敗後 queue 仍繼續處理", () => {
    it("executeClaudeQuery 拋出錯誤，emitWorkflowComplete(success: false)，processNextInQueue 仍被呼叫", async () => {
      const conn: Connection = {
        ...mockAutoConnection,
        id: "conn-fail",
        targetPodId: "target-fail",
      };

      vi.spyOn(connectionStore, "getById").mockReturnValue(conn);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === "target-fail")
          return { ...mockTargetPod, id: "target-fail", status: "idle" };
        if (podId === SOURCE_POD_ID) return mockSourcePod;
        return undefined;
      }) as any);
      // Phase 4：executor 的 Claude 路徑需要 getByIdGlobal 回傳 pod
      vi.spyOn(podStore, "getByIdGlobal").mockImplementation(
        (podId: string) => {
          if (podId === "target-fail") {
            const pod = {
              ...mockTargetPod,
              id: "target-fail",
              status: "idle" as const,
            };
            return { canvasId: CANVAS_ID, pod };
          }
          return undefined;
        },
      );

      workflowQueueService.enqueue({
        canvasId: CANVAS_ID,
        connectionId: "conn-queued-after-fail",
        sourcePodId: "source-pod-2",
        targetPodId: "target-fail",
        summary: "Queued after fail",
        isSummarized: true,
        triggerMode: "auto",
      });

      const testError = new Error("Claude query failed");
      // Phase 4：Claude 路徑已改走 claudeProvider.chat(ctx)，
      // 需要 mock getProvider 讓 chat() 拋出錯誤
      (getProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        chat: vi.fn(async function* () {
          throw testError;
        }),
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
      });

      let processNextInQueueCalled = false;
      const processNextInQueueSpy = vi
        .spyOn(workflowQueueService, "processNextInQueue")
        .mockImplementation(async () => {
          processNextInQueueCalled = true;
        });

      await workflowExecutionService.triggerWorkflowWithSummary({
        canvasId: CANVAS_ID,
        connectionId: conn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockAutoStrategy,
      });

      // 等待 fire-and-forget 的錯誤處理完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // sanitizeErrorForClient 會把非白名單錯誤訊息替換為通用訊息，
      // "Claude query failed" 不在白名單中，故期望收到泛化後的錯誤訊息
      expect(mockAutoStrategy.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: conn.id,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: "target-fail",
          triggerMode: "auto",
        }),
        "工作流程執行失敗",
      );

      expect(processNextInQueueCalled).toBe(true);
      expect(processNextInQueueSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        "target-fail",
      );

      expect(podStore.setStatus).toHaveBeenCalledWith(
        CANVAS_ID,
        "target-fail",
        "idle",
      );
    });
  });
});
