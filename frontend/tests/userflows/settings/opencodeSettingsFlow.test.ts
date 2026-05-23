import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";
import { resetMockWebSocket } from "@tests/helpers/mockWebSocket";
import OpencodeSettingsPanel from "@/components/settings/OpencodeSettingsPanel.vue";
import type { OpencodeProviderInfo } from "@/types/opencode";

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

vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    props: ["modelValue", "handle", "animation", "ghostClass", "chosenClass"],
    emits: ["update:modelValue", "end"],
    template: `<div class="vue-draggable-stub"><slot /></div>`,
  },
}));

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

async function getOpencodeMocks() {
  const mod = await import("@/services/opencodeApi");
  return {
    listOpencodeProviders: vi.mocked(mod.listOpencodeProviders),
    restartOpencodeServer: vi.mocked(mod.restartOpencodeServer),
  };
}

describe("opencode settings userflow", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  describe("F8: 重啟流程", () => {
    it("按下重啟按鈕後 provider 清單自動重新載入，新 connected provider 出現在上方", async () => {
      const { listOpencodeProviders, restartOpencodeServer } =
        await getOpencodeMocks();

      const providerX = makeProvider({ id: "provider-x", name: "Provider X" });

      listOpencodeProviders.mockResolvedValueOnce({
        all: [providerX],
        default: "",
        connected: [],
      });

      const wrapper = mount(OpencodeSettingsPanel, {
        attachTo: document.body,
      });

      await flushPromises();

      const initialProviderItems = wrapper.findAll(
        ".flex.items-center.justify-between.rounded-md.border.border-border",
      );
      const initialProviderX = initialProviderItems.find((el) =>
        el.text().includes("Provider X"),
      );
      expect(initialProviderX).toBeTruthy();
      expect(initialProviderX!.text()).not.toContain("已登入");

      restartOpencodeServer.mockResolvedValueOnce(undefined);

      listOpencodeProviders.mockResolvedValueOnce({
        all: [providerX],
        default: "provider-x",
        connected: ["provider-x"],
      });

      const restartButton = wrapper
        .findAll("button")
        .find((btn) => btn.text().includes("重新啟動 OpenCode"));
      expect(restartButton).toBeTruthy();
      await restartButton!.trigger("click");

      await flushPromises();

      const updatedProviderItems = wrapper.findAll(
        ".flex.items-center.justify-between.rounded-md.border.border-border",
      );
      const updatedProviderX = updatedProviderItems.find((el) =>
        el.text().includes("Provider X"),
      );
      expect(updatedProviderX).toBeTruthy();
      expect(updatedProviderX!.text()).toContain("已登入");
      expect(updatedProviderItems[0]!.text()).toContain("Provider X");

      wrapper.unmount();
    });
  });
});
