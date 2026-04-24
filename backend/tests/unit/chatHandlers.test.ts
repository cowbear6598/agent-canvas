import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock 函式 ---
const mockGetById = vi.fn();
const mockSetStatus = vi.fn();
const mockGetMessages = vi.fn();
const mockAbortQuery = vi.fn();
const mockAbortRegistryAbort = vi.fn();
const mockEmitSuccess = vi.fn();
const mockEmitError = vi.fn();
const mockValidatePod = vi.fn();
const mockExecuteStreamingChat = vi.fn();
const mockInjectUserMessage = vi.fn();
const mockLaunchMultiInstanceRun = vi.fn();

// --- vi.mock ---

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  withCanvasId:
    (
      _event: unknown,
      handler: (
        connectionId: string,
        canvasId: string,
        payload: unknown,
        requestId: string,
      ) => Promise<void>,
    ) =>
    (connectionId: string, payload: unknown, requestId: string) =>
      handler(connectionId, "canvas-1", payload, requestId),
  validatePod: (...args: unknown[]) => mockValidatePod(...args),
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: mockGetById,
    setStatus: mockSetStatus,
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: {
    getMessages: mockGetMessages,
  },
}));

vi.mock("../../src/services/claude/claudeService.js", () => ({
  claudeService: {
    abortQuery: mockAbortQuery,
  },
}));

vi.mock("../../src/services/provider/abortRegistry.js", () => ({
  abortRegistry: {
    abort: mockAbortRegistryAbort,
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitSuccess: mockEmitSuccess,
  emitError: mockEmitError,
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: mockExecuteStreamingChat,
}));

vi.mock("../../src/utils/chatHelpers.js", () => ({
  injectUserMessage: mockInjectUserMessage,
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchMultiInstanceRun: mockLaunchMultiInstanceRun,
}));

vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onChatComplete: vi.fn(),
  onChatAborted: vi.fn(),
  onRunChatComplete: vi.fn(),
}));

// mock getProvider：預設 claude provider 支援 runMode
vi.mock("../../src/services/provider/index.js", () => ({
  getProvider: vi.fn((provider: string) => ({
    metadata: {
      capabilities: {
        runMode: provider === "claude",
      },
    },
  })),
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    POD_ERROR: "pod:error",
    POD_CHAT_HISTORY_RESULT: "pod:chat:history:result",
  },
}));

const { handleChatSend, handleChatAbort, handleChatHistory } =
  await import("../../src/handlers/chatHandlers.js");

const CONNECTION_ID = "conn-1";
const CANVAS_ID = "canvas-1";
const POD_ID = "pod-uuid-1";
const REQUEST_ID = "req-1";

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    id: POD_ID,
    name: "測試 Pod",
    status: "idle" as const,
    multiInstance: false,
    integrationBindings: [],
    provider: "claude" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ================================================================
// handleChatSend
// ================================================================
describe("handleChatSend", () => {
  it("Pod 不存在時應提早返回，不執行後續邏輯", async () => {
    mockValidatePod.mockReturnValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
  });

  it("Pod 有 integrationBindings 時應回傳 INTEGRATION_BOUND 錯誤", async () => {
    const pod = makePod({ integrationBindings: [{ id: "bind-1" }] });
    mockValidatePod.mockReturnValue(pod);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "INTEGRATION_BOUND",
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
  });

  it("multiInstance 模式應呼叫 launchMultiInstanceRun 而非 executeStreamingChat", async () => {
    const pod = makePod({ multiInstance: true });
    mockValidatePod.mockReturnValue(pod);
    mockLaunchMultiInstanceRun.mockResolvedValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "開始 run" },
      REQUEST_ID,
    );

    expect(mockLaunchMultiInstanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "開始 run",
        abortable: true,
      }),
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    expect(mockInjectUserMessage).not.toHaveBeenCalled();
  });

  it("一般模式但 Pod busy（chatting）時應回傳 POD_BUSY 錯誤", async () => {
    const pod = makePod({ status: "chatting" });
    mockValidatePod.mockReturnValue(pod);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "POD_BUSY",
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
  });

  it("一般模式但 Pod busy（summarizing）時應回傳 POD_BUSY 錯誤", async () => {
    const pod = makePod({ status: "summarizing" });
    mockValidatePod.mockReturnValue(pod);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "POD_BUSY",
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
  });

  it("一般模式 idle Pod 應注入使用者訊息並執行串流對話", async () => {
    const pod = makePod({ status: "idle" });
    mockValidatePod.mockReturnValue(pod);
    mockInjectUserMessage.mockResolvedValue(undefined);
    mockExecuteStreamingChat.mockResolvedValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    expect(mockInjectUserMessage).toHaveBeenCalledWith({
      canvasId: CANVAS_ID,
      podId: POD_ID,
      content: "你好",
    });
    expect(mockExecuteStreamingChat).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "你好",
        abortable: true,
      }),
      expect.objectContaining({
        onComplete: expect.any(Function),
        onAborted: expect.any(Function),
      }),
    );
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
  });

  it("multiInstance 模式不應檢查 Pod busy 狀態", async () => {
    const pod = makePod({ multiInstance: true, status: "chatting" });
    mockValidatePod.mockReturnValue(pod);
    mockLaunchMultiInstanceRun.mockResolvedValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "你好" },
      REQUEST_ID,
    );

    // 不應觸發 POD_BUSY 錯誤
    expect(mockEmitError).not.toHaveBeenCalled();
    expect(mockLaunchMultiInstanceRun).toHaveBeenCalled();
  });

  // ================================================================
  // Capability 守門：Codex Pod + multiInstance 不支援 Run 模式
  // ================================================================
  it("Codex Pod 且 multiInstance=true 時應回傳 RUN_NOT_SUPPORTED 錯誤，不執行後續 chat 邏輯", async () => {
    // Codex provider：getProvider().metadata.capabilities.runMode === false
    const pod = makePod({ provider: "codex", multiInstance: true });
    mockValidatePod.mockReturnValue(pod);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "開始 run" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "RUN_NOT_SUPPORTED",
    );
    // 不應進入後續的 launchMultiInstanceRun 或 executeStreamingChat
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
  });

  it("Claude Pod 且 multiInstance=true 時不應觸發 RUN_NOT_SUPPORTED 錯誤", async () => {
    // Claude provider：getProvider().metadata.capabilities.runMode === true
    const pod = makePod({ provider: "claude", multiInstance: true });
    mockValidatePod.mockReturnValue(pod);
    mockLaunchMultiInstanceRun.mockResolvedValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "開始 run" },
      REQUEST_ID,
    );

    // 不應收到 RUN_NOT_SUPPORTED
    const errorCalls = (mockEmitError.mock.calls as unknown[][]).filter(
      (args) => args[5] === "RUN_NOT_SUPPORTED",
    );
    expect(errorCalls).toHaveLength(0);
    expect(mockLaunchMultiInstanceRun).toHaveBeenCalled();
  });

  // ================================================================
  // Codex Pod multiInstance=false：走一般 chat 流程（review #29 + #36）
  // ================================================================
  it("Codex Pod multiInstance=false 時 capability 守門不應觸發，應走一般 chat 流程", async () => {
    // capability 守門只在 multiInstance===true 時才判斷，false 時直接略過
    const pod = makePod({
      provider: "codex",
      multiInstance: false,
      status: "idle",
    });
    mockValidatePod.mockReturnValue(pod);
    mockInjectUserMessage.mockResolvedValue(undefined);
    mockExecuteStreamingChat.mockResolvedValue(undefined);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "codex 一般對話" },
      REQUEST_ID,
    );

    // 不應觸發 RUN_NOT_SUPPORTED
    const runNotSupportedCalls = (
      mockEmitError.mock.calls as unknown[][]
    ).filter((args) => args[5] === "RUN_NOT_SUPPORTED");
    expect(runNotSupportedCalls).toHaveLength(0);
    // 應走一般 chat 流程：呼叫 executeStreamingChat 而非 launchMultiInstanceRun
    expect(mockExecuteStreamingChat).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "codex 一般對話",
        abortable: true,
      }),
      expect.objectContaining({
        onComplete: expect.any(Function),
        onAborted: expect.any(Function),
      }),
    );
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
  });

  it("Codex Pod multiInstance=false 仍應通過 validateIntegrationBindings 與 validatePodNotBusy 驗證鏈", async () => {
    // 有 integration bindings 時應擋住，與 provider 無關
    const podWithBindings = makePod({
      provider: "codex",
      multiInstance: false,
      integrationBindings: [{ id: "bind-1" }],
    });
    mockValidatePod.mockReturnValue(podWithBindings);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "codex 被擋住" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "INTEGRATION_BOUND",
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    expect(mockLaunchMultiInstanceRun).not.toHaveBeenCalled();
  });

  it("Codex Pod multiInstance=false 且 Pod busy 時應回傳 POD_BUSY 錯誤", async () => {
    // validatePodNotBusy 對 codex normal mode 仍應有效
    const pod = makePod({
      provider: "codex",
      multiInstance: false,
      status: "chatting",
    });
    mockValidatePod.mockReturnValue(pod);

    await handleChatSend(
      CONNECTION_ID,
      { podId: POD_ID, message: "codex busy 測試" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "POD_BUSY",
    );
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
  });
});

// ================================================================
// handleChatAbort
// ================================================================
describe("handleChatAbort", () => {
  it("Pod 不存在時應提早返回", async () => {
    mockValidatePod.mockReturnValue(undefined);

    await handleChatAbort(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockAbortRegistryAbort).not.toHaveBeenCalled();
  });

  it("Pod 狀態非 chatting 時應回傳 POD_NOT_CHATTING 錯誤", async () => {
    const pod = makePod({ status: "idle" });
    mockValidatePod.mockReturnValue(pod);

    await handleChatAbort(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "POD_NOT_CHATTING",
    );
    expect(mockAbortRegistryAbort).not.toHaveBeenCalled();
  });

  it("Pod 狀態為 summarizing 時也應回傳 POD_NOT_CHATTING 錯誤", async () => {
    const pod = makePod({ status: "summarizing" });
    mockValidatePod.mockReturnValue(pod);

    await handleChatAbort(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "POD_NOT_CHATTING",
    );
    expect(mockAbortRegistryAbort).not.toHaveBeenCalled();
  });

  it("Pod 狀態為 chatting 且 abort 成功時不應發送錯誤", async () => {
    const pod = makePod({ status: "chatting" });
    mockValidatePod.mockReturnValue(pod);
    // chatHandlers 現在改呼叫 abortRegistry.abort
    mockAbortRegistryAbort.mockReturnValue(true);

    await handleChatAbort(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockAbortRegistryAbort).toHaveBeenCalledWith(POD_ID);
    expect(mockEmitError).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("Pod 狀態為 chatting 但 abort 失敗時應重設狀態為 idle 並回傳 NO_ACTIVE_QUERY 錯誤", async () => {
    const pod = makePod({ status: "chatting" });
    mockValidatePod.mockReturnValue(pod);
    // chatHandlers 現在改呼叫 abortRegistry.abort
    mockAbortRegistryAbort.mockReturnValue(false);

    await handleChatAbort(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockAbortRegistryAbort).toHaveBeenCalledWith(POD_ID);
    expect(mockSetStatus).toHaveBeenCalledWith(CANVAS_ID, POD_ID, "idle");
    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:error",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "NO_ACTIVE_QUERY",
    );
  });
});

// ================================================================
// handleChatHistory
// ================================================================
describe("handleChatHistory", () => {
  it("Pod 不存在時應回傳 success: false 及錯誤訊息", async () => {
    mockGetById.mockReturnValue(undefined);

    await handleChatHistory(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockEmitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:chat:history:result",
      expect.objectContaining({ key: expect.any(String) }),
      REQUEST_ID,
      POD_ID,
      "NOT_FOUND",
    );
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  it("Pod 存在時應回傳歷史訊息清單", async () => {
    const pod = makePod();
    mockGetById.mockReturnValue(pod);

    const mockMessages = [
      {
        id: "msg-1",
        role: "user",
        content: "你好",
        timestamp: "2024-01-01T00:00:00.000Z",
        subMessages: undefined,
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "哈囉！有什麼我可以幫你的？",
        timestamp: "2024-01-01T00:00:01.000Z",
        subMessages: [{ id: "sub-1", type: "text", content: "哈囉！" }],
      },
    ];
    mockGetMessages.mockReturnValue(mockMessages);

    await handleChatHistory(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockGetMessages).toHaveBeenCalledWith(POD_ID);
    expect(mockEmitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:chat:history:result",
      {
        requestId: REQUEST_ID,
        success: true,
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "你好",
            timestamp: "2024-01-01T00:00:00.000Z",
            subMessages: undefined,
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "哈囉！有什麼我可以幫你的？",
            timestamp: "2024-01-01T00:00:01.000Z",
            subMessages: [{ id: "sub-1", type: "text", content: "哈囉！" }],
          },
        ],
      },
    );
  });

  it("Pod 存在但無歷史訊息時應回傳空陣列", async () => {
    const pod = makePod();
    mockGetById.mockReturnValue(pod);
    mockGetMessages.mockReturnValue([]);

    await handleChatHistory(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    expect(mockEmitSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      "pod:chat:history:result",
      {
        requestId: REQUEST_ID,
        success: true,
        messages: [],
      },
    );
  });

  it("回傳的訊息不應包含原始 message 物件的額外欄位", async () => {
    const pod = makePod();
    mockGetById.mockReturnValue(pod);

    const mockMessages = [
      {
        id: "msg-1",
        role: "user",
        content: "你好",
        timestamp: "2024-01-01T00:00:00.000Z",
        subMessages: undefined,
        // 這些額外欄位不應出現在回傳結果中
        internalField: "should-not-appear",
        tokens: 100,
      },
    ];
    mockGetMessages.mockReturnValue(mockMessages);

    await handleChatHistory(CONNECTION_ID, { podId: POD_ID }, REQUEST_ID);

    const callArg = mockEmitSuccess.mock.calls[0][2];
    const returnedMsg = callArg.messages[0];
    expect(returnedMsg).not.toHaveProperty("internalField");
    expect(returnedMsg).not.toHaveProperty("tokens");
    expect(Object.keys(returnedMsg)).toEqual(
      expect.arrayContaining([
        "id",
        "role",
        "content",
        "timestamp",
        "subMessages",
      ]),
    );
  });
});
