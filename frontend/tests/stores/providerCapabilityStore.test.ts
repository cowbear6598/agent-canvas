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
  plugin: false,
  repository: true,
  command: true,
  mcp: true,
};

/** 測試用 Codex capabilities（chat + command + plugin 開啟） */
const CODEX_TEST_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: false,
  command: true,
  mcp: false,
};

/** 保守 fallback（找不到 provider 時應回傳的值） */
const CONSERVATIVE_FALLBACK = {
  chat: true,
  plugin: false,
  repository: false,
  command: false,
  mcp: false,
};

describe("providerCapabilityStore", () => {
  // 每次測試前重置 Pinia、WebSocket mock、所有 spy
  setupStoreTest();

  // ----------------------------------------------------------------
  // 初始 State
  // ----------------------------------------------------------------
  describe("初始狀態", () => {
    it("各欄位應有正確預設值", () => {
      const store = useProviderCapabilityStore();

      expect(store.loaded).toBe(false);
      expect(store.capabilitiesByProvider).toEqual({});
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
          capabilities: { ...CODEX_TEST_CAPABILITIES, mcp: true },
        },
      ]);

      expect(store.capabilitiesByProvider["codex"]!.mcp).toBe(true);
    });

    it("多筆 providers 應全部寫入 state", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: { ...CLAUDE_TEST_CAPABILITIES, plugin: true },
        },
        {
          name: "codex",
          capabilities: { ...CODEX_TEST_CAPABILITIES, chat: false },
        },
      ]);

      expect(store.capabilitiesByProvider["claude"]!.plugin).toBe(true);
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

      expect(store.isCapabilityEnabled("codex", "mcp")).toBe(false);
    });

    it("寫入後 isCapabilityEnabled('claude', 'plugin') 應回正確值", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: { ...CLAUDE_TEST_CAPABILITIES, plugin: true },
        },
      ]);

      expect(store.isCapabilityEnabled("claude", "plugin")).toBe(true);
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
            capabilities: { ...CODEX_TEST_CAPABILITIES, mcp: true },
          },
        ],
      });

      await store.loadFromBackend();

      expect(store.loaded).toBe(true);
      expect(store.capabilitiesByProvider["codex"]!.mcp).toBe(true);
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

  // ----------------------------------------------------------------
  // availableModels — syncFromPayload / getAvailableModels（Phase 3 新增）
  // ----------------------------------------------------------------
  describe("availableModels 寫入與讀取", () => {
    it("syncFromPayload 帶入含 availableModels 的 providers 後，getAvailableModels 應分別回傳對應清單", () => {
      const store = useProviderCapabilityStore();

      const claudeModels = [
        { label: "Claude Opus 4.5", value: "claude-opus-4-5" },
        { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
      ];
      const codexModels = [
        { label: "GPT-5.4", value: "gpt-5.4" },
        { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      ];

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: claudeModels,
        },
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          availableModels: codexModels,
        },
      ]);

      // 斷言 label / value 完整對上
      expect(store.getAvailableModels("claude")).toEqual(claudeModels);
      expect(store.getAvailableModels("codex")).toEqual(codexModels);
    });

    it("getAvailableModels 傳入未知 provider 時應回傳空陣列", () => {
      const store = useProviderCapabilityStore();

      // 未載入任何 payload：未知 provider
      expect(store.getAvailableModels("unknown")).toEqual([]);

      // 載入部分 provider 後，另一個未聲告的 provider 仍回空陣列
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            { label: "Claude Opus 4.5", value: "claude-opus-4-5" },
          ],
        },
      ]);

      expect(store.getAvailableModels("unknown")).toEqual([]);
      expect(store.getAvailableModels("codex")).toEqual([]);
    });

    it("loadFromBackend 成功後，availableModelsByProvider 內應包含預期的 provider 與 availableModels", async () => {
      const store = useProviderCapabilityStore();

      const claudeModels = [
        { label: "Claude Opus 4.5", value: "claude-opus-4-5" },
        { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
      ];
      const codexModels = [{ label: "GPT-5.4", value: "gpt-5.4" }];

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        providers: [
          {
            name: "claude",
            capabilities: CLAUDE_TEST_CAPABILITIES,
            availableModels: claudeModels,
          },
          {
            name: "codex",
            capabilities: CODEX_TEST_CAPABILITIES,
            availableModels: codexModels,
          },
        ],
      });

      await store.loadFromBackend();

      expect(store.availableModelsByProvider["claude"]).toEqual(claudeModels);
      expect(store.availableModelsByProvider["codex"]).toEqual(codexModels);
      // 同時透過 getter 再次驗證
      expect(store.getAvailableModels("claude")).toEqual(claudeModels);
      expect(store.getAvailableModels("codex")).toEqual(codexModels);
    });
  });

  // ----------------------------------------------------------------
  // isModelValidForProvider getter（Phase 4 新增）
  // ----------------------------------------------------------------
  describe("isModelValidForProvider", () => {
    it("provider 已知 + model 合法 → true", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            { label: "Sonnet", value: "sonnet" },
            { label: "Opus", value: "opus" },
          ],
        },
      ]);

      expect(store.isModelValidForProvider("claude", "sonnet")).toBe(true);
      expect(store.isModelValidForProvider("claude", "opus")).toBe(true);
    });

    it("provider 已知 + model 不在清單 → false", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [{ label: "Sonnet", value: "sonnet" }],
        },
      ]);

      expect(store.isModelValidForProvider("claude", "gpt-5.4")).toBe(false);
      expect(store.isModelValidForProvider("claude", "unknown-model")).toBe(
        false,
      );
    });

    it("provider 未知（未收到 metadata）→ false", () => {
      const store = useProviderCapabilityStore();

      // 未 syncFromPayload，store 為空
      expect(
        store.isModelValidForProvider("unknown-provider", "some-model"),
      ).toBe(false);
    });

    it("provider 已知但 availableModels 為空 → false", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [],
        },
      ]);

      expect(store.isModelValidForProvider("claude", "sonnet")).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // getDefaultModel getter（Phase 4 新增）
  // ----------------------------------------------------------------
  describe("getDefaultModel", () => {
    it("provider 已知 → 回傳 availableModels 第一筆的 value", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
          ],
        },
      ]);

      expect(store.getDefaultModel("claude")).toBe("opus");
    });

    it("provider 已知（codex）→ 回傳 codex availableModels 第一筆的 value", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          availableModels: [
            { label: "GPT-5.4", value: "gpt-5.4" },
            { label: "GPT-5.5", value: "gpt-5.5" },
          ],
        },
      ]);

      expect(store.getDefaultModel("codex")).toBe("gpt-5.4");
    });

    it("provider 未知 → 回傳 undefined", () => {
      const store = useProviderCapabilityStore();

      expect(store.getDefaultModel("unknown-provider")).toBeUndefined();
    });

    it("provider 已知但 availableModels 為空 → 回傳 undefined", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [],
        },
      ]);

      expect(store.getDefaultModel("claude")).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // thinking metadata（Phase 6 新增）
  // ----------------------------------------------------------------
  describe("thinking metadata getters", () => {
    // [B-4] syncFromPayload 寫入帶 thinkingLevels + defaultThinkingLevel 的 model 後，
    // getSupportedThinkingLevels 應回傳該陣列
    it("[B-4] syncFromPayload 寫入支援 thinking 的 model 後 getSupportedThinkingLevels 應回傳對應陣列", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            {
              label: "Sonnet",
              value: "sonnet",
              thinkingLevels: ["low", "medium", "high"],
              defaultThinkingLevel: "medium",
            },
          ],
        },
      ]);

      expect(store.getSupportedThinkingLevels("claude", "sonnet")).toEqual([
        "low",
        "medium",
        "high",
      ]);
    });

    // [B-5] 一個 model 沒有 thinking 欄位時，getSupportedThinkingLevels 應回空陣列
    it("[B-5] model 無 thinking 欄位時 getSupportedThinkingLevels 應回空陣列", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            // 不帶 thinkingLevels / defaultThinkingLevel，模擬 Haiku 等不支援 thinking 的 model
            { label: "Haiku", value: "haiku" },
          ],
        },
      ]);

      expect(store.getSupportedThinkingLevels("claude", "haiku")).toEqual([]);
    });

    // [B-6] getDefaultThinkingLevel 對支援的 model 回傳對應值，不支援的 model 回 undefined
    it("[B-6] getDefaultThinkingLevel 應回傳對應值，不支援的 model 回 undefined", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            {
              label: "Sonnet",
              value: "sonnet",
              thinkingLevels: ["low", "medium", "high"],
              defaultThinkingLevel: "medium",
            },
            // 不支援 thinking 的 model
            { label: "Haiku", value: "haiku" },
          ],
        },
      ]);

      // 支援的 model 應回傳預設值
      expect(store.getDefaultThinkingLevel("claude", "sonnet")).toBe("medium");
      // 不支援 thinking 的 model 應回 undefined
      expect(store.getDefaultThinkingLevel("claude", "haiku")).toBeUndefined();
      // 未知 provider 也應回 undefined
      expect(
        store.getDefaultThinkingLevel("unknown", "sonnet"),
      ).toBeUndefined();
    });

    // [B-7] isThinkingSupportedForModel 對支援的 model 回 true、不支援的 model 回 false
    it("[B-7] isThinkingSupportedForModel 對支援的 model 回 true，不支援回 false", () => {
      const store = useProviderCapabilityStore();

      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            {
              label: "Sonnet",
              value: "sonnet",
              thinkingLevels: ["low", "medium", "high"],
              defaultThinkingLevel: "medium",
            },
            { label: "Haiku", value: "haiku" },
          ],
        },
      ]);

      expect(store.isThinkingSupportedForModel("claude", "sonnet")).toBe(true);
      expect(store.isThinkingSupportedForModel("claude", "haiku")).toBe(false);
      // 未知 provider / model 也回 false
      expect(store.isThinkingSupportedForModel("unknown", "sonnet")).toBe(
        false,
      );
    });
  });

  // ----------------------------------------------------------------
  // 重連行為：state 覆蓋不累積；先成功再失敗時保留上次成功值
  // ----------------------------------------------------------------
  describe("重連行為", () => {
    it("重連後 syncFromPayload 再次呼叫時，state 覆蓋而非累積（舊 provider 被新資料取代）", () => {
      const store = useProviderCapabilityStore();

      // 第一次載入：claude + codex
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: CLAUDE_TEST_CAPABILITIES,
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
          ],
        },
        {
          name: "codex",
          capabilities: CODEX_TEST_CAPABILITIES,
          availableModels: [{ label: "GPT-5.4", value: "gpt-5.4" }],
        },
      ]);

      // 第二次載入（重連後）：僅送 claude，model 清單縮減為一個
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: { ...CLAUDE_TEST_CAPABILITIES, chat: false },
          availableModels: [{ label: "Sonnet", value: "sonnet" }],
        },
      ]);

      // claude 的 capabilities 應被覆蓋（不累積舊值）
      expect(store.getCapabilities("claude").chat).toBe(false);
      // claude 的 availableModels 應被覆蓋為新清單
      expect(store.getAvailableModels("claude")).toEqual([
        { label: "Sonnet", value: "sonnet" },
      ]);
      // codex 的資料應保留上一次成功的值（第二次未送 codex）
      expect(store.getAvailableModels("codex")).toEqual([
        { label: "GPT-5.4", value: "gpt-5.4" },
      ]);
    });

    it("先成功載入再失敗時，保留上次成功的 availableModelsByProvider", async () => {
      const store = useProviderCapabilityStore();

      const claudeModels = [
        { label: "Opus", value: "opus" },
        { label: "Sonnet", value: "sonnet" },
      ];

      // 第一次：成功
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        providers: [
          {
            name: "claude",
            capabilities: CLAUDE_TEST_CAPABILITIES,
            availableModels: claudeModels,
          },
        ],
      });
      await store.loadFromBackend();
      expect(store.getAvailableModels("claude")).toEqual(claudeModels);
      expect(store.loaded).toBe(true);

      // 第二次：失敗（模擬重連時 WebSocket 超時）
      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("重連超時"));
      await store.loadFromBackend();

      // loaded 仍為 true（上次成功設定的值不被清除）
      expect(store.loaded).toBe(true);
      // availableModelsByProvider 保留上次成功的值，不因失敗而被清空
      expect(store.getAvailableModels("claude")).toEqual(claudeModels);
    });
  });
});
