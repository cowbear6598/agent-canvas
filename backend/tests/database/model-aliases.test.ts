import { initTestDb, closeDb } from "../../src/database/index.js";
import {
  getStatements,
  resetStatements,
} from "../../src/database/statements.js";
import { Database } from "bun:sqlite";

// model_aliases CRUD 整合測試：以真實 SQLite 記憶體資料庫驗證
describe("model_aliases CRUD", () => {
  let db: Database;

  beforeEach(() => {
    resetStatements();
    db = initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  const NOW = Date.now();

  function insertAlias(
    id: string,
    alias: string,
    orderIdx: number,
    realProvider = "anthropic",
    realModel = "claude-3-5-sonnet",
    providerId = "opencode",
  ): void {
    const stmts = getStatements(db);
    stmts.modelAlias.insert.run({
      $id: id,
      $providerId: providerId,
      $realProvider: realProvider,
      $realModel: realModel,
      $alias: alias,
      $orderIdx: orderIdx,
      $createdAt: NOW,
      $updatedAt: NOW,
    });
  }

  it("insert 後依 order_idx 升序 list 出來", () => {
    // 故意以亂序插入，驗證 selectByProviderId 依 order_idx 升序回傳
    insertAlias("id-2", "Alias B", 2);
    insertAlias("id-0", "Alias A", 0);
    insertAlias("id-1", "Alias C", 1);

    const stmts = getStatements(db);
    const rows = stmts.modelAlias.selectByProviderId.all({
      $providerId: "opencode",
    }) as { id: string; alias: string; order_idx: number }[];

    expect(rows).toHaveLength(3);
    expect(rows[0].order_idx).toBe(0);
    expect(rows[0].alias).toBe("Alias A");
    expect(rows[1].order_idx).toBe(1);
    expect(rows[1].alias).toBe("Alias C");
    expect(rows[2].order_idx).toBe(2);
    expect(rows[2].alias).toBe("Alias B");
  });

  it("update alias 與 order_idx 後 list 結果對應更新", () => {
    insertAlias("id-1", "Old Alias", 0);
    insertAlias("id-2", "Another", 1);

    const stmts = getStatements(db);
    // 將 id-1 的 alias 改名且移到最後
    stmts.modelAlias.updateAliasAndOrderIdx.run({
      $id: "id-1",
      $alias: "New Alias",
      $orderIdx: 99,
      $updatedAt: NOW + 1000,
    });

    const rows = stmts.modelAlias.selectByProviderId.all({
      $providerId: "opencode",
    }) as { id: string; alias: string; order_idx: number }[];

    expect(rows).toHaveLength(2);
    // order_idx 升序：id-2 (1) 排在前，id-1 (99) 排在後
    expect(rows[0].id).toBe("id-2");
    expect(rows[1].id).toBe("id-1");
    expect(rows[1].alias).toBe("New Alias");
    expect(rows[1].order_idx).toBe(99);
  });

  it("delete 後 list 少一筆", () => {
    insertAlias("id-1", "Alias 1", 0);
    insertAlias("id-2", "Alias 2", 1);
    insertAlias("id-3", "Alias 3", 2);

    const stmts = getStatements(db);
    stmts.modelAlias.deleteById.run("id-2");

    const rows = stmts.modelAlias.selectByProviderId.all({
      $providerId: "opencode",
    }) as { id: string }[];

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).not.toContain("id-2");
    expect(rows.map((r) => r.id)).toContain("id-1");
    expect(rows.map((r) => r.id)).toContain("id-3");
  });

  it("同一 provider_id 內 alias 重複時 DB 拋 UNIQUE 違反錯誤", () => {
    // UNIQUE(provider_id, real_provider, alias) 約束驗證
    insertAlias("id-1", "Dup Alias", 0, "anthropic");

    expect(() => {
      insertAlias("id-2", "Dup Alias", 1, "anthropic");
    }).toThrow();
  });

  it("selectMaxOrderIdxByProviderId 在沒有資料時回傳 -1", () => {
    const stmts = getStatements(db);
    const result = stmts.modelAlias.selectMaxOrderIdxByProviderId.get({
      $providerId: "opencode",
    }) as { max_order_idx: number };

    expect(result.max_order_idx).toBe(-1);
  });

  it("selectMaxOrderIdxByProviderId 在有資料時回傳最大值", () => {
    insertAlias("id-1", "Alias 1", 3);
    insertAlias("id-2", "Alias 2", 7);
    insertAlias("id-3", "Alias 3", 1);

    const stmts = getStatements(db);
    const result = stmts.modelAlias.selectMaxOrderIdxByProviderId.get({
      $providerId: "opencode",
    }) as { max_order_idx: number };

    expect(result.max_order_idx).toBe(7);
  });
});
