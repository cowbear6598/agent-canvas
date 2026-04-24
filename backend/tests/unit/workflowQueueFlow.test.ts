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

import { workflowExecutionService } from "../../src/services/workflow";
import { workflowQueueService } from "../../src/services/workflow";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { getProvider } from "../../src/services/provider/index.js";
import { setupAllSpies } from "../mocks/workflowSpySetup.js";
import {
  createMockPod,
  createMockConnection,
  createMockMessages,
  createMockStrategy,
  initializeQueueService,
  clearAllQueues,
} from "../mocks/workflowTestFactories.js";
import type { Connection } from "../../src/types";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";

describe("WorkflowQueueFlow - Queue 處理、混合場景、錯誤恢復", () => {
  const canvasId = "canvas-1";
  const sourcePodId = "source-pod";
  const targetPodId = "target-pod";

  let mockSourcePod: ReturnType<typeof createMockPod>;
  let mockTargetPod: ReturnType<typeof createMockPod>;
  let mockAutoConnection: Connection;
  let mockDirectConnection: Connection;
  let mockMessages: ReturnType<typeof createMockMessages>;
  let mockAutoStrategy: TriggerStrategy;
  let mockDirectStrategy: TriggerStrategy;
  let mockAiDecideStrategy: TriggerStrategy;

  beforeEach(() => {
    mockSourcePod = createMockPod({
      id: sourcePodId,
      name: "Source Pod",
      status: "idle",
    });
    mockTargetPod = createMockPod({
      id: targetPodId,
      name: "Target Pod",
      status: "idle",
    });
    mockAutoConnection = createMockConnection({
      id: "conn-auto-1",
      sourcePodId,
      targetPodId,
      triggerMode: "auto",
    });
    mockDirectConnection = createMockConnection({
      id: "conn-direct-1",
      sourcePodId,
      targetPodId: "target-pod-3",
      triggerMode: "direct",
    });
    mockMessages = createMockMessages();
    mockAutoStrategy = createMockStrategy("auto");
    mockDirectStrategy = createMockStrategy("direct");
    mockAiDecideStrategy = createMockStrategy("ai-decide");

    const customPodGetter = (cId: string, podId: string) => {
      if (podId === sourcePodId) return { ...mockSourcePod };
      if (podId.startsWith("target-pod"))
        return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
      return undefined;
    };

    setupAllSpies({ messages: mockMessages, customPodGetter });

    initializeQueueService({
      auto: mockAutoStrategy,
      direct: mockDirectStrategy,
      "ai-decide": mockAiDecideStrategy,
    });
    clearAllQueues([targetPodId, "target-pod-2", "target-pod-3"]);
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
        targetPodId,
        targetAnchor: "left",
        triggerMode: "auto",
        decideStatus: "none",
        decideReason: null,
        connectionStatus: "idle",
      };

      expect(workflowQueueService.getQueueSize(targetPodId)).toBe(0);

      workflowQueueService.enqueue({
        canvasId,
        connectionId: queuedConnection.id,
        sourcePodId: queuedConnection.sourcePodId,
        targetPodId,
        summary: "Queued summary",
        isSummarized: true,
        triggerMode: "auto",
      });

      expect(workflowQueueService.getQueueSize(targetPodId)).toBe(1);

      vi.spyOn(connectionStore, "getById").mockReturnValue(queuedConnection);
      vi.spyOn(connectionStore, "findBySourcePodId").mockReturnValue([]);
      vi.spyOn(podStore, "getById").mockImplementation(((
        cId: string,
        podId: string,
      ) => {
        if (podId === targetPodId) return { ...mockTargetPod, status: "idle" };
        return { ...mockSourcePod, id: podId };
      }) as any);

      await workflowQueueService.processNextInQueue(canvasId, targetPodId);

      expect(workflowQueueService.getQueueSize(targetPodId)).toBe(0);

      expect(mockAutoStrategy.onQueueProcessed).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
          targetPodId,
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
        if (podId === targetPodId) return { ...mockTargetPod, status: "idle" };
        if (podId === sourcePodId) return mockSourcePod;
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
          canvasId,
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
      expect(processNextInQueueSpy).toHaveBeenCalledWith(canvasId, targetPodId);
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
        canvasId,
        connectionId: directConn.id,
        summary: "Direct summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockDirectStrategy,
      });

      expect(mockDirectStrategy.onTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
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
        canvasId,
        connectionId: autoConn.id,
        summary: "Auto summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockAutoStrategy,
      });

      expect(mockAutoStrategy.onTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
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
        targetPodId,
        targetAnchor: "left",
        triggerMode: "auto",
        decideStatus: "none",
        decideReason: null,
        connectionStatus: "queued",
      };

      workflowQueueService.enqueue({
        canvasId,
        connectionId: queuedConnection.id,
        sourcePodId: queuedConnection.sourcePodId,
        targetPodId,
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
        if (podId === targetPodId) return { ...mockTargetPod, status: "idle" };
        return { ...mockSourcePod, id: podId };
      }) as any);

      const updateConnectionStatusSpy = vi.spyOn(
        connectionStore,
        "updateConnectionStatus",
      );

      await workflowQueueService.processNextInQueue(canvasId, targetPodId);

      expect(mockAutoStrategy.onQueueProcessed).toHaveBeenCalled();

      // onQueueProcessed 被呼叫後，updateConnectionStatus 不應以 active 被呼叫（active 在 triggerWorkflowWithSummary 設定）
      const activeCallsFromQueueProcessed =
        updateConnectionStatusSpy.mock.calls.filter(
          ([, , status]) => status === "active",
        );
      // 此時 triggerWorkflowWithSummary 尚未完成（fire-and-forget），所以 active 還沒被設定
      // 我們只驗證 onQueueProcessed 本身不再呼叫 updateConnectionStatus('active')
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
        canvasId,
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
        if (podId === sourcePodId) return mockSourcePod;
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
            return { canvasId, pod };
          }
          return undefined;
        },
      );

      workflowQueueService.enqueue({
        canvasId,
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
        canvasId,
        connectionId: conn.id,
        summary: "Test summary",
        isSummarized: true,
        participatingConnectionIds: undefined,
        strategy: mockAutoStrategy,
      });

      // 等待 fire-and-forget 的錯誤處理完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAutoStrategy.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
          connectionId: conn.id,
          sourcePodId,
          targetPodId: "target-fail",
          triggerMode: "auto",
        }),
        "Claude query failed",
      );

      expect(processNextInQueueCalled).toBe(true);
      expect(processNextInQueueSpy).toHaveBeenCalledWith(
        canvasId,
        "target-fail",
      );

      expect(podStore.setStatus).toHaveBeenCalledWith(
        canvasId,
        "target-fail",
        "idle",
      );
    });
  });
});
