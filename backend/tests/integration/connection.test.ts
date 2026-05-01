import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import {
  createPod,
  createPodPair,
  setPodSchedule,
  FAKE_UUID,
  getCanvasId,
} from "../helpers";
import { createConnection } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ConnectionCreatePayload,
  type ConnectionListPayload,
  type ConnectionDeletePayload,
  type ConnectionUpdatePayload,
} from "../../src/schemas";
import {
  type ConnectionCreatedPayload,
  type ConnectionListResultPayload,
  type ConnectionDeletedPayload,
  type ConnectionUpdatedPayload,
} from "../../src/types";
import { claudeProvider } from "../../src/services/provider/claudeProvider.js";
import { codexProvider } from "../../src/services/provider/codexProvider.js";

describe("Connection 管理", () => {
  const { getClient } = setupIntegrationTest();

  describe("Connection 建立", () => {
    it("成功建立兩個 Pod 之間的連線", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      expect(conn.id).toBeDefined();
      expect(conn.sourcePodId).toBe(podA.id);
      expect(conn.targetPodId).toBe(podB.id);
      expect(conn.sourceAnchor).toBe("right");
      expect(conn.targetAnchor).toBe("left");
    });

    it("目標 Pod 無排程時成功建立連線", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      expect(conn.id).toBeDefined();
      expect(conn.sourcePodId).toBe(podA.id);
      expect(conn.targetPodId).toBe(podB.id);
    });

    it("建立連線時成功清除目標 Pod 的排程", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);

      const scheduleConfig = {
        frequency: "every-day" as const,
        second: 0,
        intervalMinute: 1,
        intervalHour: 1,
        hour: 9,
        minute: 0,
        weekdays: [1, 2, 3, 4, 5],
        enabled: true,
      };

      const updatedPodB = await setPodSchedule(client, podB.id, scheduleConfig);
      expect(updatedPodB.schedule).toBeDefined();
      expect(updatedPodB.schedule?.enabled).toBe(true);

      const conn = await createConnection(client, podA.id, podB.id);
      expect(conn.id).toBeDefined();

      const canvasModule = await import("../../src/services/podStore.js");
      const podAfterConnection = canvasModule.podStore.getById(
        await getCanvasId(client),
        podB.id,
      );
      expect(podAfterConnection?.schedule).toBeUndefined();
    });

    it("上游 Pod 為 Claude 時，建立連線後 summaryModel 應為 Claude 預設模型", async () => {
      const client = getClient();
      // 預設建立的 Pod provider 為 claude
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      // summaryModel 應自動對應 claude provider 的預設模型
      const claudeDefaultModel =
        (claudeProvider.metadata.defaultOptions as { model?: string }).model ??
        "opus";
      expect(conn.summaryModel).toBe(claudeDefaultModel);
    });

    it("上游 Pod 為 Codex 時，建立連線後 summaryModel 應為 Codex 預設模型", async () => {
      const client = getClient();
      const podA = await createPod(client, { provider: "codex" });
      const podB = await createPod(client);
      const conn = await createConnection(client, podA.id, podB.id);

      // summaryModel 應自動對應 codex provider 的預設模型
      const codexDefaultModel =
        (codexProvider.metadata.defaultOptions as { model?: string }).model ??
        "gpt-5.4";
      expect(conn.summaryModel).toBe(codexDefaultModel);
    });

    it("上游 Pod provider 不同時，summaryModel 預設值應與各自 provider 預設模型一致", async () => {
      const client = getClient();
      const podClaude = await createPod(client, {
        name: `claude-pod-${uuidv4()}`,
      });
      const podCodex = await createPod(client, {
        name: `codex-pod-${uuidv4()}`,
        provider: "codex",
      });
      const podTarget = await createPod(client, {
        name: `target-pod-${uuidv4()}`,
      });

      const connFromClaude = await createConnection(
        client,
        podClaude.id,
        podTarget.id,
      );
      const connFromCodex = await createConnection(
        client,
        podCodex.id,
        podTarget.id,
      );

      const claudeDefaultModel =
        (claudeProvider.metadata.defaultOptions as { model?: string }).model ??
        "opus";
      const codexDefaultModel =
        (codexProvider.metadata.defaultOptions as { model?: string }).model ??
        "gpt-5.4";

      expect(connFromClaude.summaryModel).toBe(claudeDefaultModel);
      expect(connFromCodex.summaryModel).toBe(codexDefaultModel);
      // 兩者 provider 不同，summaryModel 預設值也應不同
      expect(connFromClaude.summaryModel).not.toBe(connFromCodex.summaryModel);
    });

    it("來源 Pod 不存在時建立連線失敗", async () => {
      const client = getClient();
      const pod = await createPod(client);

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
          sourcePodId: FAKE_UUID,
          sourceAnchor: "right",
          targetPodId: pod.id,
          targetAnchor: "left",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("目標 Pod 不存在時建立連線失敗", async () => {
      const client = getClient();
      const pod = await createPod(client);

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
          sourcePodId: pod.id,
          sourceAnchor: "right",
          targetPodId: FAKE_UUID,
          targetAnchor: "left",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Connection 列表", () => {
    it("成功取得所有連線列表", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionListPayload,
        ConnectionListResultPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_LIST,
        WebSocketResponseEvents.CONNECTION_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      const found = response.connections!.find((c) => c.id === conn.id);
      expect(found).toBeDefined();
    });

    it("成功回傳連線陣列", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionListPayload,
        ConnectionListResultPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_LIST,
        WebSocketResponseEvents.CONNECTION_LIST_RESULT,
        { requestId: uuidv4(), canvasId },
      );

      expect(response.success).toBe(true);
      expect(Array.isArray(response.connections)).toBe(true);
    });
  });

  describe("Connection 刪除", () => {
    it("成功刪除連線", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionDeletePayload,
        ConnectionDeletedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_DELETE,
        WebSocketResponseEvents.CONNECTION_DELETED,
        { requestId: uuidv4(), canvasId, connectionId: conn.id },
      );

      expect(response.success).toBe(true);
      expect(response.connectionId).toBe(conn.id);
    });

    it("連線 ID 不存在時刪除失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionDeletePayload,
        ConnectionDeletedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_DELETE,
        WebSocketResponseEvents.CONNECTION_DELETED,
        { requestId: uuidv4(), canvasId, connectionId: FAKE_UUID },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  describe("Connection 更新", () => {
    it("成功更新連線的觸發模式", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionUpdatePayload,
        ConnectionUpdatedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          connectionId: conn.id,
          triggerMode: "ai-decide",
        },
      );

      expect(response.success).toBe(true);
      expect(response.connection!.triggerMode).toBe("ai-decide");
    });

    it("成功更新連線的觸發模式為 direct", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionUpdatePayload,
        ConnectionUpdatedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          connectionId: conn.id,
          triggerMode: "direct",
        },
      );

      expect(response.success).toBe(true);
      expect(response.connection!.triggerMode).toBe("direct");
    });

    it("連線 ID 不存在時更新失敗", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionUpdatePayload,
        ConnectionUpdatedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          connectionId: FAKE_UUID,
          triggerMode: "auto",
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // WS handler smoke：summaryProvider 欄位通過完整 WS validation pipeline
  // -----------------------------------------------------------------------
  describe("summaryProvider WS handler smoke", () => {
    it("A-smoke: connection:create 帶 summaryProvider=gemini → 成功建立並回傳 summaryProvider=gemini", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
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
          summaryProvider: "gemini",
        },
      );

      // 整條 WS validation pipeline 成功
      expect(response.success).toBe(true);
      expect(response.connection).toBeDefined();
      // summaryProvider 欄位正確寫入並回傳
      expect(response.connection!.summaryProvider).toBe("gemini");
    });

    it("A-smoke: connection:update 帶 summaryProvider=codex → 成功更新並回傳 summaryProvider=codex", async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      // 先建立連線（summaryProvider 預設 NULL）
      const conn = await createConnection(client, podA.id, podB.id);
      expect(conn.summaryProvider).toBeNull();

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<
        ConnectionUpdatePayload,
        ConnectionUpdatedPayload
      >(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          connectionId: conn.id,
          summaryProvider: "codex",
        },
      );

      // 整條 WS validation pipeline 成功
      expect(response.success).toBe(true);
      expect(response.connection).toBeDefined();
      // summaryProvider 切換為 codex 並回傳
      expect(response.connection!.summaryProvider).toBe("codex");
    });
  });
});
