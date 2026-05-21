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
});
