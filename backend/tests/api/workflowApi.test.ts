import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock 函式 ---
const mockRequireCanvas = vi.fn();
const mockResolvePod = vi.fn();
const mockRequireJsonBody = vi.fn();
const mockFindByTargetPodId = vi.fn();
const mockExecuteStreamingChat = vi.fn();
const mockInjectUserMessage = vi.fn();
const mockTryExpandCommandMessage = vi.fn();
const mockSetStatus = vi.fn();
const mockGetById = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

// --- vi.mock ---

vi.mock("../../src/api/apiHelpers.js", () => ({
  jsonResponse: (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  requireCanvas: (...args: unknown[]) => mockRequireCanvas(...args),
  resolvePod: (...args: unknown[]) => mockResolvePod(...args),
  requireJsonBody: (...args: unknown[]) => mockRequireJsonBody(...args),
  UUID_REGEX:
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    setStatus: (...args: unknown[]) => mockSetStatus(...args),
    getById: (...args: unknown[]) => mockGetById(...args),
  },
}));

vi.mock("../../src/services/connectionStore.js", () => ({
  connectionStore: {
    findByTargetPodId: (...args: unknown[]) => mockFindByTargetPodId(...args),
    list: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: (...args: unknown[]) =>
    mockExecuteStreamingChat(...args),
}));

vi.mock("../../src/services/provider/abortRegistry.js", () => ({
  abortRegistry: {
    abort: vi.fn(),
  },
}));

vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onChatComplete: vi.fn(),
  onChatAborted: vi.fn(),
}));

vi.mock("../../src/utils/chatHelpers.js", () => ({
  injectUserMessage: (...args: unknown[]) => mockInjectUserMessage(...args),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    log: vi.fn(),
  },
}));

vi.mock("../../src/services/normalExecutionStrategy.js", () => ({
  NormalModeExecutionStrategy: vi.fn(),
}));

vi.mock("../../src/services/commandExpander.js", () => ({
  tryExpandCommandMessage: (...args: unknown[]) =>
    mockTryExpandCommandMessage(...args),
}));

const { handleWorkflowChat } = await import("../../src/api/workflowApi.js");

const CANVAS_ID = "canvas-uuid-1";
const POD_ID = "pod-uuid-1";

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    id: POD_ID,
    name: "Test Pod",
    status: "idle" as const,
    integrationBindings: [],
    commandId: null,
    multiInstance: false,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request(
    `http://localhost/api/canvases/${CANVAS_ID}/workflows/${POD_ID}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "1" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 預設：canvas 存在
  mockRequireCanvas.mockReturnValue({
    canvas: { id: CANVAS_ID, name: "test" },
    error: null,
  });
  mockRequireJsonBody.mockReturnValue(null);
  mockFindByTargetPodId.mockReturnValue([]);
  mockInjectUserMessage.mockResolvedValue(undefined);
  mockExecuteStreamingChat.mockResolvedValue(undefined);
  // 預設：tryExpandCommandMessage 回傳 ok:true 帶原始訊息
  mockTryExpandCommandMessage.mockImplementation(
    (_pod: unknown, message: unknown) => Promise.resolve({ ok: true, message }),
  );
});

// 等待 fire-and-forget async 完成
async function flushAsync(): Promise<void> {
  // 多次 microtask flush，確保 fire-and-forget 內的 await 鏈全部跑完
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("handleWorkflowChat — Command 展開", () => {
  it("Pod 綁 commandId 時，injectUserMessage 與 executeStreamingChat 收到展開後內容", async () => {
    const pod = makePod({ commandId: "my-cmd" });
    mockResolvePod.mockReturnValue(pod);
    const expanded = "<command>\n## 命令內容\n</command>\n使用者訊息";
    mockTryExpandCommandMessage.mockResolvedValue({
      ok: true,
      message: expanded,
    });

    const req = makeRequest({ message: "使用者訊息" });
    const response = await handleWorkflowChat(req, {
      id: CANVAS_ID,
      podId: POD_ID,
    });

    expect(response.status).toBe(202);
    await flushAsync();

    expect(mockTryExpandCommandMessage).toHaveBeenCalledWith(
      pod,
      "使用者訊息",
      "workflowApi",
    );
    expect(mockInjectUserMessage).toHaveBeenCalledWith({
      canvasId: CANVAS_ID,
      podId: POD_ID,
      content: expanded,
    });
    expect(mockExecuteStreamingChat).toHaveBeenCalledWith(
      expect.objectContaining({ message: expanded, abortable: true }),
      expect.anything(),
    );
  });

  it("Pod 綁 commandId 但 command 找不到時，記 warn、不呼叫 inject 與 executor、不中斷 202 路徑", async () => {
    const pod = makePod({ commandId: "missing-cmd" });
    mockResolvePod.mockReturnValue(pod);
    mockTryExpandCommandMessage.mockResolvedValue({
      ok: false,
      commandId: "missing-cmd",
    });

    const req = makeRequest({ message: "使用者訊息" });
    const response = await handleWorkflowChat(req, {
      id: CANVAS_ID,
      podId: POD_ID,
    });

    // 仍回 202 ACCEPTED（fire-and-forget 路徑不中斷）
    expect(response.status).toBe(202);
    await flushAsync();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Chat",
      "Check",
      expect.stringContaining("missing-cmd"),
    );
    expect(mockInjectUserMessage).not.toHaveBeenCalled();
    expect(mockExecuteStreamingChat).not.toHaveBeenCalled();
    // Pod 狀態應重設為 idle 避免卡住
    expect(mockSetStatus).toHaveBeenCalledWith(CANVAS_ID, POD_ID, "idle");
  });
});
