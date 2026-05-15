import { describe, it, expect, vi } from "vitest";
import { setupStoreTest } from "../helpers/testSetup";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import type { OpencodeModelAlias } from "@/types/opencode";

// ── opencodeApi Mock ───────────────────────────────────────────────────────────

const mockListAliases = vi.fn();
const mockCreateAlias = vi.fn();
const mockUpdateAlias = vi.fn();
const mockDeleteAlias = vi.fn();
const mockReorderAliases = vi.fn();

vi.mock("@/services/opencodeApi", () => ({
  listAliases: (...args: unknown[]) => mockListAliases(...args),
  createAlias: (...args: unknown[]) => mockCreateAlias(...args),
  updateAlias: (...args: unknown[]) => mockUpdateAlias(...args),
  deleteAlias: (...args: unknown[]) => mockDeleteAlias(...args),
  reorderAliases: (...args: unknown[]) => mockReorderAliases(...args),
}));

// ── Test Fixtures ──────────────────────────────────────────────────────────────

function makeAlias(
  overrides?: Partial<OpencodeModelAlias>,
): OpencodeModelAlias {
  return {
    id: "alias-1",
    providerID: "openai",
    modelID: "gpt-4o",
    alias: "GPT-4o",
    sortOrder: 0,
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe("opencodeAliasStore", () => {
  setupStoreTest();

  // ──────────────────────────────────────────────────────────────────────────────
  // (1) addAlias 成功後本地 state 多一筆 row
  // ──────────────────────────────────────────────────────────────────────────────
  describe("addAlias", () => {
    it("(1) 成功後本地 state 多一筆 row", async () => {
      const store = useOpencodeAliasStore();
      const newAlias = makeAlias();

      mockCreateAlias.mockResolvedValueOnce(newAlias);

      await store.addAlias({
        providerID: newAlias.providerID,
        modelID: newAlias.modelID,
        alias: newAlias.alias,
        sortOrder: newAlias.sortOrder,
      });

      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]).toEqual(newAlias);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (2) editAlias 後對應 row 的 alias 欄位更新
  // ──────────────────────────────────────────────────────────────────────────────
  describe("editAlias", () => {
    it("(2) 後對應 row 的 alias 欄位更新", async () => {
      const store = useOpencodeAliasStore();
      const original = makeAlias({
        id: "alias-1",
        alias: "Old Name",
        modelID: "claude-3-5-sonnet",
      });
      store.setAliases([original]);

      const updated = makeAlias({
        id: "alias-1",
        alias: "New Name",
        modelID: "claude-3-5-sonnet",
      });
      mockUpdateAlias.mockResolvedValueOnce(updated);

      await store.editAlias({
        id: "alias-1",
        modelID: "claude-3-5-sonnet",
        alias: "New Name",
      });

      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.alias).toBe("New Name");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (3) removeAlias 後該 row 從 state 消失
  // ──────────────────────────────────────────────────────────────────────────────
  describe("removeAlias", () => {
    it("(3) 後該 row 從 state 消失", async () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1" }),
        makeAlias({ id: "alias-2", alias: "B" }),
      ]);

      mockDeleteAlias.mockResolvedValueOnce(undefined);

      await store.removeAlias("alias-1");

      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.id).toBe("alias-2");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (4) reorder 後 aliases 順序與傳入 idsInOrder 一致
  // ──────────────────────────────────────────────────────────────────────────────
  describe("reorder", () => {
    it("(4) 後 aliases 順序與傳入 idsInOrder 一致", async () => {
      const store = useOpencodeAliasStore();
      const a1 = makeAlias({ id: "alias-1", sortOrder: 0 });
      const a2 = makeAlias({ id: "alias-2", alias: "B", sortOrder: 1 });
      store.setAliases([a1, a2]);

      // 後端回傳重排後的清單（a2 在前 sortOrder 0, a1 在後 sortOrder 1）
      const reordered = [
        { ...a2, sortOrder: 0 },
        { ...a1, sortOrder: 1 },
      ];
      mockReorderAliases.mockResolvedValueOnce(reordered);

      await store.reorder(["alias-2", "alias-1"]);

      expect(store.aliases[0]!.id).toBe("alias-2");
      expect(store.aliases[1]!.id).toBe("alias-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (5) isAliasUnique 同 providerID 偵測重複回 false、跨 providerID 同名回 true
  // ──────────────────────────────────────────────────────────────────────────────
  describe("isAliasUnique", () => {
    it("(5a) 同 providerID 內偵測到重複時回傳 false", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      // 同 provider、同 alias → 不唯一
      expect(store.isAliasUnique("openai", "GPT-4o")).toBe(false);
    });

    it("(5b) 跨 providerID 同名時回傳 true", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      // 不同 provider，相同 alias → 允許（唯一）
      expect(store.isAliasUnique("anthropic", "GPT-4o")).toBe(true);
    });

    it("(5c) excludeId 排除自身時回傳 true（編輯場景）", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "alias-1", providerID: "openai", alias: "GPT-4o" }),
      ]);

      // 編輯時傳入自身 id → 排除自身後不衝突
      expect(store.isAliasUnique("openai", "GPT-4o", "alias-1")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (6) aliasesByProvider 依 sortOrder 升冪
  // ──────────────────────────────────────────────────────────────────────────────
  describe("aliasesByProvider", () => {
    it("(6) 依 sortOrder 升冪排序，並只回傳指定 provider 的 alias", () => {
      const store = useOpencodeAliasStore();
      store.setAliases([
        makeAlias({ id: "a3", providerID: "openai", alias: "C", sortOrder: 2 }),
        makeAlias({ id: "a1", providerID: "openai", alias: "A", sortOrder: 0 }),
        makeAlias({ id: "a2", providerID: "openai", alias: "B", sortOrder: 1 }),
        makeAlias({
          id: "a4",
          providerID: "anthropic",
          alias: "D",
          sortOrder: 0,
        }),
      ]);

      const openaiAliases = store.aliasesByProvider("openai");
      expect(openaiAliases).toHaveLength(3);
      expect(openaiAliases[0]!.id).toBe("a1");
      expect(openaiAliases[1]!.id).toBe("a2");
      expect(openaiAliases[2]!.id).toBe("a3");

      // anthropic 不混入
      expect(openaiAliases.every((a) => a.providerID === "openai")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (7) mocked listAliases 拋錯時 loadFromBackend() 不改動既有 aliases、loaded 不變
  // ──────────────────────────────────────────────────────────────────────────────
  describe("loadFromBackend 失敗路徑", () => {
    it("(7) listAliases 拋錯時不改動既有 aliases、loaded 值不變", async () => {
      const store = useOpencodeAliasStore();
      const existing = makeAlias({ id: "existing-1" });
      store.setAliases([existing]);
      // loaded 初始 false，維持 false
      expect(store.loaded).toBe(false);

      mockListAliases.mockRejectedValueOnce(new Error("網路錯誤"));

      await store.loadFromBackend();

      // aliases 不變
      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.id).toBe("existing-1");
      // loaded 維持 false（從未成功）
      expect(store.loaded).toBe(false);
    });

    it("(7b) 已成功載入後再失敗時，loaded 維持 true、aliases 保留上次成功值", async () => {
      const store = useOpencodeAliasStore();
      const items = [makeAlias({ id: "a1" })];

      // 第一次成功
      mockListAliases.mockResolvedValueOnce(items);
      await store.loadFromBackend();
      expect(store.loaded).toBe(true);
      expect(store.aliases).toHaveLength(1);

      // 第二次失敗
      mockListAliases.mockRejectedValueOnce(new Error("重連超時"));
      await store.loadFromBackend();

      // loaded 仍為 true
      expect(store.loaded).toBe(true);
      // aliases 保留上次成功值
      expect(store.aliases).toHaveLength(1);
      expect(store.aliases[0]!.id).toBe("a1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // (8) mocked createAlias 拋錯時 addAlias() rethrow、本地 aliases 未新增
  // ──────────────────────────────────────────────────────────────────────────────
  describe("addAlias 失敗路徑", () => {
    it("(8) createAlias 拋錯時 rethrow 且本地 aliases 未新增", async () => {
      const store = useOpencodeAliasStore();
      expect(store.aliases).toHaveLength(0);

      mockCreateAlias.mockRejectedValueOnce(new Error("後端錯誤"));

      await expect(
        store.addAlias({
          providerID: "openai",
          modelID: "gpt-4o",
          alias: "GPT-4o",
          sortOrder: 0,
        }),
      ).rejects.toThrow("後端錯誤");

      // 本地 state 未被修改
      expect(store.aliases).toHaveLength(0);
    });
  });
});
