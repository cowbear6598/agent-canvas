import { describe, it, expect, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

// Mock WebSocket（保留真實事件常數）
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast，存取 toast spy 供斷言使用
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

/** 測試用 Claude capabilities（全功能開啟） */
const CLAUDE_TEST_CAPABILITIES = {
  chat: true,
  outputStyle: true,
  skill: true,
  subAgent: true,
  repository: true,
  command: true,
  mcp: true,
  integration: true,
  runMode: true,
};

/** 測試用 Codex capabilities（僅 chat） */
const CODEX_TEST_CAPABILITIES = {
  chat: true,
  outputStyle: false,
  skill: false,
  subAgent: false,
  repository: false,
  command: false,
  mcp: false,
  integration: false,
  runMode: false,
};

/** 保守 fallback（找不到 provider 時應回傳的值） */
const CONSERVATIVE_FALLBACK = {
  chat: true,
  outputStyle: false,
  skill: false,
  subAgent: false,
  repository: false,
  command: false,
  mcp: false,
  integration: false,
  runMode: false,
};

describe("providerCapabilityStore", () => {
  // 每次測試前重置 Pinia、WebSocket mock、所有 spy
  setupStoreTest();

  // ----------------------------------------------------------------
  // 初始 State
  // ----------------------------------------------------------------
  describe("初始狀態", () => {
    it("loaded 應為 false", () => {
      const store = useProviderCapabilityStore();

      expect(store.loaded).toBe(false);
    });

    it("capabilitiesByProvider 初值應為空物件（不含 hardcode claude/codex）", () => {
      const store = useProviderCapabilityStore();

      expect(store.capabilitiesByProvider).toEqual({});
    });

    it("defaultOptionsByProvider 初值應為空物件", () => {
      const store = useProviderCapabilityStore();

      expect(store.defaultOptionsByProvider).toEqual({});
    });
  });

  // ----------------------------------------------------------------
  // syncFromPayload — capabilities 寫入
  // ----------------------------------------------------------------
  describe("syncFromPayload（capabilities 寫入）", () => {
    it("應將傳入的 providers 陣列寫入 capabilitiesByProvider", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "codex",
          capabilities: { ...CODEX_TEST_CAPABILITIES, runMode: true },
        },
      ]);

      expect(store.capabilitiesByProvider["codex"]!.runMode).toBe(true);
    });

    it("多筆 providers 應全部寫入 state", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: { ...CLAUDE_TEST_CAPABILITIES, skill: false },
        },
        {
          name: "codex",
          capabilities: { ...CODEX_TEST_CAPABILITIES, chat: false },
        },
      ]);

      expect(store.capabilitiesByProvider["claude"]!.skill).toBe(false);
      expect(store.capabilitiesByProvider["codex"]!.chat).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // syncFromPayload — defaultOptions 寫入（Phase 2 新增）
  // ----------------------------------------------------------------
  describe("syncFromPayload（defaultOptions 寫入）", () => {
    it("payload 帶有 defaultOptions 時，應正確寫入 defaultOptionsByProvider", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          defaultOptions: { model: "claude-opus-4-5" },
        },
      ]);

      expect(store.defaultOptionsByProvider["claude"]).toEqual({
        model: "claude-opus-4-5",
      });
    });

    it("payload 未帶 defaultOptions 時，應寫入 {} 而非 undefined（graceful degradation）", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          // 刻意不帶 defaultOptions，模擬後端 Phase 6 前的狀態
        },
      ]);

      expect(store.defaultOptionsByProvider["codex"]).toEqual({});
    });

    it("同時傳入兩個 provider 時，兩者的 defaultOptions 都應正確寫入", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          defaultOptions: { model: "claude-sonnet-4-5" },
        },
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          defaultOptions: { model: "gpt-5.4" },
        },
      ]);

      expect(store.defaultOptionsByProvider["claude"]).toEqual({
        model: "claude-sonnet-4-5",
      });
      expect(store.defaultOptionsByProvider["codex"]).toEqual({
        model: "gpt-5.4",
      });
    });
  });

  // ----------------------------------------------------------------
  // getDefaultOptions getter（Phase 2 新增）
  // ----------------------------------------------------------------
  describe("getDefaultOptions", () => {
    it("syncFromPayload 寫入後 getDefaultOptions('claude') 可讀回正確值", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          defaultOptions: { model: "claude-opus-4-5" },
        },
      ]);

      expect(store.getDefaultOptions("claude")).toEqual({
        model: "claude-opus-4-5",
      });
    });

    it("syncFromPayload 寫入後 getDefaultOptions('codex') 可讀回正確值", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          defaultOptions: { model: "gpt-5.4" },
        },
      ]);

      expect(store.getDefaultOptions("codex")).toEqual({ model: "gpt-5.4" });
    });

    it("未寫入時 getDefaultOptions('unknown') 應回 undefined", () => {
      const store = useProviderCapabilityStore();

      expect(store.getDefaultOptions("unknown")).toBeUndefined();
    });

    it("寫入但後端未帶 defaultOptions 時，getDefaultOptions 應回 {}（而非 undefined）", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          // 刻意不帶 defaultOptions
        },
      ]);

      expect(store.getDefaultOptions("claude")).toEqual({});
    });
  });

  // ----------------------------------------------------------------
  // isKnownProvider getter（Phase 2 新增）
  // ----------------------------------------------------------------
  describe("isKnownProvider", () => {
    it("metadata 載入前 isKnownProvider('claude') 應為 false", () => {
      const store = useProviderCapabilityStore();

      expect(store.isKnownProvider("claude")).toBe(false);
    });

    it("syncFromPayload 寫入後 isKnownProvider('claude') 應為 true", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "claude", capabilities: CLAUDE_TEST_CAPABILITIES },
      ]);

      expect(store.isKnownProvider("claude")).toBe(true);
    });

    it("isKnownProvider('unknown-provider') 應永遠為 false", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "claude", capabilities: CLAUDE_TEST_CAPABILITIES },
        { name: "codex", capabilities: CODEX_TEST_CAPABILITIES },
      ]);

      expect(store.isKnownProvider("unknown-provider")).toBe(false);
    });

    it("只寫入 codex 後，isKnownProvider('claude') 仍為 false", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "codex", capabilities: CODEX_TEST_CAPABILITIES },
      ]);

      expect(store.isKnownProvider("claude")).toBe(false);
      expect(store.isKnownProvider("codex")).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // getCapabilities getter — 保守 fallback（Phase 2 新增）
  // ----------------------------------------------------------------
  describe("getCapabilities（保守 fallback）", () => {
    it("找不到 provider 時應回保守 fallback（chat: true，其餘 false），不拋錯", () => {
      const store = useProviderCapabilityStore();

      const caps = store.getCapabilities("unknown");

      expect(caps).toEqual(CONSERVATIVE_FALLBACK);
    });

    it("未載入任何 metadata 時 getCapabilities('claude') 亦回保守 fallback", () => {
      const store = useProviderCapabilityStore();

      const caps = store.getCapabilities("claude");

      expect(caps).toEqual(CONSERVATIVE_FALLBACK);
    });

    it("syncFromPayload 寫入後 getCapabilities 應取回正確 capabilities", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "codex", capabilities: CODEX_TEST_CAPABILITIES },
      ]);

      expect(store.getCapabilities("codex")).toEqual(CODEX_TEST_CAPABILITIES);
    });

    it("syncFromPayload 寫入後 getCapabilities('claude') 應取回 claude 的 capabilities", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "claude", capabilities: CLAUDE_TEST_CAPABILITIES },
      ]);

      expect(store.getCapabilities("claude")).toEqual(CLAUDE_TEST_CAPABILITIES);
    });
  });

  // ----------------------------------------------------------------
  // isCapabilityEnabled getter
  // ----------------------------------------------------------------
  describe("isCapabilityEnabled", () => {
    it("provider 未寫入時 isCapabilityEnabled 應回 false", () => {
      const store = useProviderCapabilityStore();

      expect(store.isCapabilityEnabled("codex", "runMode")).toBe(false);
    });

    it("寫入後 isCapabilityEnabled('claude', 'skill') 應回正確值", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "claude", capabilities: CLAUDE_TEST_CAPABILITIES },
      ]);

      expect(store.isCapabilityEnabled("claude", "skill")).toBe(true);
    });

    it("寫入後 isCapabilityEnabled('codex', 'chat') 應回 true", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        { name: "codex", capabilities: CODEX_TEST_CAPABILITIES },
      ]);

      expect(store.isCapabilityEnabled("codex", "chat")).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // loadFromBackend — 成功路徑
  // ----------------------------------------------------------------
  describe("loadFromBackend 成功路徑", () => {
    it("應以後端回傳的 providers 呼叫 syncFromPayload，且 loaded 變為 true", async () => {
      const store = useProviderCapabilityStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        providers: [
          {
            name: "codex",
            capabilities: { ...CODEX_TEST_CAPABILITIES, runMode: true },
          },
        ],
      });

      await store.loadFromBackend();

      expect(store.loaded).toBe(true);
      expect(store.capabilitiesByProvider["codex"]!.runMode).toBe(true);
    });

    it("後端回傳含 defaultOptions 時應寫入 defaultOptionsByProvider", async () => {
      const store = useProviderCapabilityStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        providers: [
          {
            name: "claude",
            capabilities: CLAUDE_TEST_CAPABILITIES,
            defaultOptions: { model: "claude-opus-4-5" },
          },
        ],
      });

      await store.loadFromBackend();

      expect(store.getDefaultOptions("claude")).toEqual({
        model: "claude-opus-4-5",
      });
    });

    it("後端回傳空 providers 陣列時，loaded 仍應變為 true，state 維持空物件", async () => {
      const store = useProviderCapabilityStore();

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        providers: [],
      });

      await store.loadFromBackend();

      expect(store.loaded).toBe(true);
      // 空陣列不寫入 state，維持初始空物件
      expect(store.capabilitiesByProvider).toEqual({});
      expect(store.defaultOptionsByProvider).toEqual({});
    });
  });

  // ----------------------------------------------------------------
  // loadFromBackend — 失敗路徑
  // ----------------------------------------------------------------
  describe("loadFromBackend 失敗路徑", () => {
    it("createWebSocketRequest reject 時，toast 應被呼叫，loaded 維持 false", async () => {
      const store = useProviderCapabilityStore();

      mockCreateWebSocketRequest.mockRejectedValueOnce(
        new Error("WebSocket 連線失敗"),
      );

      await store.loadFromBackend();

      expect(store.loaded).toBe(false);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
        }),
      );
    });

    it("失敗後 capabilitiesByProvider 與 defaultOptionsByProvider 應維持空物件", async () => {
      const store = useProviderCapabilityStore();

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("網路逾時"));

      await store.loadFromBackend();

      expect(store.capabilitiesByProvider).toEqual({});
      expect(store.defaultOptionsByProvider).toEqual({});
    });
  });
});
