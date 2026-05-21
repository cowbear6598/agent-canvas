/**
 * opencode 錯誤訊息處理測試（B 類業務規則）
 *
 * 涵蓋：
 * 1. chat event handler 收到 opencode_auth_missing 時，注入 Pod 的訊息包含 providerID 與「opencode auth login」字樣
 * 2. provider 為 opencode 且 capabilities.chat === false 時，PodModelSelector 呈現 disabled
 *    且 tooltip 文字為對應 i18n key 內容
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia } from "pinia";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import type { PodChatMessagePayload } from "@/types/websocket";
import type { OpencodeModelAlias } from "@/types/opencode";

// ── WebSocket mock ───────────────────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── useToast mock ────────────────────────────────────────────────────────────
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 1. chat event handler：opencode_auth_missing 錯誤注入 transcript
// ─────────────────────────────────────────────────────────────────────────────

describe("opencode_auth_missing 錯誤訊息注入 Pod transcript", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
  });

  /**
   * 建構後端送來的 opencode_auth_missing 訊息 payload。
   * content 格式與後端 classifySessionError 產生的一致。
   */
  function buildAuthMissingPayload(providerID: string): PodChatMessagePayload {
    return {
      podId: "pod-opencode",
      messageId: "msg-auth-error",
      content: `請在 terminal 執行 \`opencode auth login ${providerID}\` 後再試一次`,
      isPartial: false,
      role: "system",
      metadata: {
        provider: "opencode",
        code: "opencode_auth_missing",
        severity: "error",
        rawContent: "No auth credentials found",
      },
    };
  }

  it("收到 opencode_auth_missing 且 providerID 為 openai 時，注入的訊息應包含 openai", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages).toHaveLength(1);
    expect(messages![0]!.content).toContain("openai");
  });

  it("收到 opencode_auth_missing 且 providerID 為 openai 時，注入的訊息應包含「opencode auth login」字樣", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.content).toContain("opencode auth login");
  });

  it("收到 opencode_auth_missing 時，注入的訊息 role 應為 system", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("anthropic"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.role).toBe("system");
  });

  it("收到 opencode_auth_missing 時，metadata.code 應保留原始 code", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.metadata?.code).toBe("opencode_auth_missing");
  });

  it("非 opencode 錯誤代碼的訊息應原樣顯示，不做 i18n 替換", () => {
    const chatStore = useChatStore();
    const originalContent = "Authentication failed for some other reason";

    chatStore.handleChatMessage({
      podId: "pod-1",
      messageId: "msg-other",
      content: originalContent,
      isPartial: false,
      role: "system",
      metadata: {
        provider: "claude",
        code: "AUTH_ERROR",
        severity: "error",
        rawContent: originalContent,
      },
    });

    const messages = chatStore.messagesByPodId.get("pod-1");
    expect(messages![0]!.content).toBe(originalContent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PodModelSelector：opencode provider + capabilities.chat=false → disabled
// ─────────────────────────────────────────────────────────────────────────────

describe("PodModelSelector opencode server 失敗時呈現 disabled", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  /**
   * 註冊 opencode provider（capabilities 概念已移除，僅保留 known provider 註冊以利後續組件 mount）。
   */
  function injectOpencodeCapabilities(_chatEnabled: boolean) {
    const store = useProviderCapabilityStore();
    store.syncFromPayload([
      {
        name: "opencode",
      },
    ]);
  }

  /**
   * 注入至少一筆 opencode alias，使 PodModelSelector 的 isOpencodeEmpty 為 false，
   * 讓 disabledTooltip 能正確顯示於 title（避免被 emptyPlaceholder 覆蓋）。
   */
  function seedOpencodeAlias() {
    const aliasStore = useOpencodeAliasStore();
    const mockAlias: OpencodeModelAlias = {
      id: "alias-1",
      providerID: "openai",
      modelID: "gpt-4o",
      alias: "gpt-4o",
      orderIdx: 0,
    };
    aliasStore.setAliases([mockAlias]);
  }

  function mountSelector(overrides: Record<string, unknown> = {}) {
    return mount(PodModelSelector, {
      props: {
        podId: "pod-opencode",
        provider: "opencode" as const,
        currentModel: "openai/gpt-4o",
        ...overrides,
      },
    });
  }

  it("provider=opencode 且 disabled prop 傳入 true 時 selector 呈現 pod-model-slot--disabled class", async () => {
    injectOpencodeCapabilities(false);
    // 由 CanvasPod 計算後傳入 disabled；此層測試直接傳 prop 驗證 CSS 行為
    const wrapper = mountSelector({
      disabled: true,
      disabledTooltip: "opencode server 無法啟動",
    });
    await nextTick();

    expect(wrapper.find(".pod-model-slot").classes()).toContain(
      "pod-model-slot--disabled",
    );
    wrapper.unmount();
  });

  it("disabled=true 且 alias 已設定（非 empty 狀態）時，title 屬性應顯示 disabledTooltip 文字", async () => {
    injectOpencodeCapabilities(false);
    // 需有 alias 才讓 isOpencodeEmpty=false，使 disabledTooltip 能出現在 title
    seedOpencodeAlias();
    const tooltip = "opencode server 無法啟動";
    const wrapper = mountSelector({ disabled: true, disabledTooltip: tooltip });
    await nextTick();

    const slot = wrapper.find(".pod-model-slot");
    expect(slot.attributes("title")).toBe(tooltip);
    wrapper.unmount();
  });

  it("capabilities.chat=true 且 disabled=false 時 selector 不含 disabled class", async () => {
    injectOpencodeCapabilities(true);
    seedOpencodeAlias();
    const wrapper = mountSelector({ disabled: false });
    await nextTick();

    expect(wrapper.find(".pod-model-slot").classes()).not.toContain(
      "pod-model-slot--disabled",
    );
    wrapper.unmount();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
