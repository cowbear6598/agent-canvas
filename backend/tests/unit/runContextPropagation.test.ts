import type { Mock } from "vitest";

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => "canvas-1"),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: vi.fn(),
    setStatus: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: {
    getMessages: vi.fn(() => []),
    upsertMessage: vi.fn(),
    clearMessages: vi.fn(),
  },
}));

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    createRun: vi.fn(),
    getRun: vi.fn(),
    createPodInstance: vi.fn(),
    getPodInstance: vi.fn(),
    getPodInstancesByRunId: vi.fn(() => []),
    updatePodInstanceStatus: vi.fn(),
    updatePodInstanceSessionId: vi.fn(),
    getRunningPodInstances: vi.fn(() => []),
    addRunMessage: vi.fn(),
    upsertRunMessage: vi.fn(),
    getRunMessages: vi.fn(() => []),
    countRunsByCanvasId: vi.fn(() => 0),
    getOldestCompletedRunIds: vi.fn(() => []),
    deleteRun: vi.fn(),
    updateRunStatus: vi.fn(),
    getRunsByCanvasId: vi.fn(() => []),
  },
}));

vi.mock("../../src/services/workflow/runExecutionService.js", () => ({
  runExecutionService: {
    createRun: vi.fn(),
    startPodInstance: vi.fn(),
    settlePodTrigger: vi.fn(),
    settleAndSkipPath: vi.fn(),
    errorPodInstance: vi.fn(),
    summarizingPodInstance: vi.fn(),
    registerActiveStream: vi.fn(),
    unregisterActiveStream: vi.fn(),
    deleteRun: vi.fn(),
  },
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn(() =>
    Promise.resolve({
      messageId: "msg-1",
      content: "回覆",
      hasContent: true,
      aborted: false,
    }),
  ),
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchMultiInstanceRun: vi.fn(() =>
    Promise.resolve({
      runId: "test-run-id",
      canvasId: "canvas-1",
      sourcePodId: "source-pod",
    }),
  ),
}));

vi.mock("../../src/utils/chatHelpers.js", () => ({
  injectUserMessage: vi.fn(() => Promise.resolve()),
  extractDisplayContent: vi.fn((msg: unknown) =>
    typeof msg === "string" ? msg : "顯示內容",
  ),
}));

vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onChatComplete: vi.fn(() => Promise.resolve()),
  onChatAborted: vi.fn(),
  onRunChatComplete: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

vi.mock("../../src/services/workflow/workflowExecutionService.js", () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
    triggerWorkflowWithSummary: vi.fn(() => Promise.resolve()),
    generateSummaryWithFallback: vi.fn(),
  },
}));

vi.mock("../../src/services/workflow/index.js", () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
    triggerWorkflowWithSummary: vi.fn(() => Promise.resolve()),
    generateSummaryWithFallback: vi.fn(),
  },
  workflowQueueService: {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    getQueueSize: vi.fn(() => 0),
    processNextInQueue: vi.fn(() => Promise.resolve()),
    init: vi.fn(),
  },
}));

vi.mock("../../src/services/connectionStore.js", () => ({
  connectionStore: {
    findBySourcePodId: vi.fn(() => []),
    getById: vi.fn(),
    updateDecideStatus: vi.fn(),
    updateConnectionStatus: vi.fn(),
    findByTargetPodId: vi.fn(() => []),
  },
}));

vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    list: vi.fn(() => Promise.resolve([])),
  },
}));

// mock getProvider：claude 支援 runMode，codex 不支援
vi.mock("../../src/services/provider/index.js", () => ({
  getProvider: vi.fn((provider: string) => ({
    metadata: {
      capabilities: {
        runMode: provider === "claude",
      },
    },
  })),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleChatSend } from "../../src/handlers/chatHandlers.js";
import { podStore } from "../../src/services/podStore.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
import { injectUserMessage } from "../../src/utils/chatHelpers.js";
import { launchMultiInstanceRun } from "../../src/utils/runChatHelpers.js";
import { runStore } from "../../src/services/runStore.js";
import type { Pod } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const CONNECTION_ID = "conn-ws-1";
const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "source-pod";
const REQUEST_ID = "req-1";

const TEST_RUN_CONTEXT: RunContext = {
  runId: "test-run-id",
  canvasId: CANVAS_ID,
  sourcePodId: SOURCE_POD_ID,
};

function makeMultiInstancePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: SOURCE_POD_ID,
    name: "Multi-Instance Pod",
    status: "idle",
    workspacePath: "/workspace",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    repositoryId: null,
    commandId: null,
    skillIds: [],

    multiInstance: true,
    integrationBindings: undefined,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    ...overrides,
  } as Pod;
}

function makeNormalPod(overrides: Partial<Pod> = {}): Pod {
  return {
    ...makeMultiInstancePod(),
    multiInstance: false,
    ...overrides,
  };
}

describe("RunContext 傳遞驗證", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    asMock(runExecutionService.createRun).mockResolvedValue(TEST_RUN_CONTEXT);
    asMock(runExecutionService.startPodInstance).mockImplementation(() => {});
    asMock(runExecutionService.settlePodTrigger).mockImplementation(() => {});
    asMock(executeStreamingChat).mockResolvedValue({
      messageId: "msg-1",
      content: "回覆",
      hasContent: true,
      aborted: false,
    });
    asMock(injectUserMessage).mockResolvedValue(undefined);
    asMock(launchMultiInstanceRun).mockResolvedValue(TEST_RUN_CONTEXT);
  });

  describe("1. RunContext 從 chatHandlers 傳入 launchMultiInstanceRun", () => {
    it("multiInstance pod 時呼叫 launchMultiInstanceRun 並傳入 canvasId 與 podId", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: CANVAS_ID,
          podId: SOURCE_POD_ID,
          message: "測試訊息",
          abortable: true,
        }),
      );
    });

    it("multiInstance pod 時 launchMultiInstanceRun 收到 onComplete callback", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).toHaveBeenCalledWith(
        expect.objectContaining({
          onComplete: expect.any(Function),
        }),
      );
    });
  });

  describe("2. 有 RunContext 時 message 寫入 run_messages 而非 messages", () => {
    it("multiInstance 時呼叫 launchMultiInstanceRun 而非 injectUserMessage", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).toHaveBeenCalled();
      expect(injectUserMessage).not.toHaveBeenCalled();
    });

    it("非 multiInstance 時不呼叫 launchMultiInstanceRun，改走 injectUserMessage", async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).not.toHaveBeenCalled();
      expect(injectUserMessage).toHaveBeenCalled();
    });
  });

  describe("3. 有 RunContext 時不更新 pod 全域狀態", () => {
    it("multiInstance 時不呼叫 podStore.setStatus", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(podStore.setStatus).not.toHaveBeenCalled();
    });

    it("multiInstance 時透過 launchMultiInstanceRun 啟動流程，不直接呼叫 startPodInstance", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).toHaveBeenCalled();
      // startPodInstance 由 launchMultiInstanceRun 內部負責，不在 chatHandlers 直接呼叫
      expect(runExecutionService.startPodInstance).not.toHaveBeenCalled();
    });
  });

  describe("4. 無 RunContext 時完全向後相容", () => {
    it("非 multiInstance pod 時呼叫 injectUserMessage 而非 launchMultiInstanceRun", async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(injectUserMessage).toHaveBeenCalledWith({
        canvasId: CANVAS_ID,
        podId: SOURCE_POD_ID,
        content: "測試訊息",
      });
      expect(launchMultiInstanceRun).not.toHaveBeenCalled();
    });

    it("非 multiInstance 時不呼叫 runExecutionService.createRun", async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(runExecutionService.createRun).not.toHaveBeenCalled();
    });

    it("非 multiInstance 時 executeStreamingChat 不傳 runContext", async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      const callArgs = asMock(executeStreamingChat).mock.calls[0][0];
      expect(callArgs.runContext).toBeUndefined();
    });

    it("非 multiInstance 時 streaming 過程呼叫 messageStore.upsertMessage 而非 runStore.upsertRunMessage", async () => {
      asMock(podStore.getById).mockReturnValue(makeNormalPod());

      asMock(executeStreamingChat).mockImplementation(
        async (options: { runContext?: RunContext }) => {
          if (options.runContext) {
            runStore.upsertRunMessage(options.runContext.runId, SOURCE_POD_ID, {
              id: "msg-1",
              role: "assistant",
              content: "回覆",
              timestamp: new Date().toISOString(),
            });
          } else {
            messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
              id: "msg-1",
              role: "assistant",
              content: "回覆",
              timestamp: new Date().toISOString(),
            });
          }
          return {
            messageId: "msg-1",
            content: "回覆",
            hasContent: true,
            aborted: false,
          };
        },
      );

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(messageStore.upsertMessage).toHaveBeenCalled();
      expect(runStore.upsertRunMessage).not.toHaveBeenCalled();
    });
  });

  describe("5. checkAndTriggerWorkflows RunContext 傳遞", () => {
    it("multiInstance 時 launchMultiInstanceRun 的 onComplete 會呼叫 onRunChatComplete", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());

      asMock(launchMultiInstanceRun).mockImplementationOnce(
        async (params: { onComplete: (runContext: RunContext) => void }) => {
          params.onComplete(TEST_RUN_CONTEXT);
          return TEST_RUN_CONTEXT;
        },
      );

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      const { onRunChatComplete } =
        await import("../../src/utils/chatCallbacks.js");
      expect(onRunChatComplete).toHaveBeenCalledWith(
        TEST_RUN_CONTEXT,
        CANVAS_ID,
        SOURCE_POD_ID,
      );
    });
  });

  describe("6. error 與 abort 路徑", () => {
    it("launchMultiInstanceRun 拋出錯誤時 handleChatSend 不會吞掉例外", async () => {
      asMock(podStore.getById).mockReturnValue(makeMultiInstancePod());
      asMock(launchMultiInstanceRun).mockRejectedValue(new Error("串流錯誤"));

      await expect(
        handleChatSend(
          CONNECTION_ID,
          { podId: SOURCE_POD_ID, message: "測試訊息" },
          REQUEST_ID,
        ),
      ).rejects.toThrow("串流錯誤");
    });

    it("multiInstance pod 找不到時 handleChatSend 不呼叫 launchMultiInstanceRun", async () => {
      asMock(podStore.getById).mockReturnValue(undefined);

      await handleChatSend(
        CONNECTION_ID,
        { podId: SOURCE_POD_ID, message: "測試訊息" },
        REQUEST_ID,
      );

      expect(launchMultiInstanceRun).not.toHaveBeenCalled();
      expect(executeStreamingChat).not.toHaveBeenCalled();
    });
  });
});
