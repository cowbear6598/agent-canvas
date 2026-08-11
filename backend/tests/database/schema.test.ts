import { initTestDb, closeDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { createTables } from "../../src/database/schema.js";
import { Database } from "bun:sqlite";

describe("Pod Fast mode 與退役 Codex 模型 migration", () => {
  let db: Database;

  beforeEach(() => {
    resetStatements();
    db = initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("將 Pod 的退役 Codex 模型轉換為 gpt-5.6-luna / high", () => {
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

    expect(row.model).toBe("gpt-5.6-luna");
    expect(row.thinkingLevel).toBe("high");
  });

  it("將 Connection Line 摘要與分支共用模型轉換為 gpt-5.6-luna / high", () => {
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
          summary_model, summary_thinking_level)
       VALUES ('conn1', 'c1', 'src', 'bottom', 'tgt', 'top', 'gpt-5.5', 'medium')`,
    );

    // 模擬後端重啟：再次執行 createTables 觸發 migration
    createTables(db);

    const row = db
      .prepare(
        "SELECT summary_model, summary_thinking_level FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string; summary_thinking_level: string };

    expect(row.summary_model).toBe("gpt-5.6-luna");
    expect(row.summary_thinking_level).toBe("high");
  });

  it("將全域 Memory 與 Connection Line 設定轉換為 Luna / high", () => {
    db.exec(
      `INSERT INTO global_settings (key, value)
       VALUES ('memory_model', 'gpt-5.5'),
              ('memory_thinking_level', 'low'),
              ('connection_line_model', 'gpt-5.5'),
              ('connection_line_thinking_level', 'max')`,
    );

    createTables(db);

    const rows = db
      .prepare(
        "SELECT key, value FROM global_settings WHERE key IN ('memory_model', 'memory_thinking_level', 'connection_line_model', 'connection_line_thinking_level') ORDER BY key",
      )
      .all() as Array<{ key: string; value: string }>;

    expect(rows).toEqual([
      { key: "connection_line_model", value: "gpt-5.6-luna" },
      { key: "connection_line_thinking_level", value: "high" },
      { key: "memory_model", value: "gpt-5.6-luna" },
      { key: "memory_thinking_level", value: "high" },
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
    expect(row1.model).toBe("gpt-5.6-luna");

    // 第三次
    expect(() => createTables(db)).not.toThrow();

    const row2 = db
      .prepare(
        "SELECT json_extract(provider_config_json, '$.model') AS model FROM pods WHERE id = 'p1'",
      )
      .get() as { model: string };
    expect(row2.model).toBe("gpt-5.6-luna");
  });

  it("migration 只改退役 Codex model，不會誤改其他合法 model 與 thinking level", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p1', 'c1', 'pod-a', '/ws1', '${JSON.stringify({ model: "gpt-5.4" })}')`,
    );
    db.exec(
      `INSERT INTO pods (id, canvas_id, name, workspace_path, provider_config_json)
       VALUES ('p2', 'c1', 'pod-b', '/ws2', '${JSON.stringify({ model: "gpt-5.6-luna", thinkingLevel: "max" })}')`,
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
        "SELECT id, json_extract(provider_config_json, '$.model') AS model, json_extract(provider_config_json, '$.thinkingLevel') AS thinkingLevel FROM pods ORDER BY id",
      )
      .all() as { id: string; model: string; thinkingLevel: string | null }[];

    expect(pods.find((p) => p.id === "p1")?.model).toBe("gpt-5.6-luna");
    expect(pods.find((p) => p.id === "p2")?.model).toBe("gpt-5.6-luna");
    expect(pods.find((p) => p.id === "p2")?.thinkingLevel).toBe("max");
    expect(pods.find((p) => p.id === "p3")?.model).toBe("opus");

    const conn = db
      .prepare(
        "SELECT summary_model FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string };

    expect(conn.summary_model).toBe("sonnet");
  });

  it("既有 Pod 缺少 Fast 欄位時補為關閉，且重複初始化不改變狀態", () => {
    db.exec(
      "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'canvas1', 0)",
    );
    db.exec(
      "INSERT INTO pods (id, canvas_id, name, workspace_path, fast_mode_enabled) VALUES ('p1', 'c1', 'pod1', '/ws', 1)",
    );

    createTables(db);
    createTables(db);

    const rows = db
      .prepare("SELECT id, fast_mode_enabled FROM pods ORDER BY id")
      .all() as Array<{ id: string; fast_mode_enabled: number }>;

    expect(rows).toEqual([{ id: "p1", fast_mode_enabled: 1 }]);

    db.exec(
      "INSERT INTO pods (id, canvas_id, name, workspace_path) VALUES ('p2', 'c1', 'pod2', '/ws2')",
    );
    const defaultValue = db
      .prepare("SELECT fast_mode_enabled FROM pods WHERE id = 'p2'")
      .get() as { fast_mode_enabled: number };
    expect(defaultValue.fast_mode_enabled).toBe(0);
  });
});
