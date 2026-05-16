import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { workflowExecutionService } from "../../src/services/workflow";
import { workflowDirectTriggerService } from "../../src/services/workflow/workflowDirectTriggerService.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { directTriggerStore } from "../../src/services/directTriggerStore.js";
import { workflowStateService } from "../../src/services/workflow";
import { workflowEventEmitter } from "../../src/services/workflow";
import { workflowQueueService } from "../../src/services/workflow";
import { summaryService } from "../../src/services/summaryService.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types";
import path from "path";
import { config } from "../../src/config/index.js";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const TARGET_POD_ID = "target-pod";
const TEST_SUMMARY = "Test summary content";

// ─── 工廠函式 ─────────────────────────────────────────────────────────────────

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "conn-direct-1",
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId: TARGET_POD_ID,
    targetAnchor: "left",
    triggerMode: "direct",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  } as Connection;
}

function makePod(id: string, status: "idle" | "chatting" = "idle") {
  return {
    id,
    name: `Pod ${id}`,
    provider: "claude" as const,
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`),
    status,
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
  };
}

// ─── 共用 spy setup ───────────────────────────────────────────────────────────

function setupBasicSpies(conn: Connection) {
  vi.spyOn(logger, "log").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(summaryService, "generateSummaryForTarget").mockResolvedValue({
    success: true,
    summary: TEST_SUMMARY,
    targetPodId: TARGET_POD_ID,
  });
  vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([conn]);
  vi.spyOn(connectionStore, "getById").mockReturnValue(conn);
  vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([conn]);
  vi.spyOn(connectionStore, "updateConnectionStatus").mockReturnValue(
    undefined,
  );
  vi.spyOn(connectionStore, "updateDecideStatus").mockReturnValue(undefined);
  // directTriggerStore spies（預設行為，各測試可 override）
  vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(false);
  vi.spyOn(directTriggerStore, "initializeDirectPending").mockImplementation(
    () => {},
  );
  vi.spyOn(directTriggerStore, "recordDirectReady").mockReturnValue(0);
  vi.spyOn(directTriggerStore, "clearDirectPending").mockImplementation(
    () => {},
  );
  vi.spyOn(directTriggerStore, "hasActiveTimer").mockReturnValue(false);
  vi.spyOn(directTriggerStore, "clearTimer").mockImplementation(() => {});
  vi.spyOn(directTriggerStore, "setTimer").mockImplementation(() => {});
  vi.spyOn(directTriggerStore, "getReadySummaries").mockReturnValue(null);
  // workflowEventEmitter spies
  vi.spyOn(workflowEventEmitter, "emitDirectTriggered").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectWaiting").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitDirectMerged").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowComplete").mockImplementation(
    () => {},
  );
  vi.spyOn(workflowEventEmitter, "emitWorkflowQueued").mockImplementation(
    () => {},
  );
  vi.spyOn(
    workflowEventEmitter,
    "emitWorkflowAutoTriggered",
  ).mockImplementation(() => {});
}

describe("Direct Trigger Flow", () => {
  const mockDirectConnection = makeConnection();

  beforeEach(() => {
    setupBasicSpies(mockDirectConnection);
  });

  afterEach(() => {
    (workflowDirectTriggerService as any).pendingResolvers.clear();
    vi.restoreAllMocks();
  });

  // ============================================================
  // A：單一 direct 連線 trigger 分支（idle vs busy）
  // ============================================================
  describe("A1: 單一 direct - target idle → 直接執行", () => {
    it("Target Pod 只有 1 條 direct 連線，target 狀態為 idle，應直接執行", async () => {
      vi.spyOn(
        workflowStateService,
        "getDirectConnectionCount",
      ).mockReturnValue(1);
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => {
        if (podId === SOURCE_POD_ID) return makePod(SOURCE_POD_ID);
        if (podId === TARGET_POD_ID) return makePod(TARGET_POD_ID, "idle");
        return undefined;
      }) as any);

      const triggerSpy = vi
        .spyOn(workflowExecutionService, "triggerWorkflowWithSummary")
        .mockResolvedValue(undefined);

      await workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      expect(triggerSpy).toHaveBeenCalled();
      const params = triggerSpy.mock.calls[0][0];
      expect(params.canvasId).toBe(CANVAS_ID);
      expect(params.connectionId).toBe(mockDirectConnection.id);
      expect(params.summary).toBe(TEST_SUMMARY);
      expect(params.isSummarized).toBe(true);
      expect(params.participatingConnectionIds).toEqual([
        mockDirectConnection.id,
      ]);
      expect(params.strategy).toHaveProperty("mode", "direct");
    });
  });

  // ============================================================
  // B：多 direct 連線 collectSources 流程
  // ============================================================
  describe("B1: Multi-direct - 第一個 source 到達 → 初始化等待", () => {
    it("Target Pod 有 2+ 條 direct 連線，第一個 source 完成，應初始化等待並設定 timer", async () => {
      vi.spyOn(
        workflowStateService,
        "getDirectConnectionCount",
      ).mockReturnValue(2);
      vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(false);
      // pipeline.execute 需要 podStore.getById 回傳 target pod
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => {
        return makePod(podId);
      }) as any);

      vi.useFakeTimers();

      // 不 await：會在等待其他 source 時卡住
      workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        SOURCE_POD_ID,
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(directTriggerStore.initializeDirectPending).toHaveBeenCalledWith(
        TARGET_POD_ID,
      );
      expect(directTriggerStore.recordDirectReady).toHaveBeenCalledWith(
        TARGET_POD_ID,
        SOURCE_POD_ID,
        TEST_SUMMARY,
      );
      expect(workflowEventEmitter.emitDirectWaiting).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({
          canvasId: CANVAS_ID,
          connectionId: mockDirectConnection.id,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
        }),
      );
      expect(directTriggerStore.setTimer).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("B2: Multi-direct - 第二個 source 到達 → timer 重設", () => {
    it("Target Pod 有 2+ 條 direct 連線，已有一個 source 在 waiting，應重設 timer", async () => {
      const source2PodId = "source-pod-2";
      const connection2 = makeConnection({
        id: "conn-direct-2",
        sourcePodId: source2PodId,
      });

      // 模擬第一個 resolver 已存在
      (workflowDirectTriggerService as any).pendingResolvers.set(
        TARGET_POD_ID,
        (_result: any) => {},
      );

      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([
        connection2,
      ]);
      vi.spyOn(connectionStore, "getById").mockReturnValue(connection2);
      vi.spyOn(
        workflowStateService,
        "getDirectConnectionCount",
      ).mockReturnValue(2);
      vi.spyOn(directTriggerStore, "hasDirectPending").mockReturnValue(true);
      vi.spyOn(directTriggerStore, "hasActiveTimer").mockReturnValue(true);
      // pipeline.execute 需要 podStore.getById 回傳 target pod，否則 early return
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => {
        return makePod(podId);
      }) as any);

      const setTimeoutSpy = vi
        .spyOn(global, "setTimeout")
        .mockImplementation(() => 123 as any);

      await workflowExecutionService.checkAndTriggerWorkflows(
        CANVAS_ID,
        source2PodId,
      );

      expect(directTriggerStore.recordDirectReady).toHaveBeenCalledWith(
        TARGET_POD_ID,
        source2PodId,
        TEST_SUMMARY,
      );
      expect(directTriggerStore.clearTimer).toHaveBeenCalledWith(TARGET_POD_ID);
      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(directTriggerStore.setTimer).toHaveBeenCalled();
    });
  });

  // ============================================================
  // C：onTimerExpired 結果 - participatingConnectionIds
  // ============================================================
  describe("C1-C2: Timer 到期 - participatingConnectionIds 正確分組", () => {
    it.each([
      {
        label: "單源觸發 → participatingConnectionIds 只含 A→D",
        readySummaries: new Map([[SOURCE_POD_ID, TEST_SUMMARY]]),
        expectedIds: ["conn-A-D"],
        notExpectedIds: ["conn-B-D"],
      },
      {
        label: "雙源觸發 → participatingConnectionIds 含 A→D 和 B→D",
        readySummaries: new Map([
          [SOURCE_POD_ID, TEST_SUMMARY],
          ["source-pod-B", "Summary from B"],
        ]),
        expectedIds: ["conn-A-D", "conn-B-D"],
        notExpectedIds: [],
      },
    ])("$label", ({ readySummaries, expectedIds, notExpectedIds }) => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(directTriggerStore, "getReadySummaries").mockReturnValue(
        readySummaries,
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        connAD,
        connBD,
      ]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => makePod(podId)) as any);

      let resolvedResult: any;
      (workflowDirectTriggerService as any).pendingResolvers.set(
        TARGET_POD_ID,
        (result: any) => {
          resolvedResult = result;
        },
      );

      (workflowDirectTriggerService as any).onTimerExpired(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(resolvedResult.ready).toBe(true);
      for (const id of expectedIds) {
        expect(resolvedResult.participatingConnectionIds).toContain(id);
      }
      for (const id of notExpectedIds) {
        expect(resolvedResult.participatingConnectionIds).not.toContain(id);
      }
    });
  });

  describe("C3: 單一 direct（directCount === 1）→ collectSources 回傳正確結果", () => {
    it("directCount 為 1 時，collectSources 回傳的 participatingConnectionIds 只含當前 connection ID", async () => {
      vi.spyOn(
        workflowStateService,
        "getDirectConnectionCount",
      ).mockReturnValue(1);
      vi.spyOn(connectionStore, "getById").mockReturnValue(
        mockDirectConnection,
      );

      const result = await (workflowDirectTriggerService as any).collectSources(
        {
          canvasId: CANVAS_ID,
          sourcePodId: SOURCE_POD_ID,
          connection: mockDirectConnection,
          summary: TEST_SUMMARY,
        },
      );

      expect(result.ready).toBe(true);
      expect(result.participatingConnectionIds).toEqual([
        mockDirectConnection.id,
      ]);
    });
  });

  // ============================================================
  // B3-B4：Timer 到期 → resolver 回傳正確結果
  // ============================================================
  describe("B3: Timer 到期 - 單源 → ready: true + 正確 participatingConnectionIds", () => {
    it("只有 1 個 source ready，timer 到期，回傳 ready:true 並清除 pending", () => {
      const readySummaries = new Map([[SOURCE_POD_ID, TEST_SUMMARY]]);
      vi.spyOn(directTriggerStore, "getReadySummaries").mockReturnValue(
        readySummaries,
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        mockDirectConnection,
      ]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => {
        if (podId === SOURCE_POD_ID) return makePod(SOURCE_POD_ID);
        if (podId === TARGET_POD_ID) return makePod(TARGET_POD_ID, "idle");
        return undefined;
      }) as any);

      let resolvedResult: any;
      (workflowDirectTriggerService as any).pendingResolvers.set(
        TARGET_POD_ID,
        (result: any) => {
          resolvedResult = result;
        },
      );

      (workflowDirectTriggerService as any).onTimerExpired(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(resolvedResult).toEqual({
        ready: true,
        participatingConnectionIds: [mockDirectConnection.id],
      });
      expect(directTriggerStore.clearDirectPending).toHaveBeenCalledWith(
        TARGET_POD_ID,
      );
      // onTimerExpired 不再直接發送事件，事件由 trigger 階段發送
      expect(workflowEventEmitter.emitDirectTriggered).not.toHaveBeenCalled();
    });
  });

  describe("B4: Timer 到期 - 多源合併 → ready: true + 合併內容", () => {
    it("2 個 source ready，timer 到期，回傳 ready:true、mergedContent 且清除 pending", () => {
      const source2PodId = "source-pod-2";
      const connection2 = makeConnection({
        id: "conn-direct-2",
        sourcePodId: source2PodId,
      });
      const summary2 = "Test summary 2";
      const readySummaries = new Map([
        [SOURCE_POD_ID, TEST_SUMMARY],
        [source2PodId, summary2],
      ]);

      vi.spyOn(directTriggerStore, "getReadySummaries").mockReturnValue(
        readySummaries,
      );
      vi.spyOn(connectionStore, "findByTargetPodId").mockReturnValue([
        mockDirectConnection,
        connection2,
      ]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        _cId: string,
        podId: string,
      ) => makePod(podId)) as any);

      let resolvedResult: any;
      (workflowDirectTriggerService as any).pendingResolvers.set(
        TARGET_POD_ID,
        (result: any) => {
          resolvedResult = result;
        },
      );

      (workflowDirectTriggerService as any).onTimerExpired(
        CANVAS_ID,
        TARGET_POD_ID,
      );

      expect(workflowEventEmitter.emitDirectMerged).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({
          canvasId: CANVAS_ID,
          targetPodId: TARGET_POD_ID,
          sourcePodIds: [SOURCE_POD_ID, source2PodId],
          countdownSeconds: 0,
        }),
      );
      expect(resolvedResult).toEqual({
        ready: true,
        mergedContent: expect.any(String),
        isSummarized: true,
        participatingConnectionIds: expect.arrayContaining([
          mockDirectConnection.id,
          connection2.id,
        ]),
      });
      expect(directTriggerStore.clearDirectPending).toHaveBeenCalledWith(
        TARGET_POD_ID,
      );
      expect(workflowEventEmitter.emitDirectTriggered).not.toHaveBeenCalled();
      expect(workflowEventEmitter.emitWorkflowComplete).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // D：lifecycle hooks（onTrigger / onComplete / onQueued）
  // ============================================================
  describe("D1: lifecycle hooks - onTrigger 只對參與的 connections 發出事件", () => {
    it("單源觸發時，onTrigger 應只對參與的 connection 發出 emitDirectTriggered", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      workflowDirectTriggerService.onTrigger({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        summary: TEST_SUMMARY,
        isSummarized: true,
        participatingConnectionIds: ["conn-A-D"],
      });

      expect(workflowEventEmitter.emitDirectTriggered).toHaveBeenCalledTimes(1);
      expect(workflowEventEmitter.emitDirectTriggered).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({ connectionId: "conn-A-D" }),
      );
    });
  });

  describe("D2-D3: lifecycle hooks - onComplete / onQueued 只對參與的 connections 作用", () => {
    it("onComplete 只對參與的 connections 更新狀態並發出 emitWorkflowComplete", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      const updateStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      workflowDirectTriggerService.onComplete(
        {
          canvasId: CANVAS_ID,
          connectionId: connAD.id,
          sourcePodId: SOURCE_POD_ID,
          targetPodId: TARGET_POD_ID,
          triggerMode: "direct",
          participatingConnectionIds: ["conn-A-D"],
        },
        true,
      );

      expect(workflowEventEmitter.emitWorkflowComplete).toHaveBeenCalledTimes(
        1,
      );
      expect(workflowEventEmitter.emitWorkflowComplete).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        connectionId: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        success: true,
        error: undefined,
        triggerMode: "direct",
      });
      expect(updateStatusSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-A-D",
        "idle",
      );
      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-B-D",
        "idle",
      );
    });

    it("onQueued 只對參與的 connections 更新狀態並發出 emitWorkflowQueued", () => {
      const connAD = makeConnection({
        id: "conn-A-D",
        sourcePodId: SOURCE_POD_ID,
      });
      const connBD = makeConnection({
        id: "conn-B-D",
        sourcePodId: "source-pod-B",
      });

      vi.spyOn(connectionStore, "getById").mockImplementation(((
        _cId: string,
        id: string,
      ) => {
        if (id === "conn-A-D") return connAD;
        if (id === "conn-B-D") return connBD;
        return undefined;
      }) as any);

      const updateStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      workflowDirectTriggerService.onQueued({
        canvasId: CANVAS_ID,
        connectionId: connAD.id,
        sourcePodId: SOURCE_POD_ID,
        targetPodId: TARGET_POD_ID,
        position: 1,
        queueSize: 1,
        triggerMode: "direct",
        participatingConnectionIds: ["conn-A-D"],
      });

      expect(updateStatusSpy).toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-A-D",
        "queued",
      );
      expect(updateStatusSpy).not.toHaveBeenCalledWith(
        CANVAS_ID,
        "conn-B-D",
        "queued",
      );
      expect(workflowEventEmitter.emitWorkflowQueued).toHaveBeenCalledTimes(1);
      expect(workflowEventEmitter.emitWorkflowQueued).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({ connectionId: "conn-A-D" }),
      );
    });
  });

  // ============================================================
  // E：cancelPendingResolver
  // ============================================================
  describe("E1: cancelPendingResolver", () => {
    it("呼叫後 resolver 以 {ready: false} 解析且從 map 中移除", async () => {
      let resolvedResult: any;
      const resolverPromise = new Promise<void>((resolve) => {
        (workflowDirectTriggerService as any).pendingResolvers.set(
          TARGET_POD_ID,
          (result: any) => {
            resolvedResult = result;
            resolve();
          },
        );
      });

      expect(
        (workflowDirectTriggerService as any).pendingResolvers.has(
          TARGET_POD_ID,
        ),
      ).toBe(true);

      workflowDirectTriggerService.cancelPendingResolver(TARGET_POD_ID);
      await resolverPromise;

      expect(resolvedResult).toEqual({ ready: false });
      expect(
        (workflowDirectTriggerService as any).pendingResolvers.has(
          TARGET_POD_ID,
        ),
      ).toBe(false);
    });

    it("對不存在的 targetPodId 不拋出錯誤", () => {
      expect(() => {
        workflowDirectTriggerService.cancelPendingResolver("non-existent-pod");
      }).not.toThrow();
    });
  });
});
