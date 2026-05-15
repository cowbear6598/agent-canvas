import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import OpencodeSettingsPanel from "@/components/settings/OpencodeSettingsPanel.vue";
import type {
  OpencodeProviderListResult,
  OpencodeModelAlias,
} from "@/types/opencode";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";

// ── opencodeApi Mock（自家 wrapper 邊界） ──────────────────────────────────────
const { mockListOpencodeProviders } = vi.hoisted(() => ({
  mockListOpencodeProviders: vi.fn<() => Promise<OpencodeProviderListResult>>(),
}));

vi.mock("@/services/opencodeApi", () => ({
  listOpencodeProviders: mockListOpencodeProviders,
  createAlias: vi.fn(),
  updateAlias: vi.fn(),
  deleteAlias: vi.fn(),
  reorderAliases: vi.fn(),
  listAliases: vi.fn(),
}));

// ── UI 元件 Mock（避免 Shadcn 複雜子元件干擾） ────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["disabled", "variant", "size"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open" class="dialog-stub"><slot /></div>',
  },
  DialogContent: {
    name: "DialogContent",
    template: '<div class="dialog-content-stub"><slot /></div>',
  },
  DialogHeader: {
    name: "DialogHeader",
    template: '<div class="dialog-header-stub"><slot /></div>',
  },
  DialogTitle: {
    name: "DialogTitle",
    template: '<div class="dialog-title-stub"><slot /></div>',
  },
  DialogDescription: {
    name: "DialogDescription",
    template: '<div class="dialog-description-stub"><slot /></div>',
  },
  DialogFooter: {
    name: "DialogFooter",
    template: '<div class="dialog-footer-stub"><slot /></div>',
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const anthropicModels = [
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
];

const anthropic = {
  id: "anthropic",
  name: "Anthropic",
  models: anthropicModels,
};
const openai = { id: "openai", name: "OpenAI", models: [] };

function makeResult(
  overrides?: Partial<OpencodeProviderListResult>,
): OpencodeProviderListResult {
  return {
    all: [anthropic, openai],
    default: "anthropic",
    connected: ["anthropic"],
    ...overrides,
  };
}

function makeAlias(
  overrides?: Partial<OpencodeModelAlias>,
): OpencodeModelAlias {
  return {
    id: "alias-1",
    providerID: "anthropic",
    modelID: "claude-3-5-sonnet-20241022",
    alias: "sonnet",
    sortOrder: 0,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

describe("OpencodeSettingsPanel", () => {
  setupStoreTest();

  // ──────────────────────────────────────────────────────────────────────────────
  // (1) anthropic 已登入、openai disabled
  // ──────────────────────────────────────────────────────────────────────────────
  describe("provider 列表顯示", () => {
    it("(1) connected 的 provider row 標「已登入」、未 connected 的 row 標 disabled 樣式", async () => {
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      const text = wrapper.text();

      // anthropic 已登入
      expect(text).toContain("Anthropic");
      expect(text).toContain("已登入");

      // openai 未登入（disabledHint 含 provider id）
      expect(text).toContain("OpenAI");
      expect(text).toContain("openai");

      // openai row 含 opacity-50 class（disabled 樣式）
      const rows = wrapper.findAll('[class*="rounded-md border"]');
      const openaiRow = rows.find((r) => r.text().includes("OpenAI"));
      expect(openaiRow?.classes()).toContain("opacity-50");

      // anthropic row 不含 opacity-50
      const anthropicRow = rows.find((r) => r.text().includes("Anthropic"));
      expect(anthropicRow?.classes()).not.toContain("opacity-50");

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (2) listOpencodeProviders 拒絕時 loadState 轉 error，顯示重試按鈕
  // ──────────────────────────────────────────────────────────────────────────────
  describe("錯誤狀態", () => {
    it("(2) API 拒絕時顯示「載入失敗」訊息與重試按鈕", async () => {
      mockListOpencodeProviders.mockRejectedValueOnce(
        new Error("opencode 未安裝"),
      );

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      expect(wrapper.text()).toContain("載入失敗");

      // 重試按鈕存在
      const retryBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("重試"));
      expect(retryBtn).toBeDefined();

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (3) 點重試按鈕後重新呼叫 API
  // ──────────────────────────────────────────────────────────────────────────────
  describe("重試行為", () => {
    it("(3) 點擊重試按鈕後重新呼叫 listOpencodeProviders", async () => {
      // 第一次拒絕 → error state
      mockListOpencodeProviders.mockRejectedValueOnce(new Error("失敗"));
      // 第二次成功
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      // 確認已顯示錯誤
      expect(wrapper.text()).toContain("載入失敗");

      const retryBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("重試"));
      expect(retryBtn).toBeDefined();

      await retryBtn!.trigger("click");
      await flushPromises();

      // listOpencodeProviders 應被呼叫兩次（掛載一次 + 重試一次）
      expect(mockListOpencodeProviders).toHaveBeenCalledTimes(2);

      // 重試後應顯示正常內容
      expect(wrapper.text()).toContain("Anthropic");

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (4) alias 新增 — 儲存時呼叫 addAlias，payload 含正確 providerID/modelID/alias
  // ──────────────────────────────────────────────────────────────────────────────
  describe("alias 新增", () => {
    it("(4) 新增 row 儲存時呼叫 opencodeAliasStore.addAlias 一次，payload 含正確 providerID、modelID、alias", async () => {
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      const aliasStore = useOpencodeAliasStore();
      const spy = vi.spyOn(aliasStore, "addAlias").mockResolvedValue();

      // 點「新增 model」按鈕
      const addBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 model"));
      expect(addBtn).toBeDefined();
      await addBtn!.trigger("click");
      await flushPromises();

      // 輸入 alias
      const aliasInput = wrapper.find('input[placeholder="請輸入別稱"]');
      expect(aliasInput.exists()).toBe(true);
      await aliasInput.setValue("my-alias");

      // 點儲存
      const saveBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("儲存"));
      expect(saveBtn).toBeDefined();
      await saveBtn!.trigger("click");
      await flushPromises();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          providerID: "anthropic",
          modelID: anthropicModels[0]!.id,
          alias: "my-alias",
        }),
      );

      wrapper.unmount();
    });

    it("(5) 儲存時若同 provider 已有同名 alias，顯示重複錯誤、不呼叫 addAlias", async () => {
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      const aliasStore = useOpencodeAliasStore();
      // 預先放入一筆 alias
      aliasStore.setAliases([makeAlias({ alias: "sonnet" })]);

      const addSpy = vi.spyOn(aliasStore, "addAlias").mockResolvedValue();

      // 點「新增 model」按鈕
      const addBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 model"));
      await addBtn!.trigger("click");
      await flushPromises();

      // 輸入重複的 alias
      const aliasInput = wrapper.find('input[placeholder="請輸入別稱"]');
      await aliasInput.setValue("sonnet");

      // 點儲存
      const saveBtn = wrapper
        .findAll("button")
        .find((b) => b.text().includes("儲存"));
      await saveBtn!.trigger("click");
      await flushPromises();

      // addAlias 不應被呼叫
      expect(addSpy).not.toHaveBeenCalled();

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (6) alias 刪除 — 確認後呼叫 removeAlias 一次，id 正確
  // ──────────────────────────────────────────────────────────────────────────────
  describe("alias 刪除", () => {
    it("(6) 刪除確認後呼叫 removeAlias 一次，id 正確", async () => {
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      const aliasStore = useOpencodeAliasStore();
      aliasStore.setAliases([
        makeAlias({ id: "alias-to-delete", alias: "my-alias" }),
      ]);

      const removeSpy = vi.spyOn(aliasStore, "removeAlias").mockResolvedValue();

      await flushPromises();

      // 找到刪除按鈕（OpencodeAliasRow 渲染的「刪除」）
      const deleteBtn = wrapper
        .findAll("button")
        .find((b) => b.text() === "刪除");
      expect(deleteBtn).toBeDefined();
      await deleteBtn!.trigger("click");
      await flushPromises();

      // Dialog 應出現（確認 Dialog 已開啟）
      const confirmDialog = wrapper.find(".dialog-stub");
      expect(confirmDialog.exists()).toBe(true);

      // 找確認刪除按鈕（destructive variant）
      const confirmBtn = confirmDialog
        .findAll("button")
        .find((b) => b.text() === "刪除");
      expect(confirmBtn).toBeDefined();
      await confirmBtn!.trigger("click");
      await flushPromises();

      expect(removeSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledWith("alias-to-delete");

      wrapper.unmount();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (7) 拖曳重排 — drop 後呼叫 reorder 一次，idsInOrder 反映新順序
  // ──────────────────────────────────────────────────────────────────────────────
  describe("alias 拖曳重排", () => {
    it("(7) 拖曳重排後呼叫 reorder 一次，idsInOrder 反映新順序", async () => {
      mockListOpencodeProviders.mockResolvedValueOnce(makeResult());

      const wrapper = mount(OpencodeSettingsPanel);
      await flushPromises();

      const aliasStore = useOpencodeAliasStore();
      const alias1 = makeAlias({ id: "a1", alias: "first", sortOrder: 0 });
      const alias2 = makeAlias({ id: "a2", alias: "second", sortOrder: 1 });
      aliasStore.setAliases([alias1, alias2]);

      const reorderSpy = vi.spyOn(aliasStore, "reorder").mockResolvedValue();

      await flushPromises();

      // 找兩個 OpencodeAliasRow 的 draggable wrapper div
      const rows = wrapper.findAll('[draggable="true"]');
      expect(rows.length).toBeGreaterThanOrEqual(2);

      // 模擬 dragstart 在第一筆 row（alias1）
      await rows[0]!.trigger("dragstart", {
        dataTransfer: {
          effectAllowed: "",
          setData: vi.fn(),
        },
      });

      // 模擬 drop 在第二筆 row（alias2）
      await rows[1]!.trigger("drop", {
        dataTransfer: {},
      });
      await flushPromises();

      // reorder 應被呼叫一次，idsInOrder 含兩個 id（反映新順序）
      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith(
        expect.arrayContaining(["a1", "a2"]),
      );
      expect((reorderSpy.mock.calls[0]![0] as string[]).length).toBe(2);

      wrapper.unmount();
    });
  });
});
