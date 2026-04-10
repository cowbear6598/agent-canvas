import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { IntegrationApp } from "../../src/services/integration/types.js";

const mockEmitToAll = vi.fn();
const mockEmitError = vi.fn();
const mockGetOrThrow = vi.fn();
const mockCreate = vi.fn();
const mockGetById = vi.fn();
const mockLoggerLog = vi.fn();
const mockLoggerError = vi.fn();
const mockHandleResultError = vi.fn().mockReturnValue(false);
const mockInitialize = vi.fn();
const mockSanitizeConfig = vi.fn().mockReturnValue({});

vi.mock("../../src/services/socketService.js", () => ({
  socketService: { emitToAll: mockEmitToAll },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
  emitNotFound: vi.fn(),
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
    getById: mockGetById,
    delete: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: mockLoggerLog, warn: vi.fn(), error: mockLoggerError },
}));

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  handleResultError: mockHandleResultError,
  emitPodUpdated: vi.fn(),
  getPodDisplayName: vi.fn(),
  validatePod: vi.fn(),
  withCanvasId: (_event: unknown, handler: unknown) => handler,
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: { findByIntegrationApp: vi.fn().mockReturnValue([]) },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    INTEGRATION_APP_CREATED: "integration:appCreated",
    INTEGRATION_APP_DELETED: "integration:appDeleted",
  },
}));

vi.mock("../../src/utils/errorHelpers.js", () => ({
  getErrorMessage: (e: unknown) => String(e),
}));

const { handleIntegrationAppCreate } =
  await import("../../src/handlers/integrationHandlers.js");

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
    mockGetById.mockReturnValue(initialApp);

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
    mockGetById.mockReturnValue(initialApp);

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
    mockGetById.mockReturnValue(initialApp);

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
});
