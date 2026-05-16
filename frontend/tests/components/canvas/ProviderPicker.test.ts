import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import ProviderPicker from "@/components/canvas/ProviderPicker.vue";

// mock icon 元件，避免 SVG 相依問題
vi.mock("@/components/icons/AnthropicLogo.vue", () => ({
  default: { name: "AnthropicLogo", template: "<svg />" },
}));
vi.mock("@/components/icons/OpenAILogo.vue", () => ({
  default: { name: "OpenAILogo", template: "<svg />" },
}));

// mock useToast，讓測試中可以驗證 toast 呼叫
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// mock WebSocket（ProviderPicker 本身不用 WS，但 store 有 loadFromBackend 需要它）
vi.mock("@/services/websocket", () => ({
  createWebSocketRequest: vi.fn(),
  WebSocketRequestEvents: { PROVIDER_LIST: "provider:list" },
  WebSocketResponseEvents: { PROVIDER_LIST_RESULT: "provider:list:result" },
}));

/** 測試用的 claude / codex defaultOptions */
const CLAUDE_TEST_MODEL = "claude-opus-4-5";
const CODEX_TEST_MODEL = "gpt-5.4";

// ─── Store 注入 helpers ──────────────────────────────────────────────────────

/**
 * 往 providerCapabilityStore 注入指定 provider 的 metadata。
 * model 為 undefined 表示注入空 defaultOptions（模擬 metadata 未就緒）；
 * 為字串時注入對應 model。
 */
function injectProviderMetadata(
  provider: "claude" | "codex",
  model: string | undefined,
): void {
  const store = useProviderCapabilityStore();

  const capabilitiesMap: Record<
    "claude" | "codex",
    {
      chat: boolean;
      plugin: boolean;
      repository: boolean;
      mcp: boolean;
    }
  > = {
    claude: {
      chat: true,
      plugin: true,
      repository: true,
      mcp: true,
    },
    codex: {
      chat: true,
      plugin: false,
      repository: false,
      mcp: false,
    },
  };

  store.syncFromPayload([
    {
      name: provider,
      capabilities: capabilitiesMap[provider],
      defaultOptions: model !== undefined ? { model } : {},
    },
  ]);
}

// ─── Mount helper ────────────────────────────────────────────────────────────

/** 掛載 ProviderPicker（不負責 store 注入，由各測試自行呼叫 injectProviderMetadata） */
function mountPicker() {
  return mount(ProviderPicker, { attachTo: document.body });
}

/**
 * 便捷 helper：注入 claude + codex（預設 model）後掛載 ProviderPicker。
 * 各 describe 如需特殊情境可改為直接呼叫 injectProviderMetadata + mountPicker。
 */
function mountPickerWithDefaults(options?: {
  claudeModel?: string | null;
  codexModel?: string | null;
}) {
  // claudeModel 為 null → 不注入；undefined → 注入預設值；字串 → 注入該值
  if (options?.claudeModel !== null) {
    injectProviderMetadata(
      "claude",
      options?.claudeModel !== undefined
        ? options.claudeModel
        : CLAUDE_TEST_MODEL,
    );
  }

  if (options?.codexModel !== null) {
    injectProviderMetadata(
      "codex",
      options?.codexModel !== undefined ? options.codexModel : CODEX_TEST_MODEL,
    );
  }

  return mountPicker();
}

describe("ProviderPicker", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  describe("選擇 Claude 時的 emit payload", () => {
    it("providerConfig 僅包含 model 欄位，不含 provider 欄位", async () => {
      const wrapper = mountPickerWithDefaults();

      const buttons = wrapper.findAll("button");
      await buttons[0]!.trigger("click");

      const emitted = wrapper.emitted("select");
      expect(emitted).toBeTruthy();

      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: Record<string, unknown>;
      };
      expect(Object.keys(payload.providerConfig)).toEqual(["model"]);
      expect("provider" in payload.providerConfig).toBe(false);
    });

    it("Pod.provider 欄位正確帶為 'claude'", async () => {
      const wrapper = mountPickerWithDefaults();

      const buttons = wrapper.findAll("button");
      await buttons[0]!.trigger("click");

      const emitted = wrapper.emitted("select");
      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: Record<string, unknown>;
      };
      expect(payload.provider).toBe("claude");
    });

    it("providerConfig.model 應為 store 中的 claude defaultOptions model", async () => {
      injectProviderMetadata("claude", CLAUDE_TEST_MODEL);
      injectProviderMetadata("codex", CODEX_TEST_MODEL);
      const wrapper = mountPicker();

      const buttons = wrapper.findAll("button");
      await buttons[0]!.trigger("click");

      const emitted = wrapper.emitted("select");
      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: { model: string };
      };
      expect(payload.providerConfig.model).toBe(CLAUDE_TEST_MODEL);
    });
  });

  describe("選擇 Codex 時的 emit payload", () => {
    it("providerConfig 僅包含 model 欄位，不含 provider 欄位", async () => {
      const wrapper = mountPickerWithDefaults();

      const buttons = wrapper.findAll("button");
      await buttons[1]!.trigger("click");

      const emitted = wrapper.emitted("select");
      expect(emitted).toBeTruthy();

      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: Record<string, unknown>;
      };
      expect(Object.keys(payload.providerConfig)).toEqual(["model"]);
      expect("provider" in payload.providerConfig).toBe(false);
    });

    it("Pod.provider 欄位正確帶為 'codex'", async () => {
      const wrapper = mountPickerWithDefaults();

      const buttons = wrapper.findAll("button");
      await buttons[1]!.trigger("click");

      const emitted = wrapper.emitted("select");
      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: Record<string, unknown>;
      };
      expect(payload.provider).toBe("codex");
    });

    it("providerConfig.model 應為 store 中的 codex defaultOptions model", async () => {
      injectProviderMetadata("claude", CLAUDE_TEST_MODEL);
      injectProviderMetadata("codex", CODEX_TEST_MODEL);
      const wrapper = mountPicker();

      const buttons = wrapper.findAll("button");
      await buttons[1]!.trigger("click");

      const emitted = wrapper.emitted("select");
      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: { model: string };
      };
      expect(payload.providerConfig.model).toBe(CODEX_TEST_MODEL);
    });
  });

  describe("Gemini 入口已移除", () => {
    it("不應渲染 Gemini 按鈕", () => {
      const wrapper = mountPickerWithDefaults();
      const labels = wrapper.findAll("button").map((button) => button.text());

      expect(labels.some((label) => label.includes("Gemini"))).toBe(false);
      wrapper.unmount();
    });
  });

  describe("metadata 未載入時的防呆行為", () => {
    it("store 無 claude defaultOptions 時，Claude 按鈕應為 disabled", async () => {
      // 只寫入空 defaultOptions（模擬後端 Phase 6 前的狀態）
      injectProviderMetadata("claude", undefined);
      const wrapper = mountPicker();

      const buttons = wrapper.findAll("button");
      expect(buttons[0]!.attributes("disabled")).toBeDefined();
    });

    it("store 完全空時，兩個按鈕皆應為 disabled", async () => {
      // 不呼叫任何 injectProviderMetadata，store 維持初始空物件
      const wrapper = mountPicker();

      const buttons = wrapper.findAll("button");
      expect(buttons[0]!.attributes("disabled")).toBeDefined();
      expect(buttons[1]!.attributes("disabled")).toBeDefined();
    });

    it("store 完全空時，點擊 disabled Claude 按鈕不會 emit select", async () => {
      // store 完全空（metadata 尚未載入），按鈕 disabled
      const wrapper = mountPicker();

      const buttons = wrapper.findAll("button");
      // HTML disabled 屬性阻止 click 事件觸發 handler
      await buttons[0]!.trigger("click");

      // disabled 狀態下不應 emit select
      expect(wrapper.emitted("select")).toBeFalsy();
    });

    it("store 已有 defaultOptions 時，按鈕不應為 disabled", async () => {
      const wrapper = mountPickerWithDefaults();

      const buttons = wrapper.findAll("button");
      expect(buttons[0]!.attributes("disabled")).toBeUndefined();
      expect(buttons[1]!.attributes("disabled")).toBeUndefined();
    });
  });
});
