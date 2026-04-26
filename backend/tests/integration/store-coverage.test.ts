import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import { createPod, FAKE_UUID, getCanvasId } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ConnectionCreatePayload,
} from "../../src/schemas";
import {
  type PodStatusChangedPayload,
  type ConnectionCreatedPayload,
} from "../../src/types";
// 注意：podStore 和 connectionStore 使用動態 import，避免在測試配置覆蓋前載入

describe("Store 覆蓋率測試", () => {
  const { getServer, getClient } = setupIntegrationTest();

  let podStore: Awaited<
    typeof import("../../src/services/podStore.js")
  >["podStore"];
  let connectionStore: Awaited<
    typeof import("../../src/services/connectionStore.js")
  >["connectionStore"];

  beforeAll(async () => {
    // 動態 import stores（確保使用測試配置）
    const podStoreModule = await import("../../src/services/podStore.js");
    const connectionStoreModule =
      await import("../../src/services/connectionStore.js");
    podStore = podStoreModule.podStore;
    connectionStore = connectionStoreModule.connectionStore;
  });

  describe("PodStore", () => {
    it("Canvas Pods 延遲初始化成功", async () => {
      const canvasId = "new-canvas-" + uuidv4();
      const pods = podStore.getAll(canvasId);

      expect(Array.isArray(pods)).toBe(true);
      expect(pods).toHaveLength(0);
    });

    it("相同狀態時跳過更新", async () => {
      const client = getClient();
      const server = getServer();
      const pod = await createPod(client);
      const canvasId = server.canvasId;

      const statusChanges: PodStatusChangedPayload[] = [];
      const listener = (payload: PodStatusChangedPayload): void => {
        statusChanges.push(payload);
      };

      client.on(WebSocketResponseEvents.POD_STATUS_CHANGED, listener);

      podStore.setStatus(canvasId, pod.id, "idle");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(statusChanges).toHaveLength(0);

      client.off(WebSocketResponseEvents.POD_STATUS_CHANGED, listener);
    });

    it("不同狀態時觸發事件", async () => {
      const client = getClient();
      const server = getServer();
      const pod = await createPod(client);
      const canvasId = server.canvasId;

      const statusChanges: PodStatusChangedPayload[] = [];
      const listener = (payload: PodStatusChangedPayload): void => {
        statusChanges.push(payload);
      };

      client.on(WebSocketResponseEvents.POD_STATUS_CHANGED, listener);

      podStore.setStatus(canvasId, pod.id, "chatting");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(statusChanges).toHaveLength(1);
      expect(statusChanges[0].podId).toBe(pod.id);
      expect(statusChanges[0].status).toBe("chatting");
      expect(statusChanges[0].previousStatus).toBe("idle");

      client.off(WebSocketResponseEvents.POD_STATUS_CHANGED, listener);
    });

    it("Canvas 找不到時拋出錯誤", () => {
      const fakeCanvasId = "nonexistent-canvas";

      expect(() => {
        podStore.create(fakeCanvasId, {
          name: "Test",
          x: 0,
          y: 0,
          rotation: 0,
        });
      }).toThrow("找不到 Canvas：");
    });
  });

  describe("ConnectionStore", () => {
    it("Canvas Map 延遲初始化成功", () => {
      const canvasId = "new-canvas-" + uuidv4();
      const connections = connectionStore.list(canvasId);

      expect(Array.isArray(connections)).toBe(true);
      expect(connections).toHaveLength(0);
    });

    it("刪除時儲存到磁碟", async () => {
      const client = getClient();
      const podA = await createPod(client, { name: "Pod A" });
      const podB = await createPod(client, { name: "Pod B" });

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionCreatePayload,
        ConnectionCreatedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_CREATE,
        WebSocketResponseEvents.CONNECTION_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          sourcePodId: podA.id,
          sourceAnchor: "right",
          targetPodId: podB.id,
          targetAnchor: "left",
        },
      );

      const connectionId = response.connection!.id;

      const deleted = connectionStore.delete(canvasId, connectionId);

      expect(deleted).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const connections = connectionStore.list(canvasId);
      expect(connections.find((c) => c.id === connectionId)).toBeUndefined();
    });

    it("刪除失敗時跳過儲存", () => {
      const server = getServer();
      const canvasId = server.canvasId;

      const deleted = connectionStore.delete(canvasId, FAKE_UUID);

      expect(deleted).toBe(false);
    });

    it("無 Map 時依 Pod 查詢回傳空陣列", () => {
      const canvasId = "nonexistent-canvas-" + uuidv4();

      const connections = connectionStore.findByPodId(canvasId, FAKE_UUID);

      expect(Array.isArray(connections)).toBe(true);
      expect(connections).toHaveLength(0);
    });
  });
});
