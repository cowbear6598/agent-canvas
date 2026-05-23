import { describe, it, expect, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import type { OpencodeModelAlias } from "@/types/opencode";

const mockListAliases = vi.fn();
const mockCreateAlias = vi.fn();

vi.mock("@/services/opencodeApi", () => ({
  listAliases: (...args: unknown[]) => mockListAliases(...args),
  createAlias: (...args: unknown[]) => mockCreateAlias(...args),
}));

function makeAlias(
  overrides?: Partial<OpencodeModelAlias>,
): OpencodeModelAlias {
  return {
    id: "alias-1",
    providerID: "openai",
    modelID: "gpt-4o",
    alias: "GPT-4o",
    orderIdx: 0,
    ...overrides,
  };
}

describe("opencodeAliasStore", () => {
  setupStoreTest();

  describe("isAliasUnique", () => {
    it("同 providerID 內偵測到重複 alias 時回傳 false", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      expect(store.isAliasUnique("openai", "GPT-4o")).toBe(false);
    });

    it("跨 providerID 同名 alias 時回傳 true", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      expect(store.isAliasUnique("anthropic", "GPT-4o")).toBe(true);
    });

    it("編輯時 excludeId 會排除自己", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      expect(store.isAliasUnique("openai", "GPT-4o", "alias-1")).toBe(true);
    });
  });

  describe("isModelAliasUnique", () => {
    it("同 providerID 且同 modelID 時回傳 false", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({
          id: "alias-1",
          providerID: "openai",
          modelID: "gpt-4o",
        }),
      ]);

      expect(store.isModelAliasUnique("openai", "gpt-4o")).toBe(false);
    });

    it("不同 providerID 但相同 modelID 時回傳 true", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({
          id: "alias-1",
          providerID: "openai",
          modelID: "gpt-4o",
        }),
      ]);

      expect(store.isModelAliasUnique("anthropic", "gpt-4o")).toBe(true);
    });

    it("編輯時 excludeId 會排除自己的 modelID", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({
          id: "alias-1",
          providerID: "openai",
          modelID: "gpt-4o",
        }),
      ]);

      expect(store.isModelAliasUnique("openai", "gpt-4o", "alias-1")).toBe(
        true,
      );
    });
  });

  describe("loadFromBackend 失敗路徑", () => {
    it("listAliases 拋錯時不改動既有 aliases、loaded 值不變", async () => {
      const store = useOpencodeAliasStore();
      const existing = makeAlias({ id: "existing-1" });
      store.setAliases([existing]);
      expect(store.loaded).toBe(false);

      mockListAliases.mockRejectedValueOnce(new Error("網路錯誤"));

      await store.loadFromBackend();

      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.id).toBe("existing-1");
      expect(store.loaded).toBe(false);
    });

    it("成功載入後再次失敗時，loaded 維持 true 且保留上次成功資料", async () => {
      const store = useOpencodeAliasStore();
      const items = [makeAlias({ id: "a1" })];

      mockListAliases.mockResolvedValueOnce(items);
      await store.loadFromBackend();
      expect(store.loaded).toBe(true);
      expect(store.aliases).toHaveLength(1);

      mockListAliases.mockRejectedValueOnce(new Error("重連超時"));
      await store.loadFromBackend();

      expect(store.loaded).toBe(true);
      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.id).toBe("a1");
    });
  });

  describe("addAlias 失敗路徑", () => {
    it("createAlias 拋錯時會 rethrow，且本地 aliases 不會被污染", async () => {
      const store = useOpencodeAliasStore();
      expect(store.aliases).toHaveLength(0);

      mockCreateAlias.mockRejectedValueOnce(new Error("後端錯誤"));

      await expect(
        store.addAlias({
          providerID: "openai",
          modelID: "gpt-4o",
          alias: "GPT-4o",
        }),
      ).rejects.toThrow("後端錯誤");

      expect(store.aliases).toHaveLength(0);
    });
  });
});
