import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { IntegrationApp } from "../../src/services/integration/types.js";

const mockEmitToAll = vi.fn();
const mockEmitError = vi.fn();
const mockEmitNotFound = vi.fn();
const mockEmitPodUpdated = vi.fn();
const mockValidatePod = vi.fn();
const mockGetOrThrow = vi.fn();
const mockCreate = vi.fn();
const mockIntegrationAppGetById = vi.fn();
const mockLoggerLog = vi.fn();
const mockLoggerError = vi.fn();
const mockHandleResultError = vi.fn().mockReturnValue(false);
const mockInitialize = vi.fn();
const mockSanitizeConfig = vi.fn().mockReturnValue({});
const mockGetPodDisplayName = vi.fn().mockReturnValue("Test Pod");
const mockRemoveIntegrationBinding = vi.fn();
const mockAddIntegrationBinding = vi.fn();

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToAll: mockEmitToAll },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
  emitNotFound: mockEmitNotFound,
  emitSuccess: vi.fn(),
}));

vi.mock("../../src/services/integration/integrationRegistry.js", () => ({
  integrationRegistry: {
    get: vi.fn().mockReturnValue({ sanitizeConfig: mockSanitizeConfig }),
    getOrThrow: mockGetOrThrow,
  },
}));

vi.mock("../../src/services/integration/integrationAppStore.js", () => ({
  integrationAppStore: {
    create: mockCreate,
    getById: mockIntegrationAppGetById,
    delete: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    updateResources: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: mockLoggerLog, warn: vi.fn(), error: mockLoggerError },
}));

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  handleResultError: mockHandleResultError,
  emitPodUpdated: mockEmitPodUpdated,
  getPodDisplayName: mockGetPodDisplayName,
  validatePod: (...args: unknown[]) => mockValidatePod(...args),
  withCanvasId: (_event: unknown, handler: unknown) => handler,
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    findByIntegrationApp: vi.fn().mockReturnValue([]),
    addIntegrationBinding: mockAddIntegrationBinding,
    removeIntegrationBinding: mockRemoveIntegrationBinding,
  },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    INTEGRATION_APP_CREATED: "integration:appCreated",
    INTEGRATION_APP_DELETED: "integration:appDeleted",
    POD_INTEGRATION_BOUND: "pod:integrationBound",
    POD_INTEGRATION_UNBOUND: "pod:integrationUnbound",
  },
}));

vi.mock("../../src/utils/errorHelpers.js", () => ({
  getErrorMessage: (e: unknown) => String(e),
}));

const {
  handleIntegrationAppCreate,
  handlePodBindIntegration,
  handlePodUnbindIntegration,
} = await import("../../src/handlers/integrationHandlers.js");

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: "app-1",
    name: "Test Slack App",
    provider: "slack",
    config: { token: "xoxb-test" },
    connectionStatus: "disconnected",
    resources: [],
    ...overrides,
  };
}

const CONNECTION_ID = "conn-1";
const REQUEST_ID = "req-1";

describe("handleIntegrationAppCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleResultError.mockReturnValue(false);
    asMock(mockSanitizeConfig).mockReturnValue({});
    mockValidatePod.mockReturnValue(undefined);
    mockGetPodDisplayName.mockReturnValue("Test Pod");
  });

  it("建立成功後先 emit APP_CREATED，再背景執行初始化", async () => {
    const initialApp = makeApp({
      connectionStatus: "disconnected",
      resources: [],
    });

    mockGetOrThrow.mockReturnValue({
      displayName: "Slack",
      sanitizeConfig: mockSanitizeConfig,
      createAppSchema: {
        safeParse: vi.fn().mockReturnValue({ success: true }),
      },
      initialize: mockInitialize.mockImplementation(async () => {
        // 模擬初始化耗時
      }),
    });
    mockCreate.mockReturnValue({ data: initialApp });
    mockIntegrationAppGetById.mockReturnValue(initialApp);

    await handleIntegrationAppCreate(
      CONNECTION_ID,
      { provider: "slack", name: "Test Slack App", config: {} },
      REQUEST_ID,
    );

    // emit 應在 initialize 之前發出，使用建立當下的 app 狀態
    expect(mockEmitToAll).toHaveBeenCalledWith(
      "integration:appCreated",
      expect.objectContaining({
        app: expect.objectContaining({
          connectionStatus: "disconnected",
        }),
      }),
    );
    expect(mockInitialize).toHaveBeenCalled();
  });

  it("初始化失敗時仍已 emit APP_CREATED（建立時的狀態）", async () => {
    const initialApp = makeApp({
      connectionStatus: "disconnected",
      resources: [],
    });

    mockGetOrThrow.mockReturnValue({
      displayName: "Slack",
      sanitizeConfig: mockSanitizeConfig,
      createAppSchema: {
        safeParse: vi.fn().mockReturnValue({ success: true }),
      },
      initialize: vi.fn().mockRejectedValue(new Error("auth.test 失敗")),
    });
    mockCreate.mockReturnValue({ data: initialApp });
    mockIntegrationAppGetById.mockReturnValue(initialApp);

    await handleIntegrationAppCreate(
      CONNECTION_ID,
      { provider: "slack", name: "Test Slack App", config: {} },
      REQUEST_ID,
    );

    expect(mockEmitToAll).toHaveBeenCalledWith(
      "integration:appCreated",
      expect.objectContaining({
        app: expect.objectContaining({ connectionStatus: "disconnected" }),
      }),
    );
  });

  it("初始化失敗時不應 emit 錯誤事件，僅記錄 log", async () => {
    const initialApp = makeApp();

    mockGetOrThrow.mockReturnValue({
      displayName: "Slack",
      sanitizeConfig: mockSanitizeConfig,
      createAppSchema: {
        safeParse: vi.fn().mockReturnValue({ success: true }),
      },
      initialize: vi.fn().mockRejectedValue(new Error("連線逾時")),
    });
    mockCreate.mockReturnValue({ data: initialApp });
    mockIntegrationAppGetById.mockReturnValue(initialApp);

    await handleIntegrationAppCreate(
      CONNECTION_ID,
      { provider: "slack", name: "Test Slack App", config: {} },
      REQUEST_ID,
    );

    // 等待背景 Promise 完成（fire-and-forget 的 .catch 需要一個 microtask）
    await vi.waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith(
        "Integration",
        "Error",
        expect.stringContaining("初始化失敗或逾時"),
      );
    });

    expect(mockEmitError).not.toHaveBeenCalled();
  });

  it("config schema safeParse 失敗時，emitError 而非 throw，回傳 success: false", async () => {
    mockGetOrThrow.mockReturnValue({
      displayName: "Slack",
      sanitizeConfig: mockSanitizeConfig,
      createAppSchema: {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [{ message: "botToken 欄位必填" }],
          },
        }),
      },
      initialize: mockInitialize,
    });

    // 傳入缺少 botToken 的 config
    await handleIntegrationAppCreate(
      CONNECTION_ID,
      { provider: "slack", name: "invalid-app", config: {} },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledOnce();
    expect(mockEmitToAll).not.toHaveBeenCalled();
  });
});

describe("handlePodBindIntegration", () => {
  const CANVAS_ID = "canvas-1";

  function makePod(overrides: Record<string, unknown> = {}) {
    return {
      id: "pod-1",
      name: "Test Pod",
      provider: "claude",
      integrationBindings: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleResultError.mockReturnValue(false);
    mockGetPodDisplayName.mockReturnValue("Test Pod");
  });

  it("app 不存在時，emitNotFound 收到的 canvasId 是 canvasId（withCanvasId 解析後）", async () => {
    const pod = makePod();
    mockValidatePod.mockReturnValue(pod);
    mockIntegrationAppGetById.mockReturnValue(null);

    await (handlePodBindIntegration as any)(
      CONNECTION_ID,
      CANVAS_ID,
      {
        podId: "pod-1",
        appId: "nonexistent-app",
        resourceId: "res-1",
        provider: "slack",
      },
      REQUEST_ID,
    );

    expect(mockEmitNotFound).toHaveBeenCalledOnce();
    // canvasId 在第 6 個參數（0-index: 5）
    const [, , , , , passedCanvasId] = mockEmitNotFound.mock.calls[0];
    expect(passedCanvasId).toBe(CANVAS_ID);
  });

  it("provider 不存在時，emitError 收到的 canvasId 是 caller 帶入的值", async () => {
    const pod = makePod();
    mockValidatePod.mockReturnValue(pod);
    mockIntegrationAppGetById.mockReturnValue(
      makeApp({
        connectionStatus: "connected",
        resources: [{ id: "res-1", name: "general" }],
      }),
    );
    // provider 不存在時 getOrThrow throw
    mockGetOrThrow.mockImplementation(() => {
      throw new Error("Provider 不存在");
    });

    await (handlePodBindIntegration as any)(
      CONNECTION_ID,
      CANVAS_ID,
      {
        podId: "pod-1",
        appId: "app-1",
        resourceId: "res-1",
        provider: "unknown-provider",
      },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledOnce();
    const [, , , passedCanvasId] = mockEmitError.mock.calls[0];
    expect(passedCanvasId).toBe(CANVAS_ID);
  });

  it("happy path：app 與 provider 都存在時成功綁定，emitPodUpdated 被呼叫", async () => {
    const pod = makePod();
    mockValidatePod.mockReturnValue(pod);
    mockIntegrationAppGetById.mockReturnValue(
      makeApp({
        connectionStatus: "connected",
        resources: [{ id: "res-1", name: "general" }],
      }),
    );
    mockGetOrThrow.mockReturnValue({
      displayName: "Slack",
      sanitizeConfig: mockSanitizeConfig,
      strictResourceValidation: true,
    });

    await (handlePodBindIntegration as any)(
      CONNECTION_ID,
      CANVAS_ID,
      {
        podId: "pod-1",
        appId: "app-1",
        resourceId: "res-1",
        provider: "slack",
      },
      REQUEST_ID,
    );

    expect(mockAddIntegrationBinding).toHaveBeenCalledOnce();
    expect(mockEmitPodUpdated).toHaveBeenCalledOnce();
    expect(mockEmitError).not.toHaveBeenCalled();
  });
});

describe("handlePodUnbindIntegration", () => {
  const CANVAS_ID = "canvas-1";

  function makePodWithBinding(provider = "slack") {
    return {
      id: "pod-1",
      name: "Test Pod",
      provider: "claude",
      integrationBindings: [{ provider, appId: "app-1", resourceId: "res-1" }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleResultError.mockReturnValue(false);
    mockGetPodDisplayName.mockReturnValue("Test Pod");
  });

  it("Pod 無對應 provider 綁定時，emitError 並不呼叫 removeIntegrationBinding", async () => {
    const pod = makePodWithBinding("telegram");
    mockValidatePod.mockReturnValue(pod);

    await (handlePodUnbindIntegration as any)(
      CONNECTION_ID,
      CANVAS_ID,
      { podId: "pod-1", provider: "slack" },
      REQUEST_ID,
    );

    expect(mockEmitError).toHaveBeenCalledOnce();
    expect(mockRemoveIntegrationBinding).not.toHaveBeenCalled();
  });

  it("Pod 有對應 provider 綁定時，正確呼叫 unbind 流程並 emit 更新", async () => {
    const pod = makePodWithBinding("slack");
    mockValidatePod.mockReturnValue(pod);

    await (handlePodUnbindIntegration as any)(
      CONNECTION_ID,
      CANVAS_ID,
      { podId: "pod-1", provider: "slack" },
      REQUEST_ID,
    );

    expect(mockRemoveIntegrationBinding).toHaveBeenCalledOnce();
    expect(mockEmitPodUpdated).toHaveBeenCalledOnce();
    expect(mockEmitError).not.toHaveBeenCalled();
  });
});
