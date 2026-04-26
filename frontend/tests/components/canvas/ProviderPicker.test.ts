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

/** 掛載 ProviderPicker，並讓 store 寫入指定的 defaultOptions */
function mountPickerWithDefaults(options?: {
  claudeModel?: string | null;
  codexModel?: string | null;
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
          integration: true,
          runMode: true,
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
          integration: false,
          runMode: false,
        },
        defaultOptions: { model: options?.codexModel ?? CODEX_TEST_MODEL },
      },
    ]);
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
            integration: true,
            runMode: true,
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
