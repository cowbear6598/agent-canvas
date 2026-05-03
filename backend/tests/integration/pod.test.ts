import { spyOn } from "bun:test";
import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import {
  createPod,
  createPodPair,
  movePod,
  renamePod,
  setPodModel,
  setPodSchedule,
  FAKE_UUID,
  getCanvasId,
} from "../helpers";
import { createConnection } from "../helpers";
import { createRepository } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodListPayload,
  type PodGetPayload,
  type PodMovePayload,
  type PodRenamePayload,
  type PodSetModelPayload,
  type PodSetThinkingLevelPayload,
  type PodSetSchedulePayload,
  type PodDeletePayload,
  type ConnectionListPayload,
  type PodBindRepositoryPayload,
} from "../../src/schemas";
import {
  type PodListResultPayload,
  type PodGetResultPayload,
  type PodMovedPayload,
  type PodRenamedPayload,
  type PodModelSetPayload,
  type PodScheduleSetPayload,
  type PodDeletedPayload,
  type ConnectionListResultPayload,
  type PodRepositoryBoundPayload,
} from "../../src/types";

describe("Pod 管理", () => {
  const { getClient } = setupIntegrationTest();

  describe("Pod 建立", () => {
    it("成功建立 Pod", async () => {
      const client = getClient();
      const pod = await createPod(client, {
        name: "Created Pod",
        x: 100,
        y: 200,
        rotation: 5,
      });

      expect(pod.id).toBeDefined();
      expect(pod.name).toBe("Created Pod");
      expect(pod.x).toBe(100);
      expect(pod.y).toBe(200);
      expect(pod.rotation).toBe(5);
      // workspacePath 與 sessionId 已從 WebSocket broadcast 中移除（PodPublicView），
      // 前端不應收到這些伺服器側敏感欄位
      expect((pod as Record<string, unknown>).workspacePath).toBeUndefined();
      expect((pod as Record<string, unknown>).sessionId).toBeUndefined();
    });

    it("新建立的 Pod 預設狀態為 idle", async () => {
      const client = getClient();
      const pod = await createPod(client);
      expect(pod.status).toBe("idle");
    });
  });

  describe("Pod 列表", () => {
    it("成功取得所有 Pod 列表", async () => {
      const client = getClient();
      await createPod(client, { name: "List Pod 1" });
      await createPod(client, { name: "List Pod 2" });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodListPayload,
        PodListResultPayload
      >(
        client,
        WebSocketRequestEvents.POD_LIST,
        WebSocketResponseEvents.POD_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      const names = response.pods!.map((p) => p.name);
      expect(names).toContain("List Pod 1");
      expect(names).toContain("List Pod 2");
    });

    it("Pod 列表回傳陣列格式", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodListPayload,
        PodListResultPayload
      >(
        client,
        WebSocketRequestEvents.POD_LIST,
        WebSocketResponseEvents.POD_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      expect(Array.isArray(response.pods)).toBe(true);
    });
  });

  describe("Pod 取得", () => {
    it("成功取得現有的 Pod", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Get Pod" });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodGetPayload,
        PodGetResultPayload
      >(
        client,
        WebSocketRequestEvents.POD_GET,
        WebSocketResponseEvents.POD_GET_RESULT,
        { requestId: uuidv4(), canvasId, podId: pod.id },
      );

      expect(response.success).toBe(true);
      expect(response.pod!.id).toBe(pod.id);
      expect(response.pod!.name).toBe("Get Pod");
    });

    it("取得不存在的 Pod 時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodGetPayload,
        PodGetResultPayload
      >(
        client,
        WebSocketRequestEvents.POD_GET,
        WebSocketResponseEvents.POD_GET_RESULT,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pod 移動", () => {
    it("成功移動 Pod 位置", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const updatedPod = await movePod(client, pod.id, 500, 600);

      expect(updatedPod.x).toBe(500);
      expect(updatedPod.y).toBe(600);
    });

    it("移動不存在的 Pod 時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodMovePayload,
        PodMovedPayload
      >(
        client,
        WebSocketRequestEvents.POD_MOVE,
        WebSocketResponseEvents.POD_MOVED,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID, x: 100, y: 200 },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pod 重命名", () => {
    it("成功重命名 Pod", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const updatedPod = await renamePod(client, pod.id, "New Name");

      expect(updatedPod.name).toBe("New Name");
    });

    it("重命名不存在的 Pod 時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodRenamePayload,
        PodRenamedPayload
      >(
        client,
        WebSocketRequestEvents.POD_RENAME,
        WebSocketResponseEvents.POD_RENAMED,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID, name: "Fail" },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("重命名為已存在的名稱應回傳錯誤", async () => {
      const client = getClient();
      const podA = await createPod(client, {
        name: `rename-conflict-a-${uuidv4()}`,
      });
      const podB = await createPod(client, {
        name: `rename-conflict-b-${uuidv4()}`,
      });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodRenamePayload,
        PodRenamedPayload
      >(
        client,
        WebSocketRequestEvents.POD_RENAME,
        WebSocketResponseEvents.POD_RENAMED,
        { requestId: uuidv4(), canvasId, podId: podB.id, name: podA.name },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("重命名為自己目前的名稱回傳錯誤", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: `rename-self-${uuidv4()}` });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodRenamePayload,
        PodRenamedPayload
      >(
        client,
        WebSocketRequestEvents.POD_RENAME,
        WebSocketResponseEvents.POD_RENAMED,
        { requestId: uuidv4(), canvasId, podId: pod.id, name: pod.name },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pod 設定模型", () => {
    it("成功設定 Pod 模型為 Sonnet", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const updatedPod = await setPodModel(client, pod.id, "sonnet");

      // Pod.model 已移除，改用 providerConfig.model 作為唯一來源
      expect(updatedPod.providerConfig?.model).toBe("sonnet");
    });

    it("成功設定 Pod 模型為 Haiku", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const updatedPod = await setPodModel(client, pod.id, "haiku");

      // Pod.model 已移除，改用 providerConfig.model 作為唯一來源
      expect(updatedPod.providerConfig?.model).toBe("haiku");
    });

    it("成功設定 Pod 模型為 Opus", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const updatedPod = await setPodModel(client, pod.id, "opus");

      // Pod.model 已移除，改用 providerConfig.model 作為唯一來源
      expect(updatedPod.providerConfig?.model).toBe("opus");
    });

    it("設定不存在的 Pod 模型時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodSetModelPayload,
        PodModelSetPayload
      >(
        client,
        WebSocketRequestEvents.POD_SET_MODEL,
        WebSocketResponseEvents.POD_MODEL_SET,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID, model: "sonnet" },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    // [A1] pod:set-thinking-level smoke test：透過 WebSocket router 送一筆合法 payload，
    // 驗證能進到 handler 並回 success（response shape 與 POD_MODEL_SET 同：requestId/canvasId/success/pod）
    it("[A1] 成功透過 WebSocket 設定 Pod 的 thinkingLevel 為 max", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const canvasId = await getCanvasId(client);

      // 先把 model 切成 opus，確保支援 thinking levels
      await setPodModel(client, pod.id, "opus");

      const response = await emitAndWaitResponse<
        PodSetThinkingLevelPayload,
        PodModelSetPayload
      >(
        client,
        WebSocketRequestEvents.POD_SET_THINKING_LEVEL,
        WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
        { requestId: uuidv4(), canvasId, podId: pod.id, level: "max" },
      );

      expect(response.success).toBe(true);
      expect(response.pod).toBeDefined();
      // providerConfig 應同時保留 model 與更新後的 thinkingLevel
      expect(response.pod!.providerConfig).toEqual({
        model: "opus",
        thinkingLevel: "max",
      });
    });
  });

  describe("Pod 刪除", () => {
    it("成功刪除 Pod", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "To Delete" });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodDeletePayload,
        PodDeletedPayload
      >(
        client,
        WebSocketRequestEvents.POD_DELETE,
        WebSocketResponseEvents.POD_DELETED,
        { requestId: uuidv4(), canvasId, podId: pod.id },
      );

      expect(response.success).toBe(true);
      expect(response.podId).toBe(pod.id);
    });

    it("刪除 Pod 時清理相關連線", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodDeletePayload, PodDeletedPayload>(
        client,
        WebSocketRequestEvents.POD_DELETE,
        WebSocketResponseEvents.POD_DELETED,
        { requestId: uuidv4(), canvasId, podId: podA.id },
      );

      const listResponse = await emitAndWaitResponse<
        ConnectionListPayload,
        ConnectionListResultPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_LIST,
        WebSocketResponseEvents.CONNECTION_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      const related = listResponse.connections!.filter(
        (c) => c.sourcePodId === podA.id || c.targetPodId === podA.id,
      );
      expect(related).toHaveLength(0);
    });

    it("刪除不存在的 Pod 時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodDeletePayload,
        PodDeletedPayload
      >(
        client,
        WebSocketRequestEvents.POD_DELETE,
        WebSocketResponseEvents.POD_DELETED,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Pod Schedule 管理", () => {
    it("成功設定 Pod 排程", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Schedule Pod" });
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-day",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 9,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule).toBeDefined();
      expect(updatedPod.schedule!.frequency).toBe("every-day");
      expect(updatedPod.schedule!.enabled).toBe(true);
    });

    it("成功更新 Pod 排程", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Update Schedule Pod" });
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 30,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule).toBeDefined();
      expect(updatedPod.schedule!.frequency).toBe("every-x-minute");
      expect(updatedPod.schedule!.intervalMinute).toBe(30);
    });

    it("成功停用 Pod 排程", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Toggle Schedule Pod" });

      await setPodSchedule(client, pod.id, {
        frequency: "every-day",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 10,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-day",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 10,
        minute: 0,
        weekdays: [],
        enabled: false,
      });

      expect(updatedPod.schedule!.enabled).toBe(false);
    });

    it("成功移除 Pod 排程", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Remove Schedule Pod" });

      await setPodSchedule(client, pod.id, {
        frequency: "every-day",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 11,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      const updatedPod = await setPodSchedule(client, pod.id, null);

      expect(updatedPod.schedule).toBeUndefined();
    });

    it("啟用 Pod 排程時設定 lastTriggeredAt", async () => {
      const client = getClient();
      const pod = await createPod(client, {
        name: "Schedule with lastTriggeredAt",
      });
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 5,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule).toBeDefined();
      expect(updatedPod.schedule!.enabled).toBe(true);
      expect(updatedPod.schedule!.lastTriggeredAt).toBeDefined();
    });

    it("重新啟用 Pod 排程時更新 lastTriggeredAt", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Re-enable Schedule Pod" });

      const firstPod = await setPodSchedule(client, pod.id, {
        frequency: "every-second",
        second: 10,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      const firstLastTriggeredAt = firstPod.schedule!.lastTriggeredAt;
      expect(firstLastTriggeredAt).toBeDefined();

      const disabledPod = await setPodSchedule(client, pod.id, {
        frequency: "every-second",
        second: 10,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: false,
      });

      expect(disabledPod.schedule!.lastTriggeredAt).toEqual(
        firstLastTriggeredAt,
      );

      // 確保重新啟用時的 timestamp 與第一次不同
      await new Promise((resolve) => setTimeout(resolve, 10));

      const reEnabledPod = await setPodSchedule(client, pod.id, {
        frequency: "every-second",
        second: 10,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      const secondLastTriggeredAt = reEnabledPod.schedule!.lastTriggeredAt;
      expect(secondLastTriggeredAt).toBeDefined();
      expect(secondLastTriggeredAt).not.toEqual(firstLastTriggeredAt);
    });

    it("更新 Pod 排程設定有變更時重置 lastTriggeredAt", async () => {
      const client = getClient();
      const pod = await createPod(client, {
        name: "Update Schedule Reset lastTriggeredAt",
      });

      const beforeEnable = new Date();
      const firstPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 10,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(firstPod.schedule!.lastTriggeredAt).toBeDefined();

      const beforeUpdate = new Date();
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 20,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule!.intervalMinute).toBe(20);
      // 設定有變更（intervalMinute 10→20），高頻排程的 lastTriggeredAt 應重置為近似 now
      expect(updatedPod.schedule!.lastTriggeredAt).toBeDefined();
      const updatedTime = new Date(updatedPod.schedule!.lastTriggeredAt!);
      expect(updatedTime.getTime()).toBeGreaterThanOrEqual(
        beforeUpdate.getTime() - 1,
      );
    });

    it("更新 Pod 排程設定沒有變更時保留 lastTriggeredAt", async () => {
      const client = getClient();
      const pod = await createPod(client, {
        name: "Update Schedule Preserve lastTriggeredAt",
      });

      const firstPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 10,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      const firstLastTriggeredAt = firstPod.schedule!.lastTriggeredAt;

      // 相同設定再次送出，lastTriggeredAt 應保留
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-x-minute",
        second: 0,
        intervalMinute: 10,
        intervalHour: 1,
        hour: 0,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule!.lastTriggeredAt).toEqual(
        firstLastTriggeredAt,
      );
    });

    it("啟用 every-day 排程時 lastTriggeredAt 為 null（建立當天可正常觸發）", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Every-day Schedule Pod" });
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-day",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 9,
        minute: 0,
        weekdays: [],
        enabled: true,
      });

      expect(updatedPod.schedule).toBeDefined();
      expect(updatedPod.schedule!.enabled).toBe(true);
      expect(updatedPod.schedule!.lastTriggeredAt).toBeNull();
    });

    it("啟用 every-week 排程時 lastTriggeredAt 為 null（建立當天可正常觸發）", async () => {
      const client = getClient();
      const pod = await createPod(client, { name: "Every-week Schedule Pod" });
      const updatedPod = await setPodSchedule(client, pod.id, {
        frequency: "every-week",
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 9,
        minute: 0,
        weekdays: [1, 3, 5],
        enabled: true,
      });

      expect(updatedPod.schedule).toBeDefined();
      expect(updatedPod.schedule!.enabled).toBe(true);
      expect(updatedPod.schedule!.lastTriggeredAt).toBeNull();
    });

    it("設定不存在的 Pod 排程時失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        PodSetSchedulePayload,
        PodScheduleSetPayload
      >(
        client,
        WebSocketRequestEvents.POD_SET_SCHEDULE,
        WebSocketResponseEvents.POD_SCHEDULE_SET,
        {
          requestId: uuidv4(),
          canvasId,
          podId: FAKE_UUID,
          schedule: {
            frequency: "every-day",
            second: 0,
            intervalMinute: 1,
            intervalHour: 1,
            hour: 9,
            minute: 0,
            weekdays: [],
            enabled: true,
          },
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });
});
