import {
  initTestDb,
  closeDb,
  resetDb,
  getDb,
} from "../../src/database/index.js";
import {
  getStatements,
  resetStatements,
} from "../../src/database/statements.js";
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

  describe("初始化", () => {
    it("應該建立所有資料表", () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      const tableNames = (tables as { name: string }[])
        .map((t) => t.name)
        .sort();
      expect(tableNames).toEqual([
        "canvases",
        "connections",
        "global_settings",
        "integration_apps",
        "integration_bindings",
        "messages",
        "notes",
        "pod_manifests",
        "pod_mcp_server_names",
        "pod_plugin_ids",
        "pods",
        "repository_metadata",
        "run_messages",
        "run_pod_instances",
        "workflow_runs",
      ]);
    });

    it("in-memory DB 的 journal_mode 應為 memory（WAL 不適用於記憶體資料庫）", () => {
      const result = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      // SQLite :memory: 資料庫不支援 WAL，會維持 memory mode
      expect(result.journal_mode).toBe("memory");
    });

    it("應該啟用外鍵約束", () => {
      const result = db.prepare("PRAGMA foreign_keys").get() as {
        foreign_keys: number;
      };
      expect(result.foreign_keys).toBe(1);
    });
  });

  describe("resetDb", () => {
    it("應該清空所有表資料", () => {
      db.exec(
        "INSERT INTO canvases (id, name, sort_index) VALUES ('c1', 'test', 0)",
      );
      db.exec(
        "INSERT INTO integration_apps (id, provider, name, config_json) VALUES ('ia1', 'slack', 'app', '{}')",
      );
      db.exec(
        "INSERT INTO repository_metadata (id, name, path) VALUES ('r1', 'repo', '/path')",
      );

      resetDb();

      expect(
        (
          db.prepare("SELECT COUNT(*) as count FROM canvases").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .prepare("SELECT COUNT(*) as count FROM integration_apps")
            .get() as { count: number }
        ).count,
      ).toBe(0);
      expect(
        (
          db
            .prepare("SELECT COUNT(*) as count FROM repository_metadata")
            .get() as { count: number }
        ).count,
      ).toBe(0);
    });
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
        `INSERT INTO messages
          (id, pod_id, canvas_id, role, content, timestamp)
          VALUES ('m1', 'p1', 'c1', 'user', 'hello', '2024-01-01')`,
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
        $status: "idle",
        $x: 100,
        $y: 200,
        $rotation: 0,
        $workspacePath: "/workspace/p1",
        $sessionId: null,
        $repositoryId: null,
        $commandId: null,
        $multiInstance: 0,
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
        $aiDecideModel: "sonnet",
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

    it("應該能操作 message", () => {
      const stmts = getStatements(db);

      stmts.message.insert.run({
        $id: "m1",
        $podId: "p1",
        $canvasId: "c1",
        $role: "user",
        $content: "hello",
        $timestamp: "2024-01-01T00:00:00Z",
        $subMessagesJson: null,
      });

      stmts.message.insert.run({
        $id: "m2",
        $podId: "p1",
        $canvasId: "c1",
        $role: "assistant",
        $content: "hi",
        $timestamp: "2024-01-01T00:00:01Z",
        $subMessagesJson: JSON.stringify([{ id: "sub1", content: "sub" }]),
      });

      const messages = stmts.message.selectByPodId.all("p1") as {
        role: string;
        sub_messages_json: string;
      }[];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");

      const parsed = JSON.parse(messages[1].sub_messages_json) as {
        id: string;
      }[];
      expect(parsed[0].id).toBe("sub1");

      // upsert 測試
      stmts.message.upsert.run({
        $id: "m1",
        $podId: "p1",
        $canvasId: "c1",
        $role: "user",
        $content: "updated",
        $timestamp: "2024-01-01T00:00:00Z",
        $subMessagesJson: null,
      });

      const updated = stmts.message.selectById.get("m1") as { content: string };
      expect(updated.content).toBe("updated");
    });
  });
});
