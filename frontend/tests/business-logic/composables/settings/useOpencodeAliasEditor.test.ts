import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useOpencodeAliasEditor } from "@/composables/settings/useOpencodeAliasEditor";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import type { OpencodeModelAlias, OpencodeProviderInfo } from "@/types/opencode";

const toastMock = vi.hoisted(() => vi.fn());
const mockCreateAlias = vi.hoisted(() => vi.fn());
const mockUpdateAlias = vi.hoisted(() => vi.fn());
const mockDeleteAlias = vi.hoisted(() => vi.fn());
const mockReorderAliases = vi.hoisted(() => vi.fn());
const mockRefreshAliasPresets = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, payload?: Record<string, string>) =>
      payload?.reason ? `${key}:${payload.reason}` : key,
  }),
}));

vi.mock("@/services/opencodeApi", () => ({
  listAliases: vi.fn(),
  createAlias: (...args: unknown[]) => mockCreateAlias(...args),
  updateAlias: (...args: unknown[]) => mockUpdateAlias(...args),
  deleteAlias: (...args: unknown[]) => mockDeleteAlias(...args),
  reorderAliases: (...args: unknown[]) => mockReorderAliases(...args),
  refreshAliasPresets: (...args: unknown[]) => mockRefreshAliasPresets(...args),
}));

const providers = ref<OpencodeProviderInfo[]>([
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-5", name: "GPT-5" },
    ],
  },
]);
const connected = ref(["openai"]);

const makeAlias = (
  overrides?: Partial<OpencodeModelAlias>,
): OpencodeModelAlias => ({
  id: "alias-1",
  providerID: "openai",
  modelID: "gpt-4o",
  alias: "GPT-4o",
  orderIdx: 0,
  ...overrides,
});

describe("useOpencodeAliasEditor", () => {
  setupStoreTest(() => {
    providers.value = [
      {
        id: "openai",
        name: "OpenAI",
        models: [
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-5", name: "GPT-5" },
        ],
      },
    ];
    connected.value = ["openai"];
  });

  it("新增 alias 時會展開 provider、建立 draft，儲存後沿用 store/API 流程", async () => {
    const store = useOpencodeAliasStore();
    store.setAliases([makeAlias()]);
    const editor = useOpencodeAliasEditor({ providers, connected });

    editor.handleAddClick(
      "openai",
      editor.firstDraftSelectableModelIDByProvider.value.openai ?? "",
    );

    expect(editor.isProviderExpanded("openai")).toBe(true);
    expect(editor.draftRows.value.openai).toEqual({
      modelID: "gpt-5",
      alias: "",
    });

    const created = makeAlias({
      id: "alias-2",
      modelID: "gpt-5",
      alias: "GPT-5",
      orderIdx: 1,
    });
    mockCreateAlias.mockResolvedValueOnce(created);

    await editor.handleDraftSave("openai", {
      modelID: "gpt-5",
      alias: "GPT-5",
    });

    expect(mockCreateAlias).toHaveBeenCalledWith({
      providerID: "openai",
      modelID: "gpt-5",
      alias: "GPT-5",
    });
    expect(editor.draftRows.value.openai).toBeNull();
    expect(store.aliases.map((alias) => alias.id)).toEqual([
      "alias-1",
      "alias-2",
    ]);
  });

  it("alias 名稱重複時不會呼叫新增 API 並保留 draft 狀態", async () => {
    const store = useOpencodeAliasStore();
    store.setAliases([makeAlias({ alias: "GPT-4o" })]);
    const editor = useOpencodeAliasEditor({ providers, connected });
    editor.handleAddClick("openai", "gpt-5");

    await editor.handleDraftSave("openai", {
      modelID: "gpt-5",
      alias: "GPT-4o",
    });

    expect(mockCreateAlias).not.toHaveBeenCalled();
    expect(editor.draftRows.value.openai).toEqual({
      modelID: "gpt-5",
      alias: "",
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: "llmProvider.opencode.aliases.aliasDuplicateError",
      variant: "destructive",
    });
  });

  it("編輯、刪除與排序 alias 時會呼叫既有 store/API 流程並同步狀態", async () => {
    const store = useOpencodeAliasStore();
    const aliasOne = makeAlias();
    const aliasTwo = makeAlias({
      id: "alias-2",
      modelID: "gpt-5",
      alias: "GPT-5",
      orderIdx: 1,
    });
    store.setAliases([aliasOne, aliasTwo]);
    const editor = useOpencodeAliasEditor({ providers, connected });
    await nextTick();

    editor.handleStartEdit("alias-1");
    mockUpdateAlias.mockResolvedValueOnce(
      makeAlias({ id: "alias-1", alias: "GPT-4o mini" }),
    );

    await editor.handleEditSave("alias-1", "openai", {
      modelID: "gpt-4o",
      alias: "GPT-4o mini",
    });

    expect(mockUpdateAlias).toHaveBeenCalledWith({
      id: "alias-1",
      modelID: "gpt-4o",
      alias: "GPT-4o mini",
    });
    expect(editor.editingAliasId.value).toBeNull();

    editor.updateAliasListForProvider("openai", [aliasTwo, aliasOne]);
    mockReorderAliases.mockResolvedValueOnce([
      { ...aliasTwo, orderIdx: 0 },
      { ...aliasOne, orderIdx: 1 },
    ]);

    await editor.handleAliasReorder("openai");

    expect(mockReorderAliases).toHaveBeenCalledWith(["alias-2", "alias-1"]);

    editor.handleDeleteClick("alias-2", "GPT-5");
    expect(editor.deleteConfirmOpen.value).toBe(true);
    expect(editor.pendingDeleteAlias.value).toBe("GPT-5");
    mockDeleteAlias.mockResolvedValueOnce(undefined);

    await editor.handleDeleteConfirm();

    expect(mockDeleteAlias).toHaveBeenCalledWith("alias-2");
    expect(editor.deleteConfirmOpen.value).toBe(false);
    expect(editor.pendingDeleteAlias.value).toBe("");
  });

  it("重新整理 presets 時會更新 loading set 並呼叫 refreshPresets", async () => {
    const store = useOpencodeAliasStore();
    store.setAliases([makeAlias()]);
    const editor = useOpencodeAliasEditor({ providers, connected });
    mockRefreshAliasPresets.mockImplementationOnce(async () => {
      expect(editor.refreshingAliasIds.value.has("alias-1")).toBe(true);
      return makeAlias({
        thinkingLevels: ["high"],
        defaultThinkingLevel: "high",
      });
    });

    await editor.handleRefreshPresets("alias-1");

    expect(mockRefreshAliasPresets).toHaveBeenCalledWith("alias-1");
    expect(editor.refreshingAliasIds.value.has("alias-1")).toBe(false);
    expect(toastMock).toHaveBeenCalledWith({
      title: "llmProvider.opencode.aliases.refreshSuccess",
    });
  });
});
