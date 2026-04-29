import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock 函式 ---
const mockEmitToConnection = vi.fn();

// mock socketService：攔截 emitToConnection 呼叫
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
  },
}));

// mock schemas：提供測試用的 event name 常數
vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    PROVIDER_LIST_RESULT: "provider:list:result",
  },
}));

// mock provider index：使用真實的 providerRegistry + getProvider（不 mock）
// 理由：handler 的職責是將 registry 的 metadata 轉換為 response payload；
// 若 mock 掉 getProvider 回傳假資料，則無法驗證 capabilities / defaultOptions 的正確性，
// 也無法捕捉 providerRegistry 被改動後 handler 輸出不一致的迴歸問題。
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  // 取得真實模組，直接回傳以驗證 capabilities / defaultOptions 常數
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return {
    providerRegistry: actual.providerRegistry,
    getProvider: actual.getProvider,
  };
});

const { handleProviderList } =
  await import("../../src/handlers/providerHandlers.js");

const { providerRegistry } =
  await import("../../src/services/provider/index.js");

const CONNECTION_ID = "conn-test-1";
const REQUEST_ID = "req-test-1";

beforeEach(() => {
  vi.clearAllMocks();
});

// ================================================================
// handleProviderList
// ================================================================
describe("handleProviderList", () => {
  it("收到 provider:list 請求後，應呼叫 emitToConnection 一次並帶 provider:list:result 事件", async () => {
    // 執行 handler
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    // 應只呼叫一次
    expect(mockEmitToConnection).toHaveBeenCalledTimes(1);

    // 第一個參數：connectionId
    expect(mockEmitToConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      "provider:list:result",
      expect.objectContaining({ success: true }),
    );
  });

  it("response payload 應包含 providers 陣列", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];

    // providers 應是陣列且不為空
    expect(Array.isArray(payload.providers)).toBe(true);
    expect(payload.providers.length).toBeGreaterThan(0);

    // 每個 provider 應包含 name、capabilities、defaultOptions 以及 availableModels
    for (const provider of payload.providers) {
      expect(provider).toHaveProperty("name");
      expect(provider).toHaveProperty("capabilities");
      expect(provider).toHaveProperty("defaultOptions");
      expect(provider).toHaveProperty("availableModels");
      expect(Array.isArray(provider.availableModels)).toBe(true);
    }
  });

  it("每個 provider 的 availableModels 應與該 provider metadata.availableModels 完全一致", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];

    // 逐一比對 payload.providers 與 registry 對應的 metadata.availableModels
    for (const provider of payload.providers) {
      const expected =
        providerRegistry[provider.name as keyof typeof providerRegistry]
          .metadata.availableModels;
      expect(provider.availableModels).toEqual(expected);
    }
  });

  it("claude 的 capabilities 全部為 true", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];
    const claude = payload.providers.find(
      (p: { name: string }) => p.name === "claude",
    );

    // claude provider 必須存在
    expect(claude).toBeDefined();

    const caps = claude.capabilities;
    // 所有能力欄位皆應為 true（runMode 已移除）
    expect(caps.chat).toBe(true);
    expect(caps.plugin).toBe(true);
    expect(caps.repository).toBe(true);
    expect(caps.command).toBe(true);
    expect(caps.mcp).toBe(true);
  });

  it("codex 的 capabilities 中 chat=true、command=true、repository=true、plugin=true、mcp=true", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];
    const codex = payload.providers.find(
      (p: { name: string }) => p.name === "codex",
    );

    // codex provider 必須存在
    expect(codex).toBeDefined();

    const caps = codex.capabilities;
    // chat、command、repository、plugin、mcp 為 true；runMode 已移除
    expect(caps.chat).toBe(true);
    expect(caps.plugin).toBe(true);
    expect(caps.repository).toBe(true);
    expect(caps.command).toBe(true);
    expect(caps.mcp).toBe(true);
  });

  it("claude 的 defaultOptions.model 應與 providerRegistry.claude.metadata.defaultOptions.model 一致", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];
    const claude = payload.providers.find(
      (p: { name: string }) => p.name === "claude",
    );

    // claude provider 必須存在且 defaultOptions 含 model
    expect(claude).toBeDefined();
    expect(claude.defaultOptions).toBeDefined();
    expect(claude.defaultOptions.model).toBe(
      providerRegistry.claude.metadata.defaultOptions.model,
    );
  });

  it("codex 的 defaultOptions.model 應與 providerRegistry.codex.metadata.defaultOptions.model 一致", async () => {
    await handleProviderList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];
    const codex = payload.providers.find(
      (p: { name: string }) => p.name === "codex",
    );

    // codex provider 必須存在且 defaultOptions 含 model
    expect(codex).toBeDefined();
    expect(codex.defaultOptions).toBeDefined();
    expect(codex.defaultOptions.model).toBe(
      providerRegistry.codex.metadata.defaultOptions.model,
    );
  });

  it("response payload 應帶回 request 的 requestId 供 RPC 對應", async () => {
    const specificRequestId = "rpc-correlate-abc123";

    await handleProviderList(
      CONNECTION_ID,
      { requestId: specificRequestId },
      specificRequestId,
    );

    const [, , payload] = mockEmitToConnection.mock.calls[0];

    // requestId 必須與 request 帶入的值一致
    expect(payload.requestId).toBe(specificRequestId);
  });
});
