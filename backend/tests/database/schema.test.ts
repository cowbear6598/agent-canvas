import { initTestDb, closeDb } from "../../src/database/index.js";
import {
  getStatements,
  resetStatements,
} from "../../src/database/statements.js";
import { createTables } from "../../src/database/schema.js";
import { Database } from "bun:sqlite";

// Schema 結構驗證：建立、CASCADE 刪除、Prepared Statements CRUD
describe("Database", () => {
  let db: Database;

  beforeEach(() => {
    resetStatements();
    db = initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  describe("CASCADE 刪除", () => {
    it("刪除 canvas 時應連帶刪除所有子資料", () => {
      db.exec(
        "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'test', 0)",
      );
      db.exec(
        "INSERT INTO pods (id, canvas_id, name, workspace_path) VALUES ('p1', 'c1', 'pod1', '/ws')",
      );
      db.exec(
        "INSERT INTO integration_apps (id, provider, name, config_json) VALUES ('ia1', 'slack', 'app', '{}')",
      );
      db.exec(
        `INSERT INTO integration_bindings
          (id, pod_id, canvas_id, provider, app_id, resource_id)
          VALUES ('ib1', 'p1', 'c1', 'slack', 'ia1', 'res1')`,
      );
      db.exec(
        `INSERT INTO connections
          (id, canvas_id, source_pod_id, source_anchor, target_pod_id, target_anchor)
          VALUES ('conn1', 'c1', 'p1', 'bottom', 'p1', 'top')`,
      );
      db.exec(
        "INSERT INTO notes (id, canvas_id, type, name) VALUES ('n1', 'c1', 'skill', 'note1')",
      );
      db.exec(
        "INSERT INTO pod_plugin_ids (pod_id, plugin_id) VALUES ('p1', 'plg1')",
      );

      db.exec("DELETE FROM canvases WHERE id = 'c1'");

      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM pods").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .prepare("SELECT COUNT(*) as count FROM integration_bindings")
            .get() as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM connections").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM notes").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM pod_plugin_ids").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
    });

    it("刪除 pod 時應連帶刪除多對多關聯及 integration_bindings", () => {
      db.exec(
        "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'test', 0)",
      );
      db.exec(
        "INSERT INTO pods (id, canvas_id, name, workspace_path) VALUES ('p1', 'c1', 'pod1', '/ws')",
      );
      db.exec(
        "INSERT INTO integration_apps (id, provider, name, config_json) VALUES ('ia1', 'slack', 'app', '{}')",
      );
      db.exec(
        `INSERT INTO integration_bindings
          (id, pod_id, canvas_id, provider, app_id, resource_id)
          VALUES ('ib1', 'p1', 'c1', 'slack', 'ia1', 'res1')`,
      );
      db.exec(
        "INSERT INTO pod_plugin_ids (pod_id, plugin_id) VALUES ('p1', 'plg1')",
      );

      db.exec("DELETE FROM pods WHERE id = 'p1'");

      expect(
        (
          db
            .prepare("SELECT COUNT(*) as count FROM integration_bindings")
            .get() as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM pod_plugin_ids").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
    });
  });

  describe("Prepared Statements", () => {
    it("應該能用 prepared statements 執行 CRUD", () => {
      const stmts = getStatements(db);

      stmts.canvas.insert.run({
        $id: "c1",
        $name: "test-canvas",
        $sortIndex: 0,
      });

      const canvas = stmts.canvas.selectById.get("c1") as {
        id: string;
        name: string;
        sort_index: number;
      };
      expect(canvas.id).toBe("c1");
      expect(canvas.name).toBe("test-canvas");
      expect(canvas.sort_index).toBe(0);

      const all = stmts.canvas.selectAll.all() as unknown[];
      expect(all).toHaveLength(1);

      stmts.canvas.updateName.run({ $id: "c1", $name: "renamed" });
      const updated = stmts.canvas.selectById.get("c1") as { name: string };
      expect(updated.name).toBe("renamed");

      stmts.canvas.deleteById.run("c1");
      const deleted = stmts.canvas.selectById.get("c1");
      expect(deleted).toBeNull();
    });

    it("應該能操作 pod 及其多對多關聯", () => {
      const stmts = getStatements(db);

      stmts.canvas.insert.run({ $id: "c1", $name: "canvas", $sortIndex: 0 });

      stmts.pod.insert.run({
        $id: "p1",
        $canvasId: "c1",
        $name: "pod1",
        $x: 100,
        $y: 200,
        $rotation: 0,
        $workspacePath: "/workspace/p1",
        $sessionId: null,
        $repositoryId: null,
        $goalJson: null,
        $scheduleJson: null,
        $provider: "claude",
        $providerConfigJson: JSON.stringify({ model: "opus" }),
      });

      stmts.podMcpServerNames.insert.run({
        $podId: "p1",
        $mcpServerName: "server-a",
      });
      stmts.podMcpServerNames.insert.run({
        $podId: "p1",
        $mcpServerName: "server-b",
      });

      const mcpNames = stmts.podMcpServerNames.selectByPodId.all("p1") as {
        mcp_server_name: string;
      }[];
      expect(mcpNames).toHaveLength(2);
      expect(mcpNames.map((m) => m.mcp_server_name).sort()).toEqual([
        "server-a",
        "server-b",
      ]);

      // INSERT OR IGNORE 重複不報錯
      stmts.podMcpServerNames.insert.run({
        $podId: "p1",
        $mcpServerName: "server-a",
      });
      const mcpAfterDup = stmts.podMcpServerNames.selectByPodId.all(
        "p1",
      ) as unknown[];
      expect(mcpAfterDup).toHaveLength(2);

      stmts.podMcpServerNames.deleteByPodId.run("p1");
      const mcpAfterDelete = stmts.podMcpServerNames.selectByPodId.all(
        "p1",
      ) as unknown[];
      expect(mcpAfterDelete).toHaveLength(0);
    });

    it("應該能操作 connection", () => {
      const stmts = getStatements(db);

      stmts.canvas.insert.run({ $id: "c1", $name: "canvas", $sortIndex: 0 });

      stmts.connection.insert.run({
        $id: "conn1",
        $canvasId: "c1",
        $sourcePodId: "p1",
        $sourceAnchor: "bottom",
        $targetPodId: "p2",
        $targetAnchor: "top",
        $triggerMode: "auto",
        $decideStatus: "none",
        $decideReason: null,
        $connectionStatus: "idle",
        $summaryModel: "sonnet",
        $summaryProvider: null,
        $label: "test-label",
        $description: null,
        $branchProvider: null,
        $branchModel: null,
      });

      const conn = stmts.connection.selectById.get("c1", "conn1") as {
        source_pod_id: string;
        trigger_mode: string;
      };
      expect(conn.source_pod_id).toBe("p1");
      expect(conn.trigger_mode).toBe("auto");
    });

    it("應該能操作 note", () => {
      const stmts = getStatements(db);

      stmts.canvas.insert.run({ $id: "c1", $name: "canvas", $sortIndex: 0 });

      stmts.note.insert.run({
        $id: "n1",
        $canvasId: "c1",
        $type: "command",
        $name: "command-note",
        $x: 50,
        $y: 60,
        $boundToPodId: null,
        $originalPositionJson: null,
        $foreignKeyId: "cmd-1",
      });

      const notes = stmts.note.selectByCanvasIdAndType.all({
        $canvasId: "c1",
        $type: "command",
      }) as { foreign_key_id: string }[];
      expect(notes).toHaveLength(1);
      expect(notes[0].foreign_key_id).toBe("cmd-1");

      // 不同 type 不互相干擾
      stmts.note.insert.run({
        $id: "n2",
        $canvasId: "c1",
        $type: "skill",
        $name: "skill-note",
        $x: 100,
        $y: 120,
        $boundToPodId: null,
        $originalPositionJson: null,
        $foreignKeyId: "skill-1",
      });

      const commandNotes = stmts.note.selectByCanvasIdAndType.all({
        $canvasId: "c1",
        $type: "command",
      }) as unknown[];
      expect(commandNotes).toHaveLength(1);

      const skillNotes = stmts.note.selectByCanvasIdAndType.all({
        $canvasId: "c1",
        $type: "skill",
      }) as unknown[];
      expect(skillNotes).toHaveLength(1);
    });

    it("應該能操作 global_settings", () => {
      const stmts = getStatements(db);

      stmts.globalSettings.upsert.run({
        $key: "summaryModel",
        $value: "sonnet",
      });

      const setting = stmts.globalSettings.selectByKey.get("summaryModel") as {
        key: string;
        value: string;
      };
      expect(setting.key).toBe("summaryModel");
      expect(setting.value).toBe("sonnet");

      stmts.globalSettings.upsert.run({
        $key: "aiDecideModel",
        $value: "haiku",
      });

      const all = stmts.globalSettings.selectAll.all() as {
        key: string;
        value: string;
      }[];
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.key).sort()).toEqual([
        "aiDecideModel",
        "summaryModel",
      ]);

      // INSERT OR REPLACE 應更新既有 key
      stmts.globalSettings.upsert.run({ $key: "summaryModel", $value: "opus" });
      const updated = stmts.globalSettings.selectByKey.get("summaryModel") as {
        value: string;
      };
      expect(updated.value).toBe("opus");

      const allAfterUpdate = stmts.globalSettings.selectAll.all() as unknown[];
      expect(allAfterUpdate).toHaveLength(2);
    });
  });
});

describe("gpt-5.4-mini 模型 migration", () => {
  let db: Database;

  beforeEach(() => {
    resetStatements();
    db = initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("將 pods.provider_config_json.model = 'gpt-5.4-mini' 的資料轉換為 'gpt-5.4'", () => {
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

    expect(row.model).toBe("gpt-5.4");
    expect(row.thinkingLevel).toBe("medium");
  });

  it("將 connections.summary_model 與 branch_model 為 'gpt-5.4-mini' 的資料轉換為 'gpt-5.4'", () => {
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
          summary_model, branch_model)
       VALUES ('conn1', 'c1', 'src', 'bottom', 'tgt', 'top', 'gpt-5.4-mini', 'gpt-5.4-mini')`,
    );

    // 模擬後端重啟：再次執行 createTables 觸發 migration
    createTables(db);

    const row = db
      .prepare(
        "SELECT summary_model, branch_model FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string; branch_model: string };

    expect(row.summary_model).toBe("gpt-5.4");
    expect(row.branch_model).toBe("gpt-5.4");
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
    expect(row1.model).toBe("gpt-5.4");

    // 第三次
    expect(() => createTables(db)).not.toThrow();

    const row2 = db
      .prepare(
        "SELECT json_extract(provider_config_json, '$.model') AS model FROM pods WHERE id = 'p1'",
      )
      .get() as { model: string };
    expect(row2.model).toBe("gpt-5.4");
  });

  it("migration 不會誤改其他合法 model 值", () => {
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
          summary_model, branch_model)
       VALUES ('conn1', 'c1', 'p1', 'bottom', 'p2', 'top', 'sonnet', 'gpt-5.5')`,
    );

    createTables(db);

    const pods = db
      .prepare(
        "SELECT id, json_extract(provider_config_json, '$.model') AS model FROM pods ORDER BY id",
      )
      .all() as { id: string; model: string }[];

    expect(pods.find((p) => p.id === "p1")?.model).toBe("gpt-5.4");
    expect(pods.find((p) => p.id === "p2")?.model).toBe("gpt-5.5");
    expect(pods.find((p) => p.id === "p3")?.model).toBe("opus");

    const conn = db
      .prepare(
        "SELECT summary_model, branch_model FROM connections WHERE id = 'conn1'",
      )
      .get() as { summary_model: string; branch_model: string };

    expect(conn.summary_model).toBe("sonnet");
    expect(conn.branch_model).toBe("gpt-5.5");
  });
});
