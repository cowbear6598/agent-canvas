import { beforeEach, describe, expect, it } from "vitest";
import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { runStore } from "../../src/services/runStore.js";

const CANVAS_ID = "canvas-1";
const SOURCE_POD_ID = "pod-source";
const TRIGGER_MESSAGE = "開始執行";

describe("RunStore", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  describe("workflow_runs CRUD", () => {
    it("建立 workflow run 並正確回傳", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);

      expect(run.id).toBeTruthy();
      expect(run.canvasId).toBe(CANVAS_ID);
      expect(run.sourcePodId).toBe(SOURCE_POD_ID);
      expect(run.triggerMessage).toBe(TRIGGER_MESSAGE);
      expect(run.status).toBe("running");
      expect(run.createdAt).toBeTruthy();
      expect(run.completedAt).toBeNull();
    });

    it("根據 canvas_id 查詢 run 列表（依 created_at 降序）", () => {
      const run1 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第一次");
      const run2 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第二次");

      const runs = runStore.getRunsByCanvasId(CANVAS_ID);

      expect(runs).toHaveLength(2);
      // 降序：最新的在前
      expect(runs[0].id === run1.id || runs[0].id === run2.id).toBe(true);
    });

    it("getRun 查詢單筆 run", () => {
      const created = runStore.createRun(
        CANVAS_ID,
        SOURCE_POD_ID,
        TRIGGER_MESSAGE,
      );

      const fetched = runStore.getRun(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it("getRun 查詢不存在的 run 回傳 undefined", () => {
      const result = runStore.getRun("non-existent-id");
      expect(result).toBeUndefined();
    });

    it("更新 run 狀態為 completed 並設定 completed_at", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);

      runStore.updateRunStatus(run.id, "completed");

      const updated = runStore.getRun(run.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).toBeTruthy();
    });

    it("更新 run 狀態為 error 並設定 completed_at", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);

      runStore.updateRunStatus(run.id, "error");

      const updated = runStore.getRun(run.id);
      expect(updated?.status).toBe("error");
      expect(updated?.completedAt).toBeTruthy();
    });

    it("更新 run 狀態為 running 時不設定 completed_at", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.updateRunStatus(run.id, "completed");
      runStore.updateRunStatus(run.id, "running");

      const updated = runStore.getRun(run.id);
      expect(updated?.status).toBe("running");
      expect(updated?.completedAt).toBeNull();
    });

    it("刪除 run 同時刪除 run_pod_instances 與 run_messages（CASCADE）", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.createPodInstance(run.id, "pod-1");
      runStore.addRunMessage(run.id, "pod-1", "user", "測試訊息");

      runStore.deleteRun(run.id);

      expect(runStore.getRun(run.id)).toBeUndefined();
      expect(runStore.getPodInstancesByRunId(run.id)).toHaveLength(0);
      expect(runStore.getRunMessages(run.id, "pod-1")).toHaveLength(0);
    });

    it("countRunsByCanvasId 回傳正確數量", () => {
      runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第一次");
      runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第二次");

      expect(runStore.countRunsByCanvasId(CANVAS_ID)).toBe(2);
      expect(runStore.countRunsByCanvasId("other-canvas")).toBe(0);
    });

    it("getOldestCompletedRunIds 回傳最舊已完成 run 的 id 列表", () => {
      const run1 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第一次");
      const run2 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第二次");
      const run3 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第三次");
      runStore.updateRunStatus(run1.id, "completed");
      runStore.updateRunStatus(run2.id, "completed");
      runStore.updateRunStatus(run3.id, "completed");

      const ids = runStore.getOldestCompletedRunIds(CANVAS_ID, 2);

      expect(ids).toHaveLength(2);
    });
  });

  describe("run_pod_instances CRUD", () => {
    it("建立 run_pod_instance 並正確回傳", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);

      const instance = runStore.createPodInstance(run.id, "pod-1");

      expect(instance.id).toBeTruthy();
      expect(instance.runId).toBe(run.id);
      expect(instance.podId).toBe("pod-1");
      expect(instance.status).toBe("pending");
      expect(instance.claudeSessionId).toBeNull();
      expect(instance.errorMessage).toBeNull();
      expect(instance.triggeredAt).toBeNull();
      expect(instance.completedAt).toBeNull();
    });

    it("更新 run_pod_instance 狀態（pending → running → completed）", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const instance = runStore.createPodInstance(run.id, "pod-1");

      runStore.updatePodInstanceStatus(instance.id, "running");
      const running = runStore.getPodInstance(run.id, "pod-1");
      expect(running?.status).toBe("running");
      expect(running?.completedAt).toBeNull();

      runStore.updatePodInstanceStatus(instance.id, "completed");
      const completed = runStore.getPodInstance(run.id, "pod-1");
      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeTruthy();
    });

    it("更新 run_pod_instance 狀態為 error 並記錄 error_message", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const instance = runStore.createPodInstance(run.id, "pod-1");

      runStore.updatePodInstanceStatus(instance.id, "error", "執行失敗");

      const updated = runStore.getPodInstance(run.id, "pod-1");
      expect(updated?.status).toBe("error");
      expect(updated?.errorMessage).toBe("執行失敗");
      expect(updated?.completedAt).toBeTruthy();
    });

    it("查詢某個 run 的全部 pod instances", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.createPodInstance(run.id, "pod-1");
      runStore.createPodInstance(run.id, "pod-2");

      const instances = runStore.getPodInstancesByRunId(run.id);

      expect(instances).toHaveLength(2);
    });

    it("updatePodInstanceClaudeSessionId 更新 claude_session_id", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const instance = runStore.createPodInstance(run.id, "pod-1");

      runStore.updatePodInstanceClaudeSessionId(instance.id, "session-abc");

      const updated = runStore.getPodInstance(run.id, "pod-1");
      expect(updated?.claudeSessionId).toBe("session-abc");
    });

    it("createPodInstance 帶入 pending 後 getPodInstance 讀回應為 pending", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.createPodInstance(run.id, "pod-1", "pending", "pending");

      const instance = runStore.getPodInstance(run.id, "pod-1");

      expect(instance?.autoPathwaySettled).toBe("pending");
      expect(instance?.directPathwaySettled).toBe("pending");
    });

    it("createPodInstance 帶入 not-applicable 後 getPodInstance 讀回應為 not-applicable", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.createPodInstance(
        run.id,
        "pod-1",
        "not-applicable",
        "not-applicable",
      );

      const instance = runStore.getPodInstance(run.id, "pod-1");

      expect(instance?.autoPathwaySettled).toBe("not-applicable");
      expect(instance?.directPathwaySettled).toBe("not-applicable");
    });

    it("createPodInstance 帶入 settled 後 getPodInstance 讀回應為 settled", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.createPodInstance(run.id, "pod-1", "settled", "settled");

      const instance = runStore.getPodInstance(run.id, "pod-1");

      expect(instance?.autoPathwaySettled).toBe("settled");
      expect(instance?.directPathwaySettled).toBe("settled");
    });

    it("settleAutoPathway 呼叫後 autoPathwaySettled 應從 pending 變為 settled", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const instance = runStore.createPodInstance(
        run.id,
        "pod-1",
        "pending",
        "pending",
      );

      runStore.settleAutoPathway(instance.id);

      const updated = runStore.getPodInstance(run.id, "pod-1");
      expect(updated?.autoPathwaySettled).toBe("settled");
      expect(updated?.directPathwaySettled).toBe("pending");
    });

    it("settleDirectPathway 呼叫後 directPathwaySettled 應從 pending 變為 settled", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const instance = runStore.createPodInstance(
        run.id,
        "pod-1",
        "pending",
        "pending",
      );

      runStore.settleDirectPathway(instance.id);

      const updated = runStore.getPodInstance(run.id, "pod-1");
      expect(updated?.autoPathwaySettled).toBe("pending");
      expect(updated?.directPathwaySettled).toBe("settled");
    });

    it("getRunningPodInstances 只回傳 pending/running/summarizing 狀態", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const i1 = runStore.createPodInstance(run.id, "pod-1");
      const i2 = runStore.createPodInstance(run.id, "pod-2");
      const i3 = runStore.createPodInstance(run.id, "pod-3");

      runStore.updatePodInstanceStatus(i1.id, "running");
      runStore.updatePodInstanceStatus(i2.id, "completed");
      runStore.updatePodInstanceStatus(i3.id, "summarizing");

      const running = runStore.getRunningPodInstances(run.id);

      expect(running).toHaveLength(2);
      expect(
        running.every((i) =>
          ["pending", "running", "summarizing"].includes(i.status),
        ),
      ).toBe(true);
    });
  });

  describe("getRunningRuns", () => {
    it("有 running Run 時應回傳正確清單", () => {
      const run1 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第一次");
      const run2 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "第二次");
      // run1 保持 running 狀態，run2 改為 completed
      runStore.updateRunStatus(run2.id, "completed");

      const runningRuns = runStore.getRunningRuns();

      const ids = runningRuns.map((r) => r.id);
      expect(ids).toContain(run1.id);
      expect(ids).not.toContain(run2.id);
    });

    it("無 running Run 時應回傳空陣列", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "已完成");
      runStore.updateRunStatus(run.id, "completed");

      const runningRuns = runStore.getRunningRuns();

      expect(runningRuns).toHaveLength(0);
    });

    it("completed/error 狀態的 Run 不應出現在結果中", () => {
      const run1 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "已完成");
      const run2 = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "已失敗");
      runStore.updateRunStatus(run1.id, "completed");
      runStore.updateRunStatus(run2.id, "error");

      const runningRuns = runStore.getRunningRuns();

      expect(runningRuns).toHaveLength(0);
    });
  });

  describe("run_messages CRUD", () => {
    it("建立 run_message 並正確回傳", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);

      const message = runStore.addRunMessage(
        run.id,
        "pod-1",
        "user",
        "使用者訊息",
      );

      expect(message.id).toBeTruthy();
      expect(message.role).toBe("user");
      expect(message.content).toBe("使用者訊息");
      expect(message.timestamp).toBeTruthy();
    });

    it("查詢某個 run + pod 的訊息列表（依 timestamp 排序）", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      runStore.addRunMessage(run.id, "pod-1", "user", "第一則");
      runStore.addRunMessage(run.id, "pod-1", "assistant", "第二則");
      runStore.addRunMessage(run.id, "pod-2", "user", "其他 pod 的訊息");

      const messages = runStore.getRunMessages(run.id, "pod-1");

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("第一則");
      expect(messages[1].content).toBe("第二則");
    });

    it("upsert run_message（串流中重複更新同一筆）", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const message = runStore.addRunMessage(
        run.id,
        "pod-1",
        "assistant",
        "原始內容",
      );

      runStore.upsertRunMessage(run.id, "pod-1", {
        ...message,
        content: "串流更新後",
      });
      runStore.upsertRunMessage(run.id, "pod-1", {
        ...message,
        content: "最終內容",
      });

      const messages = runStore.getRunMessages(run.id, "pod-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("最終內容");
    });

    it("addRunMessage 帶 subMessages 正確儲存", () => {
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, TRIGGER_MESSAGE);
      const subMessages = [{ id: "sub-1", content: "工具輸出" }];

      const message = runStore.addRunMessage(
        run.id,
        "pod-1",
        "assistant",
        "主內容",
        subMessages,
      );

      const fetched = runStore.getRunMessages(run.id, "pod-1");
      expect(fetched[0].subMessages).toEqual(subMessages);
      expect(message.subMessages).toEqual(subMessages);
    });
  });
});
