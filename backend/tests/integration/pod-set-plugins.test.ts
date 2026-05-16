import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import { createPod, getCanvasId } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodSetPluginsPayload,
} from "../../src/schemas";
import { type PodPluginsSetPayload } from "../../src/types";

describe("Pod set-plugins", () => {
  const { getClient } = setupIntegrationTest();

  describe("idle 狀態", () => {
    it("成功更新 pluginIds（無已安裝 plugin 時應過濾為空陣列）", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const canvasId = await getCanvasId(client);

      const response = await emitAndWaitResponse<
        PodSetPluginsPayload,
        PodPluginsSetPayload
      >(
        client,
        WebSocketRequestEvents.POD_SET_PLUGINS,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        { requestId: uuidv4(), canvasId, podId: pod.id, pluginIds: [] },
      );

      expect(response.success).toBe(true);
      expect(response.pod).toBeDefined();
      expect(response.pod!.pluginIds).toEqual([]);
    });

    it("不存在的 plugin id 被過濾後 pluginIds 為空陣列", async () => {
      const client = getClient();
      const pod = await createPod(client);
      const canvasId = await getCanvasId(client);

      // 傳入不存在的 plugin ID，應全數被過濾
      const response = await emitAndWaitResponse<
        PodSetPluginsPayload,
        PodPluginsSetPayload
      >(
        client,
        WebSocketRequestEvents.POD_SET_PLUGINS,
        WebSocketResponseEvents.POD_PLUGINS_SET,
        {
          requestId: uuidv4(),
          canvasId,
          podId: pod.id,
          pluginIds: ["non-existent-plugin-id"],
        },
      );

      expect(response.success).toBe(true);
      expect(response.pod!.pluginIds).toEqual([]);
    });
  });

  // busy 狀態 — pod.status 概念已移除，此 describe 整段刪除
});
