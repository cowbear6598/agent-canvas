import { connectionStore } from "../../src/services/connectionStore.js";
import {
  initTestDb,
  closeDb,
  resetDb,
  getDb,
} from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import type { ConnectionStatus } from "../../src/types/connection.js";

const ALL_CONNECTION_STATUSES: ConnectionStatus[] = [
  "idle",
  "active",
  "queued",
  "waiting",
];

describe("ConnectionStore SQLite 持久化", () => {
  const canvasId = "test-canvas-sqlite";

  beforeEach(() => {
    resetStatements();
    const db = initTestDb();
    db.exec(
      `INSERT INTO canvases (id, name, sort_index) VALUES ('${canvasId}', 'test canvas', 0)`,
    );
  });

  afterEach(() => {
    closeDb();
  });

  describe("create", () => {
    it("建立 connection 後可透過 getById 取得", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      const loaded = connectionStore.getById(canvasId, connection.id);

      expect(loaded).toBeDefined();
      expect(loaded?.sourcePodId).toBe("pod-a");
      expect(loaded?.targetPodId).toBe("pod-b");
      expect(loaded?.connectionStatus).toBe("idle");
      expect(loaded?.triggerMode).toBe("auto");
      expect(loaded?.decideStatus).toBe("none");
    });

    it("指定 triggerMode: branch 時正確儲存", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "bottom",
        targetPodId: "pod-b",
        targetAnchor: "top",
        triggerMode: "branch",
        label: "Test-Label",
      });

      const loaded = connectionStore.getById(canvasId, connection.id);
      expect(loaded?.triggerMode).toBe("branch");
    });

    it("建立時明確指定不支援的 summaryModel 應拒絕寫入", () => {
      expect(() =>
        connectionStore.create(canvasId, {
          sourcePodId: "pod-a",
          sourceAnchor: "right",
          targetPodId: "pod-b",
          targetAnchor: "left",
          summaryProvider: "claude",
          summaryModel: "no-such-model",
        }),
      ).toThrow("summaryModel 不支援 provider claude");
    });

    it("建立時明確指定不支援的 branchModel 應拒絕寫入", () => {
      expect(() =>
        connectionStore.create(canvasId, {
          sourcePodId: "pod-a",
          sourceAnchor: "right",
          targetPodId: "pod-b",
          targetAnchor: "left",
          triggerMode: "branch",
          label: "Test-Label",
          branchProvider: "codex",
          branchModel: "sonnet",
        }),
      ).toThrow("branchModel 不支援 provider codex");
    });

    it("建立 connection 時會把 source Pod 的 thinking level 寫入 summary 與 branch 欄位", () => {
      getDb()
        .prepare(
          `INSERT INTO pods
             (id, canvas_id, name, x, y, rotation, workspace_path,
              session_id, repository_id, goal_json, schedule_json, provider,
              provider_config_json)
           VALUES (?, ?, ?, 0, 0, 0, '/tmp/pod-a', NULL, NULL, NULL, NULL,
             'claude', ?)`,
        )
        .run(
          "pod-thinking",
          canvasId,
          "Thinking Pod",
          JSON.stringify({ model: "sonnet", thinkingLevel: "high" }),
        );

      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-thinking",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      expect(connection.summaryThinkingLevel).toBe("high");
      expect(connection.branchThinkingLevel).toBe("high");
      expect(connectionStore.getById(canvasId, connection.id)).toEqual(
        expect.objectContaining({
          summaryThinkingLevel: "high",
          branchThinkingLevel: "high",
        }),
      );
    });

    it("source Pod 未指定 thinking level 時會寫入 provider/model 的預設值", () => {
      getDb()
        .prepare(
          `INSERT INTO pods
             (id, canvas_id, name, x, y, rotation, workspace_path,
              session_id, repository_id, goal_json, schedule_json, provider,
              provider_config_json)
           VALUES (?, ?, ?, 0, 0, 0, '/tmp/pod-a', NULL, NULL, NULL, NULL,
             'codex', ?)`,
        )
        .run(
          "pod-default-thinking",
          canvasId,
          "Default Thinking Pod",
          JSON.stringify({ model: "gpt-5.5" }),
        );

      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-default-thinking",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      expect(connection.summaryThinkingLevel).toBe("medium");
      expect(connection.branchThinkingLevel).toBe("medium");
    });
  });

  describe("updateConnectionStatus", () => {
    it("狀態更新後立即反映到 DB", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      connectionStore.updateConnectionStatus(canvasId, connection.id, "active");

      const loaded = connectionStore.getById(canvasId, connection.id);
      expect(loaded?.connectionStatus).toBe("active");
    });

    it("connection 不存在時回傳 undefined", () => {
      const result = connectionStore.updateConnectionStatus(
        canvasId,
        "nonexistent-id",
        "active",
      );
      expect(result).toBeUndefined();
    });
  });

  describe("所有 ConnectionStatus 值的儲存/讀取一致性", () => {
    it.each(ALL_CONNECTION_STATUSES)(
      'status "%s" 寫入後可正確讀取',
      (status) => {
        const connection = connectionStore.create(canvasId, {
          sourcePodId: "pod-a",
          sourceAnchor: "right",
          targetPodId: "pod-b",
          targetAnchor: "left",
        });

        connectionStore.updateConnectionStatus(canvasId, connection.id, status);

        const loaded = connectionStore.getById(canvasId, connection.id);
        expect(loaded?.connectionStatus).toBe(status);
      },
    );
  });

  describe("list", () => {
    it("回傳該 canvas 所有 connections", () => {
      connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });
      connectionStore.create(canvasId, {
        sourcePodId: "pod-b",
        sourceAnchor: "bottom",
        targetPodId: "pod-c",
        targetAnchor: "top",
      });

      const connections = connectionStore.list(canvasId);
      expect(connections).toHaveLength(2);
    });

    it("不存在的 canvas 回傳空陣列", () => {
      const connections = connectionStore.list("nonexistent-canvas");
      expect(connections).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("刪除存在的 connection 回傳 true", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      const deleted = connectionStore.delete(canvasId, connection.id);
      expect(deleted).toBe(true);
      expect(connectionStore.getById(canvasId, connection.id)).toBeUndefined();
    });

    it("刪除不存在的 connection 回傳 false", () => {
      const deleted = connectionStore.delete(canvasId, "nonexistent-id");
      expect(deleted).toBe(false);
    });
  });

  describe("update", () => {
    it("更新 triggerMode 從 branch 到 auto 時重置 decide 狀態", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        triggerMode: "branch",
        label: "Test-Label",
      });

      connectionStore.update(canvasId, connection.id, {
        decideStatus: "approved",
        decideReason: "通過審核",
      });

      connectionStore.update(canvasId, connection.id, { triggerMode: "auto" });

      const loaded = connectionStore.getById(canvasId, connection.id);
      expect(loaded?.triggerMode).toBe("auto");
      expect(loaded?.decideStatus).toBe("none");
      expect(loaded?.decideReason).toBeNull();
      expect(loaded?.connectionStatus).toBe("idle");
    });

    it("更新 connection 不存在時回傳 undefined", () => {
      const result = connectionStore.update(canvasId, "nonexistent-id", {
        triggerMode: "auto",
      });
      expect(result).toBeUndefined();
    });

    it("更新時明確指定不支援的 summaryModel 應拒絕寫入", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });
      const before = connectionStore.getById(canvasId, connection.id);

      expect(() =>
        connectionStore.update(canvasId, connection.id, {
          summaryProvider: "codex",
          summaryModel: "sonnet",
        }),
      ).toThrow("summaryModel 不支援 provider codex");

      const loaded = connectionStore.getById(canvasId, connection.id);
      expect(loaded?.summaryProvider).toBe(before?.summaryProvider);
      expect(loaded?.summaryModel).toBe(before?.summaryModel);
    });

    it("更新 summary model 時未指定 thinking level 應重設為新模型預設值", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        summaryProvider: "claude",
        summaryModel: "sonnet",
        summaryThinkingLevel: "max",
      });

      const updated = connectionStore.update(canvasId, connection.id, {
        summaryModel: "haiku",
      });

      expect(updated?.summaryThinkingLevel).toBeNull();
    });

    it("更新 summary thinking level 為模型不支援的值時應拒絕寫入", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        summaryProvider: "codex",
        summaryModel: "gpt-5.5",
      });

      expect(() =>
        connectionStore.update(canvasId, connection.id, {
          summaryThinkingLevel: "max",
        }),
      ).toThrow("summaryThinkingLevel 不支援指定的 provider/model");
    });

    it("更新 summaryProvider 時若未指定 summaryModel 應寫入該 provider 預設模型", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        triggerMode: "branch",
        label: "Test-Label",
      });

      const updated = connectionStore.update(canvasId, connection.id, {
        summaryProvider: "codex",
      });

      expect(updated?.summaryProvider).toBe("codex");
      expect(updated?.summaryModel).toBe("gpt-5.5");
    });

    it("更新 summary provider/model 時未指定 thinking level 應重設為新模型預設值", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        triggerMode: "branch",
        label: "Test-Label",
        summaryProvider: "claude",
        summaryModel: "sonnet",
        summaryThinkingLevel: "max",
      });

      const updated = connectionStore.update(canvasId, connection.id, {
        summaryProvider: "codex",
        summaryModel: "gpt-5.5",
      });

      expect(updated?.summaryThinkingLevel).toBe("medium");
    });

    it("更新 summary thinking level 為模型不支援的值時應拒絕寫入", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        triggerMode: "branch",
        label: "Test-Label",
        summaryProvider: "codex",
        summaryModel: "gpt-5.5",
      });

      expect(() =>
        connectionStore.update(canvasId, connection.id, {
          summaryThinkingLevel: "max",
        }),
      ).toThrow("summaryThinkingLevel 不支援指定的 provider/model");
    });
  });

  describe("跨 Canvas 資源隔離", () => {
    const otherCanvasId = "other-canvas-id";

    beforeEach(() => {
      // 外層 beforeEach 已呼叫 resetStatements() + initTestDb() 並建立 canvasId
      // 這裡只需額外插入 otherCanvasId
      getDb().exec(
        `INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES ('${otherCanvasId}', 'other canvas', 1)`,
      );
    });

    it("getById 不允許用其他 canvas 的 connectionId 跨 Canvas 讀取", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      const result = connectionStore.getById(otherCanvasId, connection.id);
      expect(result).toBeUndefined();
    });

    it("delete 不允許用其他 canvas 的 connectionId 跨 Canvas 刪除", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      const deleted = connectionStore.delete(otherCanvasId, connection.id);
      expect(deleted).toBe(false);

      // 確認原本 canvas 的 connection 仍存在
      const stillExists = connectionStore.getById(canvasId, connection.id);
      expect(stillExists).toBeDefined();
    });

    it("update 不允許用其他 canvas 的 connectionId 跨 Canvas 更新", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
        triggerMode: "auto",
      });

      const result = connectionStore.update(otherCanvasId, connection.id, {
        triggerMode: "direct",
      });
      expect(result).toBeUndefined();

      // 確認原本的 triggerMode 沒有被修改
      const original = connectionStore.getById(canvasId, connection.id);
      expect(original?.triggerMode).toBe("auto");
    });

    it("updateConnectionStatus 不允許用其他 canvas 的 connectionId 跨 Canvas 更新狀態", () => {
      const connection = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });

      const result = connectionStore.updateConnectionStatus(
        otherCanvasId,
        connection.id,
        "active",
      );
      expect(result).toBeUndefined();

      // 確認原本的 connectionStatus 沒有被修改
      const original = connectionStore.getById(canvasId, connection.id);
      expect(original?.connectionStatus).toBe("idle");
    });
  });

  describe("findByPodId / findBySourcePodId / findByTargetPodId", () => {
    it("根據 podId 查詢包含 source 和 target 的 connections", () => {
      const conn1 = connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });
      const conn2 = connectionStore.create(canvasId, {
        sourcePodId: "pod-c",
        sourceAnchor: "bottom",
        targetPodId: "pod-a",
        targetAnchor: "top",
      });

      const connections = connectionStore.findByPodId(canvasId, "pod-a");
      const ids = connections.map((c) => c.id);
      expect(ids).toContain(conn1.id);
      expect(ids).toContain(conn2.id);
    });

    it("findBySourcePodId 只回傳 source 相符的 connections", () => {
      connectionStore.create(canvasId, {
        sourcePodId: "pod-a",
        sourceAnchor: "right",
        targetPodId: "pod-b",
        targetAnchor: "left",
      });
      connectionStore.create(canvasId, {
        sourcePodId: "pod-c",
        sourceAnchor: "bottom",
        targetPodId: "pod-a",
        targetAnchor: "top",
      });

      const connections = connectionStore.findBySourcePodId(canvasId, "pod-a");
      expect(connections).toHaveLength(1);
      expect(connections[0].sourcePodId).toBe("pod-a");
    });
  });
});
