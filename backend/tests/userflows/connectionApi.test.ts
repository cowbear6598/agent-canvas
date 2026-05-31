import { setupIntegrationTest, waitForEvent } from "../setup";
import {
  createConnection,
  postCanvas,
  postPod,
  setPodSchedule,
} from "../helpers";
import { WebSocketResponseEvents } from "../../src/schemas";
import { getStmts } from "../../src/database/index.js";
import { v4 as uuidv4 } from "uuid";

async function fetchConnections(baseUrl: string, canvasId: string) {
  return fetch(`${baseUrl}/api/canvas/${canvasId}/connections`);
}

async function postConnection(
  baseUrl: string,
  canvasId: string,
  body: unknown,
  contentType = "application/json",
) {
  return fetch(`${baseUrl}/api/canvas/${canvasId}/connections`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body:
      contentType === "application/json" ? JSON.stringify(body) : String(body),
  });
}

async function deleteConnection(
  baseUrl: string,
  canvasId: string,
  connectionId: string,
) {
  return fetch(
    `${baseUrl}/api/canvas/${canvasId}/connections/${connectionId}`,
    { method: "DELETE" },
  );
}

async function patchConnection(
  baseUrl: string,
  canvasId: string,
  connectionId: string,
  body: unknown,
  contentType = "application/json",
) {
  return fetch(
    `${baseUrl}/api/canvas/${canvasId}/connections/${connectionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": contentType },
      body:
        contentType === "application/json"
          ? JSON.stringify(body)
          : String(body),
    },
  );
}

describe("GET /api/canvas/:id/connections", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功取得空清單（初始狀態）", async () => {
    const server = getServer();
    const createCanvasRes = await postCanvas(server.baseUrl, {
      name: "conn-list-empty",
    });
    expect(createCanvasRes.status).toBe(201);
    const { canvas } = await createCanvasRes.json();

    const response = await fetchConnections(server.baseUrl, canvas.id);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.connections)).toBe(true);
    expect(body.connections.length).toBe(0);
  });

  it("建立一條 Connection 後重新查詢，驗證清單包含該 Connection", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "source-pod-list",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "target-pod-list",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    await createConnection(client, sourcePod.id, targetPod.id);

    const response = await fetchConnections(server.baseUrl, server.canvasId);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.connections)).toBe(true);
    expect(
      body.connections.some(
        (c: { sourcePodId: string; targetPodId: string }) =>
          c.sourcePodId === sourcePod.id && c.targetPodId === targetPod.id,
      ),
    ).toBe(true);
  });

  it("使用 Canvas name 查詢成功", async () => {
    const server = getServer();
    const createCanvasRes = await postCanvas(server.baseUrl, {
      name: "conn-list-name",
    });
    expect(createCanvasRes.status).toBe(201);

    const response = await fetchConnections(server.baseUrl, "conn-list-name");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.connections)).toBe(true);
  });

  it("Canvas 不存在時回傳 404", async () => {
    const server = getServer();
    const response = await fetchConnections(
      server.baseUrl,
      "non-existent-canvas",
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });
});

describe("POST /api/canvas/:id/connections", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功建立 Connection 並回傳 201", async () => {
    const server = getServer();
    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-create",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-create",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: sourcePod.id,
      targetPodId: targetPod.id,
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.connection).toBeDefined();
    expect(typeof body.connection.id).toBe("string");
    expect(body.connection.sourcePodId).toBe(sourcePod.id);
    expect(body.connection.targetPodId).toBe(targetPod.id);
    expect(body.connection.sourceAnchor).toBe("right");
    expect(body.connection.targetAnchor).toBe("left");
    expect(body.connection.triggerMode).toBe("auto");
  });

  it("缺少 sourcePodId 回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      targetPodId: uuidv4(),
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("缺少 targetPodId 回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("sourcePodId 非 UUID 格式回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: "not-a-uuid",
      targetPodId: uuidv4(),
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("sourcePodId 格式無效");
  });

  it("targetPodId 非 UUID 格式回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: "not-a-uuid",
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("targetPodId 格式無效");
  });

  it("缺少 sourceAnchor 回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: uuidv4(),
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("缺少 targetAnchor 回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: uuidv4(),
      sourceAnchor: "right",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("無效的 sourceAnchor 值回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: uuidv4(),
      sourceAnchor: "invalid",
      targetAnchor: "left",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("無效的 targetAnchor 值回傳 400", async () => {
    const server = getServer();
    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: uuidv4(),
      sourceAnchor: "right",
      targetAnchor: "invalid",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("來源 Pod 不存在回傳 404", async () => {
    const server = getServer();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-no-src",
      x: 0,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: uuidv4(),
      targetPodId: targetPod.id,
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("來源 Pod 找不到");
  });

  it("目標 Pod 不存在回傳 404", async () => {
    const server = getServer();
    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-no-tgt",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();

    const response = await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: sourcePod.id,
      targetPodId: uuidv4(),
      sourceAnchor: "right",
      targetAnchor: "left",
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("目標 Pod 找不到");
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const response = await postConnection(
      server.baseUrl,
      "non-existent-canvas",
      {
        sourcePodId: uuidv4(),
        targetPodId: uuidv4(),
        sourceAnchor: "right",
        targetAnchor: "left",
      },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("建立 Connection 成功後 WebSocket client 收到 CONNECTION_CREATED 事件", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-ws",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-ws",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const eventPromise = waitForEvent<{ connection: { sourcePodId: string } }>(
      client,
      WebSocketResponseEvents.CONNECTION_CREATED,
    );

    await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: sourcePod.id,
      targetPodId: targetPod.id,
      sourceAnchor: "right",
      targetAnchor: "left",
    });

    const payload = await eventPromise;
    expect(payload.connection).toBeDefined();
    expect(payload.connection.sourcePodId).toBe(sourcePod.id);
  });

  it("targetPod 有排程時建立 Connection 後 WebSocket client 收到 POD_SCHEDULE_SET 事件且 schedule 為 null", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-sched-ws",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-sched-ws",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    await setPodSchedule(client, targetPod.id, {
      frequency: "every-day",
      second: 0,
      intervalMinute: 1,
      intervalHour: 1,
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5],
      enabled: true,
    });

    const scheduleEventPromise = waitForEvent<{ pod: { schedule?: unknown } }>(
      client,
      WebSocketResponseEvents.POD_SCHEDULE_SET,
    );

    await postConnection(server.baseUrl, server.canvasId, {
      sourcePodId: sourcePod.id,
      targetPodId: targetPod.id,
      sourceAnchor: "right",
      targetAnchor: "left",
    });

    const payload = await scheduleEventPromise;
    expect(payload.pod).toBeDefined();
    expect(payload.pod.schedule).toBeUndefined();
  });
});

describe("DELETE /api/canvas/:id/connections/:connectionId", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功刪除 Connection 並回傳 200", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-del",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-del",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const response = await deleteConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("Connection UUID 不存在回傳 404", async () => {
    const server = getServer();
    const response = await deleteConnection(
      server.baseUrl,
      server.canvasId,
      uuidv4(),
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Connection");
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const response = await deleteConnection(server.baseUrl, uuidv4(), uuidv4());
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("刪除 Connection 成功後 WebSocket client 收到 CONNECTION_DELETED 事件", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-del-ws",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-del-ws",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const eventPromise = waitForEvent<{ connectionId: string }>(
      client,
      WebSocketResponseEvents.CONNECTION_DELETED,
    );

    await deleteConnection(server.baseUrl, server.canvasId, connection.id);

    const payload = await eventPromise;
    expect(payload.connectionId).toBe(connection.id);
  });
});

describe("PATCH /api/canvas/:id/connections/:connectionId", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功更新 triggerMode 為 direct 並回傳 200", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-direct",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-direct",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      { triggerMode: "direct" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.connection).toBeDefined();
    expect(body.connection.triggerMode).toBe("direct");
  });

  it("成功更新 triggerMode 為 branch 並回傳 200", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-branch",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-branch",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      { triggerMode: "branch" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.connection.triggerMode).toBe("branch");
  });

  it("Codex source Pod 切換為 branch 時使用 Codex 預設 provider/model", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-branch-codex",
      x: 0,
      y: 0,
      provider: "codex",
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-branch-codex",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(client, sourcePod.id, targetPod.id, {
      label: "CodexPath",
      branchProvider: undefined,
      branchModel: undefined,
    });

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      { triggerMode: "branch" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.connection.triggerMode).toBe("branch");
    expect(body.connection.branchProvider).toBe("codex");
    expect(body.connection.branchModel).toBe("gpt-5.4");
  });

  it("OpenCode source Pod 切換為 branch 時沿用 source providerConfig.model", async () => {
    const server = getServer();
    const client = getClient();

    getStmts().modelAlias.insert.run({
      $id: "alias-connection-api-opencode",
      $providerId: "opencode",
      $realProvider: "openai",
      $realModel: "gpt-4o",
      $alias: "GPT-4o",
      $orderIdx: 0,
      $createdAt: 1,
      $updatedAt: 1,
    });

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-branch-opencode",
      x: 0,
      y: 0,
      provider: "opencode",
      providerConfig: { model: "openai/gpt-4o" },
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-branch-opencode",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(client, sourcePod.id, targetPod.id, {
      label: "OpenCodePath",
      branchProvider: undefined,
      branchModel: undefined,
    });

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      { triggerMode: "branch" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.connection.triggerMode).toBe("branch");
    expect(body.connection.branchProvider).toBe("opencode");
    expect(body.connection.branchModel).toBe("openai/gpt-4o");
  });

  it("無效的 triggerMode 值回傳 400", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-inv",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-inv",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      { triggerMode: "invalid" },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("缺少 triggerMode 回傳 400", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-miss",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-miss",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      connection.id,
      {},
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it("Connection UUID 不存在回傳 404", async () => {
    const server = getServer();
    const response = await patchConnection(
      server.baseUrl,
      server.canvasId,
      uuidv4(),
      { triggerMode: "direct" },
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Connection");
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const response = await patchConnection(server.baseUrl, uuidv4(), uuidv4(), {
      triggerMode: "direct",
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("更新 triggerMode 成功後 WebSocket client 收到 CONNECTION_UPDATED 事件", async () => {
    const server = getServer();
    const client = getClient();

    const sourcePodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "src-pod-patch-ws",
      x: 0,
      y: 0,
    });
    const { pod: sourcePod } = await sourcePodRes.json();
    const targetPodRes = await postPod(server.baseUrl, server.canvasId, {
      name: "tgt-pod-patch-ws",
      x: 100,
      y: 0,
    });
    const { pod: targetPod } = await targetPodRes.json();

    const connection = await createConnection(
      client,
      sourcePod.id,
      targetPod.id,
    );

    const eventPromise = waitForEvent<{ connection: { triggerMode: string } }>(
      client,
      WebSocketResponseEvents.CONNECTION_UPDATED,
    );

    await patchConnection(server.baseUrl, server.canvasId, connection.id, {
      triggerMode: "direct",
    });

    const payload = await eventPromise;
    expect(payload.connection).toBeDefined();
    expect(payload.connection.triggerMode).toBe("direct");
  });
});
