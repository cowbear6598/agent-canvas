import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { resetMockWebSocket } from "../../helpers/mockWebSocket";
import OpencodeSettingsPanel from "@/components/settings/OpencodeSettingsPanel.vue";
import type { OpencodeProviderInfo } from "@/types/opencode";

// ── Module-level mocks (vi.mock hoisted to top by vitest) ──────────────────────

vi.mock("@/services/opencodeApi", () => ({
  listOpencodeProviders: vi.fn(),
  restartOpencodeServer: vi.fn(),
  listAliases: vi.fn(),
  createAlias: vi.fn(),
  updateAlias: vi.fn(),
  deleteAlias: vi.fn(),
  reorderAliases: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// VueDraggable 在 jsdom 環境中 sortable.js 無法正常運作，以 stub 替代
vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    props: ["modelValue", "handle", "animation", "ghostClass", "chosenClass"],
    emits: ["update:modelValue", "end"],
    template: `<div class="vue-draggable-stub"><slot /></div>`,
  },
}));

// ── 測試資料工廠 ───────────────────────────────────────────────────────────────

function makeProvider(
  overrides?: Partial<OpencodeProviderInfo>,
): OpencodeProviderInfo {
  return {
    id: "openai",
    name: "OpenAI",
    models: [{ id: "gpt-4o", name: "GPT-4o" }],
    ...overrides,
  };
}

// ── 取得 mock 函式的輔助 ────────────────────────────────────────────────────────

async function getOpencodeMocks() {
  const mod = await import("@/services/opencodeApi");
  return {
    listOpencodeProviders: vi.mocked(mod.listOpencodeProviders),
    restartOpencodeServer: vi.mocked(mod.restartOpencodeServer),
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe("OpencodeSettingsPanel", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // F8: 按下重啟按鈕後 provider 清單會自動重新載入且 connected provider 顯示在分組上方
  // ──────────────────────────────────────────────────────────────────────────────
  describe("F8: 重啟流程", () => {
    it("按下重啟按鈕後 provider 清單自動重新載入，新 connected provider 出現在上方", async () => {
      const { listOpencodeProviders, restartOpencodeServer } =
        await getOpencodeMocks();

      const providerX = makeProvider({ id: "provider-x", name: "Provider X" });

      // 第一次載入：provider-x 未連線
      listOpencodeProviders.mockResolvedValueOnce({
        all: [providerX],
        default: "",
        connected: [],
      });

      const wrapper = mount(OpencodeSettingsPanel, {
        attachTo: document.body,
      });

      // 等待 onMounted 的 loadFromBackend 完成
      await flushPromises();

      // 確認 provider-x 目前出現在 DOM（顯示為未連線，opacity-50）
      const initialProviderItems = wrapper.findAll(
        ".flex.items-center.justify-between.rounded-md.border.border-border",
      );
      const initialProviderX = initialProviderItems.find((el) =>
        el.text().includes("Provider X"),
      );
      expect(initialProviderX).toBeTruthy();
      // 未連線時不顯示 "已登入" badge
      expect(initialProviderX!.text()).not.toContain("已登入");

      // 設定 restartOpencodeServer mock
      restartOpencodeServer.mockResolvedValueOnce(undefined);

      // 第二次載入：provider-x 已連線
      listOpencodeProviders.mockResolvedValueOnce({
        all: [providerX],
        default: "provider-x",
        connected: ["provider-x"],
      });

      // 找到重啟按鈕並點擊
      const restartButton = wrapper
        .findAll("button")
        .find((btn) => btn.text().includes("重新啟動 OpenCode"));
      expect(restartButton).toBeTruthy();
      await restartButton!.trigger("click");

      // 等待 restartOpencodeServer 與第二次 listOpencodeProviders 完成
      await flushPromises();

      // 驗證 restartOpencodeServer 被呼叫
      expect(restartOpencodeServer).toHaveBeenCalledTimes(1);
      // 驗證 listOpencodeProviders 被呼叫兩次（一次 onMounted，一次 restart 後）
      expect(listOpencodeProviders).toHaveBeenCalledTimes(2);

      // 驗證 provider-x 出現在 provider 清單中，且顯示 "已登入" badge（connected 分組）
      const updatedProviderItems = wrapper.findAll(
        ".flex.items-center.justify-between.rounded-md.border.border-border",
      );
      const updatedProviderX = updatedProviderItems.find((el) =>
        el.text().includes("Provider X"),
      );
      expect(updatedProviderX).toBeTruthy();
      expect(updatedProviderX!.text()).toContain("已登入");

      // 確認 Provider X 是排在清單最前面（connected group 在 disconnected group 前）
      expect(updatedProviderItems[0]!.text()).toContain("Provider X");

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // F4: 在 Card collapsed 狀態下按 + 按鈕會自動展開 Card 並顯示 draft row
  // ──────────────────────────────────────────────────────────────────────────────
  describe("F4: 收合狀態按 + 按鈕", () => {
    it("Card 預設收合，點擊 + 按鈕後自動展開並顯示 draft row", async () => {
      const { listOpencodeProviders } = await getOpencodeMocks();

      const connectedProvider = makeProvider({
        id: "anthropic",
        name: "Anthropic",
        models: [
          { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
          { id: "claude-opus-4", name: "Claude Opus 4" },
        ],
      });

      // provider 已連線（因此 Card 會顯示在 Model 對應表區塊）
      listOpencodeProviders.mockResolvedValueOnce({
        all: [connectedProvider],
        default: "anthropic",
        connected: ["anthropic"],
      });

      const wrapper = mount(OpencodeSettingsPanel, {
        attachTo: document.body,
      });

      // 等待 onMounted 的 loadFromBackend 完成
      await flushPromises();

      // 確認 Model 對應表區塊已渲染（有 connected provider 才顯示）
      const aliasSection = wrapper.find(".space-y-4");
      expect(aliasSection.exists()).toBe(true);

      // 驗證 CollapsibleContent 預設為 closed（draft row 不在 DOM 內）
      // CollapsibleContent 在 closed 時 data-state="closed" 且 h-0（內容不可見）
      // 使用 aliasPlaceholder 文字查找 draft row input
      const draftRowBefore = wrapper.find(`input[placeholder="請輸入別稱"]`);
      expect(draftRowBefore.exists()).toBe(false);

      // 找到 + 按鈕（aria-label="新增 model"）並點擊
      const addButton = wrapper.find(`button[aria-label="新增 model"]`);
      expect(addButton.exists()).toBe(true);
      await addButton.trigger("click");
      await flushPromises();

      // 斷言 (1)：該 Card 現在為 open 狀態（CollapsibleContent data-state="open"）
      // reka-ui CollapsibleContent 展開時 data-state="open"
      const openCollapsibleContent = wrapper.find("[data-state='open']");
      expect(openCollapsibleContent.exists()).toBe(true);

      // 斷言 (2)：DOM 內出現 draft row（alias placeholder input 出現）
      const draftRowAfter = wrapper.find(`input[placeholder="請輸入別稱"]`);
      expect(draftRowAfter.exists()).toBe(true);

      // 也確認 "真實 model id" label 出現（另一種定位方式）
      const modelIdLabel = wrapper
        .findAll("label")
        .find((label) => label.text() === "真實 model id");
      expect(modelIdLabel).toBeTruthy();

      wrapper.unmount();
    });
  });
});
