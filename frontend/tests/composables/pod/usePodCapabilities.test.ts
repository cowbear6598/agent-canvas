import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, nextTick } from "vue";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { createMockPod } from "../../helpers/factories";

// mock WebSocket，避免 providerCapabilityStore 的 loadFromBackend 觸發真實連線
vi.mock("@/services/websocket", async () => {
  const actual = await vi.importActual<typeof import("@/services/websocket")>(
    "@/services/websocket",
  );
  return {
    ...actual,
    createWebSocketRequest: vi.fn().mockResolvedValue({ providers: [] }),
  };
});

// mock useToast，避免 providerCapabilityStore 嘗試建立 toast 實例
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

/** Phase 2 後，完整的 Claude capabilities（需由 syncFromPayload 注入） */
const CLAUDE_FULL_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: true,
  command: true,
  mcp: true,
};

/** Phase 2 後，Gemini 的 capabilities（需由 syncFromPayload 注入）。與後端 GEMINI_CAPABILITIES 一致 */
const GEMINI_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: true,
  command: true,
  mcp: false,
};

/** Phase 2 後，Codex 的 capabilities（需由 syncFromPayload 注入）。與後端 CODEX_CAPABILITIES 一致，所有欄位皆為 true */
const CODEX_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: true,
  command: true,
  mcp: true,
};

/**
 * Phase 2 保守 fallback：metadata 未載入時所有 provider 的預設值。
 * getCapabilities 找不到 provider 時回傳此值。
 */
const CONSERVATIVE_FALLBACK = {
  chat: true,
  plugin: false,
  repository: false,
  command: false,
  mcp: false,
};

describe("usePodCapabilities", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  // ─── 輔助：注入 Pod 與 capabilities 到 store ───────────────────────────────

  /**
   * 將指定 provider 的 Pod 加入 podStore，並回傳對應 podId ref。
   * Phase 2 後 capabilitiesByProvider 初值為空物件，
   * 若需要完整能力需另行呼叫 syncFromPayload。
   */
  function setupPod(
    provider: "claude" | "codex" | "gemini",
    podId = "pod-test",
  ) {
    const podStore = usePodStore();
    const pod = createMockPod({ id: podId, provider });
    podStore.pods = [pod];
    return ref(podId);
  }

  /**
   * 注入完整的 claude + codex + gemini capabilities 到 store。
   * 模擬後端 metadata 已成功載入的狀態。
   */
  function injectAllCapabilities() {
    const capabilityStore = useProviderCapabilityStore();
    capabilityStore.syncFromPayload([
      { name: "claude", capabilities: CLAUDE_FULL_CAPABILITIES },
      { name: "codex", capabilities: CODEX_CAPABILITIES },
      { name: "gemini", capabilities: GEMINI_CAPABILITIES },
    ]);
  }

  // ─── Case 1：Codex Pod ─────────────────────────────────────────────────────

  describe("Codex Pod", () => {
    it("isCodex 應為 true", () => {
      const podId = setupPod("codex");
      const { isCodex } = usePodCapabilities(podId);

      expect(isCodex.value).toBe(true);
    });

    it("isPluginEnabled 應為 true（Codex 支援 plugin）", () => {
      injectAllCapabilities();
      const podId = setupPod("codex");
      const { isPluginEnabled } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
    });

    it("isRepositoryEnabled 應為 true（Codex 與 Claude 行為一致）", () => {
      injectAllCapabilities();
      const podId = setupPod("codex");
      const { isRepositoryEnabled } = usePodCapabilities(podId);

      expect(isRepositoryEnabled.value).toBe(true);
    });

    it("isCommandEnabled 應為 true（codex 已開放 command）", () => {
      injectAllCapabilities();
      const podId = setupPod("codex");
      const { isCommandEnabled } = usePodCapabilities(podId);

      expect(isCommandEnabled.value).toBe(true);
    });

    it("isMcpEnabled 應為 true（Codex 與 Claude 行為一致）", () => {
      injectAllCapabilities();
      const podId = setupPod("codex");
      const { isMcpEnabled } = usePodCapabilities(podId);

      expect(isMcpEnabled.value).toBe(true);
    });

    it("capabilities 應等於 Codex capabilities（從 store 讀取）", () => {
      injectAllCapabilities();
      const podId = setupPod("codex");
      const { capabilities } = usePodCapabilities(podId);

      expect(capabilities.value).toEqual(CODEX_CAPABILITIES);
    });
  });

  // ─── Case 2：Claude Pod ────────────────────────────────────────────────────

  describe("Claude Pod", () => {
    it("isCodex 應為 false", () => {
      const podId = setupPod("claude");
      const { isCodex } = usePodCapabilities(podId);

      expect(isCodex.value).toBe(false);
    });

    it("metadata 載入後所有 isXxxEnabled 應皆為 true", () => {
      injectAllCapabilities();
      const podId = setupPod("claude");
      const {
        isPluginEnabled,
        isRepositoryEnabled,
        isCommandEnabled,
        isMcpEnabled,
      } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
      expect(isRepositoryEnabled.value).toBe(true);
      expect(isCommandEnabled.value).toBe(true);
      expect(isMcpEnabled.value).toBe(true);
    });

    it("capabilities 應等於 Claude full capabilities（從 store 讀取）", () => {
      injectAllCapabilities();
      const podId = setupPod("claude");
      const { capabilities } = usePodCapabilities(podId);

      expect(capabilities.value).toEqual(CLAUDE_FULL_CAPABILITIES);
    });
  });

  // ─── Case 3：Pod 不存在 ────────────────────────────────────────────────────

  describe("Pod 不存在時", () => {
    it("isCodex 應為 false（provider 不是 codex）", () => {
      const podId = ref("non-existent-pod");
      const { isCodex } = usePodCapabilities(podId);

      // pod 不存在 → pod?.provider === 'codex' 為 false
      expect(isCodex.value).toBe(false);
    });

    it("capabilities 應 fallback 到保守值（metadata 未載入時回保守 fallback）", () => {
      const podId = ref("non-existent-pod");
      const { capabilities } = usePodCapabilities(podId);

      // Phase 2：metadata 未載入，getCapabilities 回保守 fallback（chat: true 其餘 false）
      expect(capabilities.value).toEqual(CONSERVATIVE_FALLBACK);
    });

    it("metadata 未載入時所有 isXxxEnabled 皆為 false（保守 fallback）", () => {
      const podId = ref("non-existent-pod");
      const {
        isPluginEnabled,
        isRepositoryEnabled,
        isCommandEnabled,
        isMcpEnabled,
      } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(false);
      expect(isRepositoryEnabled.value).toBe(false);
      expect(isCommandEnabled.value).toBe(false);
      expect(isMcpEnabled.value).toBe(false);
    });
  });

  // ─── Case 4：podId 變動時 reactivity ───────────────────────────────────────

  describe("podId 變動時 computed 應重新計算", () => {
    it("從 claude Pod 切換到 codex Pod 後，isCodex 應從 false 變為 true", async () => {
      injectAllCapabilities();
      const podStore = usePodStore();
      const claudePod = createMockPod({ id: "pod-claude", provider: "claude" });
      const codexPod = createMockPod({ id: "pod-codex", provider: "codex" });
      podStore.pods = [claudePod, codexPod];

      const podId = ref("pod-claude");
      const { isCodex } = usePodCapabilities(podId);

      // 初始為 claude → isCodex false
      expect(isCodex.value).toBe(false);

      // 切換到 codex pod
      podId.value = "pod-codex";
      await nextTick();

      expect(isCodex.value).toBe(true);
    });

    it("從 codex Pod 切換到 claude Pod 後，isPluginEnabled 應維持 true（兩者皆支援）", async () => {
      injectAllCapabilities();
      const podStore = usePodStore();
      const claudePod = createMockPod({ id: "pod-claude", provider: "claude" });
      const codexPod = createMockPod({ id: "pod-codex", provider: "codex" });
      podStore.pods = [claudePod, codexPod];

      const podId = ref("pod-codex");
      const { isPluginEnabled } = usePodCapabilities(podId);

      // 初始為 codex → isPluginEnabled true（codex 支援 plugin）
      expect(isPluginEnabled.value).toBe(true);

      // 切換到 claude pod
      podId.value = "pod-claude";
      await nextTick();

      expect(isPluginEnabled.value).toBe(true);
    });

    it("從有效 Pod 切換到不存在的 podId，isCodex 變 false，capabilities 退回 claude fallback", async () => {
      injectAllCapabilities();
      const podStore = usePodStore();
      const codexPod = createMockPod({ id: "pod-codex", provider: "codex" });
      podStore.pods = [codexPod];

      const podId = ref("pod-codex");
      const { capabilities, isCodex } = usePodCapabilities(podId);

      // 初始為 codex
      expect(isCodex.value).toBe(true);
      expect(capabilities.value).toEqual(CODEX_CAPABILITIES);

      // 切換到不存在的 pod
      podId.value = "non-existent";
      await nextTick();

      // composable 在 pod 不存在時 provider fallback 到 "claude"（既有行為）
      // 因 claude metadata 已注入，capabilities 為完整 claude 能力
      expect(isCodex.value).toBe(false);
      expect(capabilities.value).toEqual(CLAUDE_FULL_CAPABILITIES);
    });
  });

  // ─── Case 5：capability store 變動時 reactivity ────────────────────────────

  describe("capability store 變動時 composable 應跟著反映", () => {
    it("syncFromPayload 將 claude 的 plugin 設為 false 後，isPluginEnabled 應變為 false", async () => {
      injectAllCapabilities();
      const podId = setupPod("claude");
      const capabilityStore = useProviderCapabilityStore();
      const { isPluginEnabled } = usePodCapabilities(podId);

      // metadata 已注入 → 初始 claude plugin: true
      expect(isPluginEnabled.value).toBe(true);

      // 模擬後端回傳 claude 功能表，將 plugin 關閉
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: { ...CLAUDE_FULL_CAPABILITIES, plugin: false },
        },
      ]);
      await nextTick();

      expect(isPluginEnabled.value).toBe(false);
    });

    it("syncFromPayload 更新 capabilities 後，整個 capabilities computed 應同步反映", async () => {
      injectAllCapabilities();
      const podId = setupPod("claude");
      const capabilityStore = useProviderCapabilityStore();
      const { capabilities } = usePodCapabilities(podId);

      // metadata 已注入 → 初始為完整 claude 能力
      expect(capabilities.value.mcp).toBe(true);

      // 後端回傳 mcp: false
      const updatedCapabilities = {
        ...CLAUDE_FULL_CAPABILITIES,
        mcp: false,
      };
      capabilityStore.syncFromPayload([
        { name: "claude", capabilities: updatedCapabilities },
      ]);
      await nextTick();

      expect(capabilities.value.mcp).toBe(false);
    });
  });

  // ─── Case 7：Gemini Pod ────────────────────────────────────────────────────

  describe("Gemini Pod", () => {
    // T-C2：Gemini provider → isCodex === false
    it("T-C2：isCodex 應為 false（Gemini 非 codex provider）", () => {
      const podId = setupPod("gemini");
      const { isCodex } = usePodCapabilities(podId);

      expect(isCodex.value).toBe(false);
    });

    // T-C1：Gemini + store capabilities 含 plugin: true → isPluginEnabled === true
    it("T-C1：store capabilities 含 plugin: true 時，isPluginEnabled 應為 true", () => {
      const capabilityStore = useProviderCapabilityStore();
      // 注入 gemini plugin: true（後端開放 plugin 給 gemini 時的狀態）
      capabilityStore.syncFromPayload([
        {
          name: "gemini",
          capabilities: { ...GEMINI_CAPABILITIES, plugin: true },
        },
      ]);
      const podId = setupPod("gemini");
      const { isPluginEnabled } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
    });

    it("metadata 已載入時 isRepositoryEnabled 應為 true（T6）", () => {
      injectAllCapabilities();
      const podId = setupPod("gemini");
      const { isRepositoryEnabled } = usePodCapabilities(podId);

      expect(isRepositoryEnabled.value).toBe(true);
    });

    it("metadata 已載入時 isCommandEnabled 應為 true（T1）", () => {
      injectAllCapabilities();
      const podId = setupPod("gemini");
      const { isCommandEnabled } = usePodCapabilities(podId);

      expect(isCommandEnabled.value).toBe(true);
    });

    it("metadata 已載入時 isPluginEnabled 應為 true（對齊後端 GEMINI_CAPABILITIES）", () => {
      injectAllCapabilities();
      const podId = setupPod("gemini");
      const { isPluginEnabled } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
    });

    it("metadata 已載入時 isMcpEnabled 應為 false（鎖死後端 GEMINI_CAPABILITIES）", () => {
      injectAllCapabilities();
      const podId = setupPod("gemini");
      const { isMcpEnabled } = usePodCapabilities(podId);

      expect(isMcpEnabled.value).toBe(false);
    });

    it("metadata 已載入時 capabilities 應完整等於 GEMINI_CAPABILITIES（從 store 讀取）", () => {
      injectAllCapabilities();
      const podId = setupPod("gemini");
      const { capabilities } = usePodCapabilities(podId);

      expect(capabilities.value).toEqual(GEMINI_CAPABILITIES);
    });

    it("metadata 未載入時 isRepositoryEnabled / isCommandEnabled 皆為 false（T13 保守 fallback）", () => {
      // 不呼叫 injectAllCapabilities，模擬 metadata 尚未載入
      const podId = setupPod("gemini");
      const { isRepositoryEnabled, isCommandEnabled } =
        usePodCapabilities(podId);

      expect(isRepositoryEnabled.value).toBe(false);
      expect(isCommandEnabled.value).toBe(false);
    });
  });

  // ─── Case 6：isPluginEnabled — 兩個 provider 皆支援 plugin ─────────────────

  describe("isPluginEnabled — claude 與 codex 皆可回傳 true", () => {
    it("Claude provider 的 isPluginEnabled 應為 true", () => {
      injectAllCapabilities();
      const podId = setupPod("claude");
      const { isPluginEnabled } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
    });

    it("Codex provider 的 isPluginEnabled 在 plugin:true 時應為 true", () => {
      const capabilityStore = useProviderCapabilityStore();
      // 注入 codex plugin: true（後端開放 plugin 給 codex 時的狀態）
      capabilityStore.syncFromPayload([
        {
          name: "codex",
          capabilities: { ...CODEX_CAPABILITIES, plugin: true },
        },
      ]);
      const podId = setupPod("codex");
      const { isPluginEnabled } = usePodCapabilities(podId);

      expect(isPluginEnabled.value).toBe(true);
    });
  });
});
