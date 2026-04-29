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
vi.mock("@/components/icons/GeminiLogo.vue", () => ({
  default: { name: "GeminiLogo", template: "<svg />" },
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

/** 測試用的 claude / codex / gemini defaultOptions */
const CLAUDE_TEST_MODEL = "claude-opus-4-5";
const CODEX_TEST_MODEL = "gpt-5.4";
const GEMINI_TEST_MODEL = "gemini-2.5-pro";

/** 掛載 ProviderPicker，並讓 store 寫入指定的 defaultOptions */
function mountPickerWithDefaults(options?: {
  claudeModel?: string | null;
  codexModel?: string | null;
  geminiModel?: string | null;
}) {
  const store = useProviderCapabilityStore();

  // 注入 claude defaultOptions
  if (options?.claudeModel !== null) {
    store.syncFromPayload([
      {
        name: "claude",
        capabilities: {
          chat: true,
          plugin: true,
          repository: true,
          command: true,
          mcp: true,
        },
        defaultOptions: { model: options?.claudeModel ?? CLAUDE_TEST_MODEL },
      },
    ]);
  }

  // 注入 codex defaultOptions
  if (options?.codexModel !== null) {
    store.syncFromPayload([
      {
        name: "codex",
        capabilities: {
          chat: true,
          plugin: false,
          repository: false,
          command: false,
          mcp: false,
        },
        defaultOptions: { model: options?.codexModel ?? CODEX_TEST_MODEL },
      },
    ]);
  }

  // 注入 gemini defaultOptions（capabilities 僅 chat: true）
  // geminiModel 為 undefined 表示不注入；為 null 表示注入但不帶 model（disabled 情境）；為字串則注入該 model
  if (options?.geminiModel !== undefined) {
    if (options.geminiModel !== null) {
      store.syncFromPayload([
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          defaultOptions: { model: options.geminiModel },
        },
      ]);
    } else {
      // geminiModel === null：注入 gemini capabilities 但 defaultOptions 不帶 model，模擬 metadata 未就緒
      store.syncFromPayload([
        {
          name: "gemini",
          capabilities: {
            chat: true,
            plugin: false,
            repository: false,
            command: false,
            mcp: false,
          },
          defaultOptions: {},
        },
      ]);
    }
  }

  return mount(ProviderPicker, {
    attachTo: document.body,
  });
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
      const wrapper = mountPickerWithDefaults({
        claudeModel: CLAUDE_TEST_MODEL,
      });

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
      const wrapper = mountPickerWithDefaults({ codexModel: CODEX_TEST_MODEL });

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

  describe("選擇 Gemini 時的 emit payload", () => {
    // A1：metadata 已載入（含 gemini）時，渲染 Gemini 按鈕且為可點狀態
    it("A1：metadata 已含 gemini 時，Gemini 按鈕應為啟用狀態（非 disabled）", async () => {
      const wrapper = mountPickerWithDefaults({
        geminiModel: GEMINI_TEST_MODEL,
      });

      const buttons = wrapper.findAll("button");
      // buttons[2] 為 Gemini（Claude=0, Codex=1, Gemini=2）
      expect(buttons[2]!.attributes("disabled")).toBeUndefined();
      wrapper.unmount();
    });

    // A2：gemini defaultOptions 缺 model 時，Gemini 按鈕為 disabled，點擊外層觸發 toast
    it("A2：gemini defaultOptions 無 model 時，Gemini 按鈕應為 disabled，點擊外層應觸發 toast", async () => {
      // geminiModel: null → 注入 gemini capabilities 但 defaultOptions 不帶 model
      const wrapper = mountPickerWithDefaults({
        geminiModel: null,
      });

      const buttons = wrapper.findAll("button");
      expect(buttons[2]!.attributes("disabled")).toBeDefined();

      // 點擊外層 div（事件代理），驗證 showLoadingToast 被呼叫
      const geminiWrapper = wrapper.findAll("div.pod-menu-submenu > div")[2]!;
      await geminiWrapper.trigger("click");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Provider" }),
      );
      wrapper.unmount();
    });

    // A3：點擊 Gemini 按鈕 emit select，payload 含正確 provider 與 providerConfig
    it("A3：點擊 Gemini 按鈕應 emit select，payload 包含 provider='gemini' 與正確 model", async () => {
      const wrapper = mountPickerWithDefaults({
        geminiModel: GEMINI_TEST_MODEL,
      });

      const buttons = wrapper.findAll("button");
      await buttons[2]!.trigger("click");

      const emitted = wrapper.emitted("select");
      expect(emitted).toBeTruthy();

      const payload = (emitted as unknown[][])[0]![0] as {
        provider: string;
        providerConfig: { model: string };
      };
      expect(payload.provider).toBe("gemini");
      expect(payload.providerConfig).toEqual({ model: GEMINI_TEST_MODEL });
      wrapper.unmount();
    });
  });

  describe("metadata 未載入時的防呆行為", () => {
    it("store 無 claude defaultOptions 時，Claude 按鈕應為 disabled", async () => {
      // 不注入任何 defaultOptions，模擬 metadata 尚未到達
      const store = useProviderCapabilityStore();
      // 只寫入空 defaultOptions（模擬後端 Phase 6 前的狀態）
      store.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: true,
            repository: true,
            command: true,
            mcp: true,
          },
          // 刻意不帶 defaultOptions
        },
      ]);

      const wrapper = mount(ProviderPicker, { attachTo: document.body });

      const buttons = wrapper.findAll("button");
      expect(buttons[0]!.attributes("disabled")).toBeDefined();
    });

    it("store 完全空時，兩個按鈕皆應為 disabled", async () => {
      // 不呼叫 syncFromPayload，store 維持初始空物件
      const wrapper = mount(ProviderPicker, { attachTo: document.body });

      const buttons = wrapper.findAll("button");
      expect(buttons[0]!.attributes("disabled")).toBeDefined();
      expect(buttons[1]!.attributes("disabled")).toBeDefined();
    });

    it("store 完全空時，點擊 disabled Claude 按鈕不會 emit select", async () => {
      // store 完全空（metadata 尚未載入），按鈕 disabled
      const wrapper = mount(ProviderPicker, { attachTo: document.body });

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
