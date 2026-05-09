import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import ProviderModelSelector from "@/components/shared/ProviderModelSelector.vue";

// ── WS 邊界 mock ───────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── 預設 props ─────────────────────────────────────────────────
const defaultProps = {
  provider: "claude" as const,
  model: "sonnet",
};

function mountSelector(props: Record<string, unknown> = {}) {
  return mount(ProviderModelSelector, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

/**
 * 注入三個 provider 的測試 capability 清單。
 * claude 預設模型為 sonnet（第一個）；codex 為 gpt-5.4；gemini 為 gemini-2.5-flash。
 */
function setupFakeProviders() {
  const capabilityStore = useProviderCapabilityStore();
  capabilityStore.syncFromPayload([
    {
      name: "claude",
      capabilities: {
        chat: true,
        plugin: false,
        repository: true,
        command: true,
        mcp: true,
      },
      availableModels: [
        { value: "sonnet", label: "Sonnet" },
        { value: "haiku", label: "Haiku" },
        { value: "opus", label: "Opus" },
      ],
    },
    {
      name: "codex",
      capabilities: {
        chat: true,
        plugin: true,
        repository: false,
        command: true,
        mcp: false,
      },
      availableModels: [
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
      ],
    },
    {
      name: "gemini",
      capabilities: {
        chat: true,
        plugin: false,
        repository: false,
        command: false,
        mcp: false,
      },
      availableModels: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      ],
    },
  ]);
}

describe("ProviderModelSelector", () => {
  // 使用真實 store + Pinia，只 mock WS 邊界
  setupStoreTest(() => {
    setupFakeProviders();
  });

  // ──────────────────────────────────────────────────────────────
  describe("I2 - 切換 provider 時 emit update:provider 與 update:model（預設模型）", () => {
    it("從 claude 切換到 codex → emit update:provider 為 codex", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");

      const providerEmits = wrapper.emitted("update:provider");
      expect(providerEmits).toBeTruthy();
      expect(providerEmits?.[0]).toEqual(["codex"]);
    });

    it("從 claude 切換到 codex → emit update:model 為 codex 的預設模型（gpt-5.4）", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const codexBtn = buttons.find((b) => b.text().includes("Codex"));
      await codexBtn?.trigger("click");

      const modelEmits = wrapper.emitted("update:model");
      expect(modelEmits).toBeTruthy();
      expect(modelEmits?.[0]).toEqual(["gpt-5.4"]);
    });

    it("從 claude 切換到 gemini → emit update:provider 為 gemini", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");

      const providerEmits = wrapper.emitted("update:provider");
      expect(providerEmits).toBeTruthy();
      expect(providerEmits?.[0]).toEqual(["gemini"]);
    });

    it("從 claude 切換到 gemini → emit update:model 為 gemini 的預設模型（gemini-2.5-flash）", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const geminiBtn = buttons.find((b) => b.text().includes("Gemini"));
      await geminiBtn?.trigger("click");

      const modelEmits = wrapper.emitted("update:model");
      expect(modelEmits).toBeTruthy();
      expect(modelEmits?.[0]).toEqual(["gemini-2.5-flash"]);
    });

    it("切換到已選中的相同 provider → 不 emit 任何事件", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const claudeBtn = buttons.find((b) => b.text().includes("Claude"));
      await claudeBtn?.trigger("click");

      expect(wrapper.emitted("update:provider")).toBeFalsy();
      expect(wrapper.emitted("update:model")).toBeFalsy();
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("模型選單渲染", () => {
    it("provider=claude 時應顯示 claude 的三個模型選項", () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });
      const text = wrapper.text();

      expect(text).toContain("Sonnet");
      expect(text).toContain("Haiku");
      expect(text).toContain("Opus");
    });

    it("provider=codex 時應顯示 codex 的模型選項", () => {
      const wrapper = mountSelector({ provider: "codex", model: "gpt-5.4" });
      const text = wrapper.text();

      expect(text).toContain("GPT-5.4");
      expect(text).toContain("GPT-5.5");
    });

    it("capability 尚未載入時應顯示載入中", () => {
      // 清空 capability 讓 availableModels 回傳 null
      const capabilityStore = useProviderCapabilityStore();
      capabilityStore.syncFromPayload([
        {
          name: "claude",
          capabilities: {
            chat: true,
            plugin: false,
            repository: true,
            command: true,
            mcp: true,
          },
          availableModels: [],
        },
      ]);

      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      expect(wrapper.text()).toContain("載入中");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("模型選中狀態", () => {
    it("model=sonnet 時，Sonnet 按鈕應有選中樣式", () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      expect(sonnetBtn?.classes()).toContain("bg-secondary");
      expect(sonnetBtn?.classes()).toContain("border-l-2");
    });

    it("model=haiku 時，Haiku 按鈕應有選中樣式，Sonnet 不應有", () => {
      const wrapper = mountSelector({ provider: "claude", model: "haiku" });

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));

      expect(haikuBtn?.classes()).toContain("border-l-2");
      expect(sonnetBtn?.classes()).not.toContain("border-l-2");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("disabled 狀態", () => {
    it("disabled=true 時元件應套用 opacity-50 pointer-events-none", () => {
      const wrapper = mountSelector({ disabled: true });

      // 根元素應有 opacity-50
      expect(wrapper.find("div").classes()).toContain("opacity-50");
      expect(wrapper.find("div").classes()).toContain("pointer-events-none");
    });

    it("disabled=false 時不應套用 disabled 樣式", () => {
      const wrapper = mountSelector({ disabled: false });

      expect(wrapper.find("div").classes()).not.toContain("opacity-50");
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe("model 切換（同 provider 內）", () => {
    it("點擊非當前模型應 emit update:model 帶正確 value", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const haikuBtn = buttons.find((b) => b.text().includes("Haiku"));
      await haikuBtn?.trigger("click");

      const modelEmits = wrapper.emitted("update:model");
      expect(modelEmits).toBeTruthy();
      expect(modelEmits?.[0]).toEqual(["haiku"]);
    });

    it("點擊已選中的模型 → 不 emit update:model", async () => {
      const wrapper = mountSelector({ provider: "claude", model: "sonnet" });

      const buttons = wrapper.findAll("button");
      const sonnetBtn = buttons.find((b) => b.text().includes("Sonnet"));
      await sonnetBtn?.trigger("click");

      expect(wrapper.emitted("update:model")).toBeFalsy();
    });
  });
});
