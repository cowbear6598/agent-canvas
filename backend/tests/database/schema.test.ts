import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { createTables } from "../../src/database/schema.js";
import { Database } from "bun:sqlite";

describe("退役 Codex 模型 migration", () => {
  let db: Database;

  beforeEach(() => {
    resetStatements();
    db = initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("將 Pod 的 gpt-5.4 系列模型轉換為 gpt-5.5", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p1', 'c1', 'pod1', '/ws', '${JSON.stringify({ model: "gpt-5.4-mini", thinkingLevel: "medium" })}')`,
    );

    // 模擬後端重啟：再次執行 createTables 觸發 migration
    createTables(db);

    const row = db
      .prepare(
        "SELECT json_extract(provider_config_json, '$.model') AS model," +
          " json_extract(provider_config_json, '$.thinkingLevel') AS thinkingLevel" +
          " FROM pods WHERE id = 'p1'",
      )
      .get() as { model: string; thinkingLevel: string };

    expect(row.model).toBe("gpt-5.5");
    expect(row.thinkingLevel).toBe("medium");
  });

  it("將 Connection 的 gpt-5.4 系列模型轉換為 gpt-5.5", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      "INSERT INTO pods (id, canvas_id, name, workspace_path) VALUES ('src', 'c1', 'src-pod', '/ws')",
    );
    db.exec(
      "INSERT INTO pods (id, canvas_id, name, workspace_path) VALUES ('tgt', 'c1', 'tgt-pod', '/ws2')",
    );
    db.exec(
      `INSERT INTO connections
         (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
          summary_model)
       VALUES ('conn1', 'c1', 'src', 'bottom', 'tgt', 'top', 'gpt-5.4-mini')`,
    );

    // 模擬後端重啟：再次執行 createTables 觸發 migration
    createTables(db);

    const row = db
      .prepare(
        "SELECT summary_model FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string };

    expect(row.summary_model).toBe("gpt-5.5");
  });

  it("將全域設定的 gpt-5.4 系列模型轉換為 gpt-5.5", () => {
    db.exec(
      `INSERT INTO global_settings (key, value)
       VALUES ('memory_model', 'gpt-5.4'),
              ('connection_line_model', 'gpt-5.4-mini')`,
    );

    createTables(db);

    const rows = db
      .prepare(
        "SELECT key, value FROM global_settings WHERE key IN ('memory_model', 'connection_line_model') ORDER BY key",
      )
      .all() as Array<{ key: string; value: string }>;

    expect(rows).toEqual([
      { key: "connection_line_model", value: "gpt-5.5" },
      { key: "memory_model", value: "gpt-5.5" },
    ]);
  });

  it("migration 是冪等的", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p1', 'c1', 'pod1', '/ws', '${JSON.stringify({ model: "gpt-5.4-mini" })}')`,
    );

    // 第一次 createTables 已在 initTestDb 執行，再呼叫第二次
    expect(() => createTables(db)).not.toThrow();

    const row1 = db
      .prepare(
        "SELECT json_extract(provider_config_json, '$.model') AS model FROM pods WHERE id = 'p1'",
      )
      .get() as { model: string };
    expect(row1.model).toBe("gpt-5.5");

    // 第三次
    expect(() => createTables(db)).not.toThrow();

    const row2 = db
      .prepare(
        "SELECT json_extract(provider_config_json, '$.model') AS model FROM pods WHERE id = 'p1'",
      )
      .get() as { model: string };
    expect(row2.model).toBe("gpt-5.5");
  });

  it("migration 會轉換 gpt-5.4，且不會誤改其他合法 model 值", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p1', 'c1', 'pod-a', '/ws1', '${JSON.stringify({ model: "gpt-5.4" })}')`,
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p2', 'c1', 'pod-b', '/ws2', '${JSON.stringify({ model: "gpt-5.5" })}')`,
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p3', 'c1', 'pod-c', '/ws3', '${JSON.stringify({ model: "opus" })}')`,
    );
    db.exec(
      `INSERT INTO connections
         (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor,
          summary_model)
       VALUES ('conn1', 'c1', 'p1', 'bottom', 'p2', 'top', 'sonnet')`,
    );

    createTables(db);

    const pods = db
      .prepare(
        "SELECT id, json_extract(provider_config_json, '$.model') AS model FROM pods ORDER BY id",
      )
      .all() as { id: string; model: string }[];

    expect(pods.find((p) => p.id === "p1")?.model).toBe("gpt-5.5");
    expect(pods.find((p) => p.id === "p2")?.model).toBe("gpt-5.5");
    expect(pods.find((p) => p.id === "p3")?.model).toBe("opus");

    const conn = db
      .prepare(
        "SELECT summary_model FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string };

    expect(conn.summary_model).toBe("sonnet");
  });
});
