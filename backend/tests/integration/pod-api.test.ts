import { waitForEvent, setupIntegrationTest } from "../setup";
import {
  createPod,
  deletePod,
  postCanvas,
  postPod,
  patchPod,
} from "../helpers";
import { WebSocketResponseEvents } from "../../src/schemas";
import { v4 as uuidv4 } from "uuid";

async function fetchPods(baseUrl: string, canvasId: string) {
  return fetch(`${baseUrl}/api/canvas/${canvasId}/pods`);
}

describe("GET /api/canvas/:id/pods", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功取得 Pod 列表", async () => {
    const server = getServer();
    const client = getClient();
    await createPod(client);

    const response = await fetchPods(server.baseUrl, server.canvasId);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.pods)).toBe(true);
    expect(body.pods.length).toBeGreaterThan(0);
  });

  it("Canvas 存在但沒有 Pod 時回傳空陣列", async () => {
    const server = getServer();
    const createResponse = await postCanvas(server.baseUrl, {
      name: "pod-api-empty-canvas",
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const emptyCanvasId = created.canvas.id;

    const response = await fetchPods(server.baseUrl, emptyCanvasId);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pods).toEqual([]);
  });

  it("回傳資料包含 Pod 完整欄位", async () => {
    const server = getServer();
    const client = getClient();
    await createPod(client);

    const response = await fetchPods(server.baseUrl, server.canvasId);
    const body = await response.json();

    expect(body.pods.length).toBeGreaterThan(0);
    const pod = body.pods[0];

    expect(pod.id).toBeDefined();
    expect(pod.name).toBeDefined();
    expect(pod.status).toBeDefined();
    expect(Array.isArray(pod.mcpServerNames)).toBe(true);
  });

  it("用 canvas name 取得 Pod 列表", async () => {
    const server = getServer();
    const createResponse = await postCanvas(server.baseUrl, {
      name: "pod-api-name-canvas",
    });
    expect(createResponse.status).toBe(201);

    const response = await fetchPods(server.baseUrl, "pod-api-name-canvas");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.pods)).toBe(true);
  });

  it("找不到 Canvas 回傳 404", async () => {
    const server = getServer();
    const response = await fetchPods(server.baseUrl, "non-existent-canvas");
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("用不存在的 UUID 查詢 Pod 列表回傳 404", async () => {
    const server = getServer();
    const response = await fetchPods(
      server.baseUrl,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });
});

describe("POST /api/canvas/:id/pods", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功建立 Pod（只傳 name, x, y），預設 model 為 opus", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "REST Pod",
      x: 100,
      y: 200,
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.pod).toBeDefined();
    expect(body.pod.name).toBe("REST Pod");
    expect(body.pod.x).toBe(100);
    expect(body.pod.y).toBe(200);
    expect(body.pod.rotation).toBe(0);
    // Pod.model 已移除，providerConfig.model 是唯一來源
    expect(body.pod.providerConfig?.model).toBe("sonnet");
  });

  it("成功建立 Pod 並指定 model 為 sonnet", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "Sonnet Pod",
      x: 0,
      y: 0,
      model: "sonnet",
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.pod.providerConfig?.model).toBe("sonnet");
  });

  it("用 canvas name 建立 Pod", async () => {
    const server = getServer();
    const createResponse = await postCanvas(server.baseUrl, {
      name: "post-pod-name-canvas",
    });
    expect(createResponse.status).toBe(201);

    const response = await postPod(server.baseUrl, "post-pod-name-canvas", {
      name: "Named Canvas Pod",
      x: 0,
      y: 0,
    });
    expect(response.status).toBe(201);
  });

  it("缺少 name 回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      x: 0,
      y: 0,
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能為空");
  });

  it("name 為空字串回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "",
      x: 0,
      y: 0,
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能為空");
  });

  it("name 超過 100 字元回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "a".repeat(101),
      x: 0,
      y: 0,
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能超過 100 個字元");
  });

  it("缺少 x 回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod",
      y: 0,
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("必須提供有效的 x 和 y 座標");
  });

  it("缺少 y 回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod",
      x: 0,
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("必須提供有效的 x 和 y 座標");
  });

  it("無效 model 回傳 400", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod",
      x: 0,
      y: 0,
      model: "gpt-4",
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("無效的模型類型");
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, "non-existent-canvas", {
      name: "Pod",
      x: 0,
      y: 0,
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("無效 JSON body 回傳 400", async () => {
    const server = getServer();
    const response = await postPod(
      server.baseUrl,
      server.canvasId,
      "not json",
      "text/plain",
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("無效的請求格式");
  });

  it("用不存在的 UUID 建立 Pod 回傳 404", async () => {
    const server = getServer();
    const response = await postPod(
      server.baseUrl,
      "00000000-0000-4000-8000-000000000000",
      {
        name: "Test",
        x: 0,
        y: 0,
      },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("建立 Pod 成功後 WebSocket client 收到 pod:created 事件", async () => {
    const server = getServer();
    const client = getClient();
    const eventPromise = waitForEvent<{
      pod: { name: string; x: number; y: number };
    }>(client, WebSocketResponseEvents.POD_CREATED);

    await postPod(server.baseUrl, server.canvasId, {
      name: "WS Broadcast Pod",
      x: 10,
      y: 20,
    });

    const payload = await eventPromise;
    expect(payload.pod).toBeDefined();
    expect(payload.pod.name).toBe("WS Broadcast Pod");
    expect(payload.pod.x).toBe(10);
    expect(payload.pod.y).toBe(20);
  });

  it("回傳的 Pod 包含完整欄位", async () => {
    const server = getServer();
    const response = await postPod(server.baseUrl, server.canvasId, {
      name: "Full Field Pod",
      x: 50,
      y: 75,
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    const pod = body.pod;

    expect(typeof pod.id).toBe("string");
    expect(typeof pod.name).toBe("string");
    expect(pod.status).toBe("idle");
    expect(typeof pod.workspacePath).toBe("string");
    expect(typeof pod.x).toBe("number");
    expect(typeof pod.y).toBe("number");
    expect(pod.rotation).toBe(0);
    // Pod.model 已移除，改用 providerConfig.model 作為唯一來源
    expect(typeof pod.providerConfig?.model).toBe("string");

    expect(Array.isArray(pod.mcpServerNames)).toBe(true);
    expect(typeof pod.multiInstance).toBe("boolean");
  });
});

describe("DELETE /api/canvas/:id/pods/:podId", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功刪除 Pod 回傳 200，再次 GET 確認已移除", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Delete Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const deleteResponse = await deletePod(
      server.baseUrl,
      server.canvasId,
      pod.id,
    );
    expect(deleteResponse.status).toBe(200);

    const body = await deleteResponse.json();
    expect(body.success).toBe(true);

    const listResponse = await fetch(
      `${server.baseUrl}/api/canvas/${server.canvasId}/pods`,
    );
    const listBody = await listResponse.json();
    const found = listBody.pods.some((p: { id: string }) => p.id === pod.id);
    expect(found).toBe(false);
  });

  it("用 Canvas name 刪除 Pod 成功", async () => {
    const server = getServer();
    const canvasResponse = await postCanvas(server.baseUrl, {
      name: "delete-pod-by-name-canvas",
    });
    expect(canvasResponse.status).toBe(201);
    const { canvas } = await canvasResponse.json();

    const createResponse = await postPod(server.baseUrl, canvas.id, {
      name: "Pod by Name",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const deleteResponse = await deletePod(
      server.baseUrl,
      "delete-pod-by-name-canvas",
      pod.id,
    );
    expect(deleteResponse.status).toBe(200);

    const body = await deleteResponse.json();
    expect(body.success).toBe(true);
  });

  it("刪除後透過 WebSocket 廣播 pod:deleted 事件", async () => {
    const server = getServer();
    const client = getClient();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "WS Delete Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const eventPromise = waitForEvent<{ success: boolean; podId: string }>(
      client,
      WebSocketResponseEvents.POD_DELETED,
    );

    await deletePod(server.baseUrl, server.canvasId, pod.id);

    const payload = await eventPromise;
    expect(payload.success).toBe(true);
    expect(payload.podId).toBe(pod.id);
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const nonExistentCanvasId = uuidv4();
    const nonExistentPodId = uuidv4();

    const response = await deletePod(
      server.baseUrl,
      nonExistentCanvasId,
      nonExistentPodId,
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("Pod 不存在回傳 404", async () => {
    const server = getServer();
    const nonExistentPodId = uuidv4();

    const response = await deletePod(
      server.baseUrl,
      server.canvasId,
      nonExistentPodId,
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Pod");
  });

  it("用 Pod 名稱刪除成功回傳 200", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Delete By Name Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const deleteResponse = await deletePod(
      server.baseUrl,
      server.canvasId,
      "Delete By Name Pod",
    );
    expect(deleteResponse.status).toBe(200);

    const body = await deleteResponse.json();
    expect(body.success).toBe(true);

    const listResponse = await fetch(
      `${server.baseUrl}/api/canvas/${server.canvasId}/pods`,
    );
    const listBody = await listResponse.json();
    const found = listBody.pods.some((p: { id: string }) => p.id === pod.id);
    expect(found).toBe(false);
  });

  it("用不存在 Pod 名稱刪除回傳 404", async () => {
    const server = getServer();
    const response = await deletePod(
      server.baseUrl,
      server.canvasId,
      "Non Existent Pod Name",
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Pod");
  });

  it("重複刪除同一個 Pod 回傳 404", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Duplicate Delete Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const firstDelete = await deletePod(
      server.baseUrl,
      server.canvasId,
      pod.id,
    );
    expect(firstDelete.status).toBe(200);

    const secondDelete = await deletePod(
      server.baseUrl,
      server.canvasId,
      pod.id,
    );
    expect(secondDelete.status).toBe(404);

    const body = await secondDelete.json();
    expect(body.error).toBe("找不到 Pod");
  });
});

describe("PATCH /api/canvas/:id/pods/:podId", () => {
  const { getServer, getClient } = setupIntegrationTest();

  it("成功重新命名 Pod 回傳 200 並包含更新後的 Pod", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Rename Pod A",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "Renamed Pod A",
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pod).toBeDefined();
    expect(body.pod.name).toBe("Renamed Pod A");
    expect(body.pod.id).toBe(pod.id);
  });

  it("重新命名後 GET 確認名稱已更新", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Before Rename",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "After Rename",
    });

    const listResponse = await fetch(
      `${server.baseUrl}/api/canvas/${server.canvasId}/pods`,
    );
    const listBody = await listResponse.json();
    const found = listBody.pods.find((p: { id: string }) => p.id === pod.id);
    expect(found).toBeDefined();
    expect(found.name).toBe("After Rename");
  });

  it("重新命名後透過 WebSocket 廣播 pod:renamed 事件", async () => {
    const server = getServer();
    const client = getClient();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "WS Rename Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const eventPromise = waitForEvent<{
      requestId: string;
      canvasId: string;
      podId: string;
      name: string;
      pod: { id: string; name: string };
    }>(client, WebSocketResponseEvents.POD_RENAMED);

    await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "WS Renamed Pod",
    });

    const payload = await eventPromise;
    expect(payload.success).toBe(true);
    expect(payload.requestId).toBe("system");
    expect(payload.canvasId).toBe(server.canvasId);
    expect(payload.podId).toBe(pod.id);
    expect(payload.name).toBe("WS Renamed Pod");
    expect(payload.pod).toBeDefined();
    expect(payload.pod.name).toBe("WS Renamed Pod");
  });

  it("用 Canvas name 重新命名 Pod 成功", async () => {
    const server = getServer();
    const createResponse = await postCanvas(server.baseUrl, {
      name: "rename-pod-canvas-name",
    });
    expect(createResponse.status).toBe(201);
    const { canvas } = await createResponse.json();

    const podResponse = await postPod(server.baseUrl, canvas.id, {
      name: "Pod In Named Canvas",
      x: 0,
      y: 0,
    });
    expect(podResponse.status).toBe(201);
    const { pod } = await podResponse.json();

    const response = await patchPod(
      server.baseUrl,
      "rename-pod-canvas-name",
      pod.id,
      { name: "Renamed In Named Canvas" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pod.name).toBe("Renamed In Named Canvas");
  });

  it("用 Pod name 重新命名 Pod 成功", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod By Name Rename",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);

    const response = await patchPod(
      server.baseUrl,
      server.canvasId,
      "Pod By Name Rename",
      { name: "Pod By Name Renamed" },
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.pod.name).toBe("Pod By Name Renamed");
  });

  it("缺少 name 欄位回傳 400", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod Missing Name",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(
      server.baseUrl,
      server.canvasId,
      pod.id,
      {},
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能為空");
  });

  it("name 為空字串回傳 400", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod Empty Name",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "",
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能為空");
  });

  it("name 為純空白字串回傳 400", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod Whitespace Name",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "   ",
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能為空");
  });

  it("name 超過 100 字元回傳 400", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Pod Long Name",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "a".repeat(101),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Pod 名稱不能超過 100 個字元");
  });

  it("同名 Pod 回傳 409", async () => {
    const server = getServer();
    const createResponseA = await postPod(server.baseUrl, server.canvasId, {
      name: "Conflict Pod A",
      x: 0,
      y: 0,
    });
    expect(createResponseA.status).toBe(201);

    const createResponseB = await postPod(server.baseUrl, server.canvasId, {
      name: "Conflict Pod B",
      x: 0,
      y: 0,
    });
    expect(createResponseB.status).toBe(201);
    const { pod: podB } = await createResponseB.json();

    const response = await patchPod(server.baseUrl, server.canvasId, podB.id, {
      name: "Conflict Pod A",
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error).toBe("同一 Canvas 下已存在相同名稱的 Pod");
  });

  it("重新命名為自己目前的名稱回傳 409", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Self Rename Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(server.baseUrl, server.canvasId, pod.id, {
      name: "Self Rename Pod",
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error).toBe("同一 Canvas 下已存在相同名稱的 Pod");
  });

  it("Canvas 不存在回傳 404", async () => {
    const server = getServer();
    const response = await patchPod(server.baseUrl, uuidv4(), uuidv4(), {
      name: "Some Name",
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Canvas");
  });

  it("Pod 不存在回傳 404", async () => {
    const server = getServer();
    const response = await patchPod(server.baseUrl, server.canvasId, uuidv4(), {
      name: "Some Name",
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe("找不到 Pod");
  });

  it("無效 JSON body 回傳 400", async () => {
    const server = getServer();
    const createResponse = await postPod(server.baseUrl, server.canvasId, {
      name: "Invalid JSON Pod",
      x: 0,
      y: 0,
    });
    expect(createResponse.status).toBe(201);
    const { pod } = await createResponse.json();

    const response = await patchPod(
      server.baseUrl,
      server.canvasId,
      pod.id,
      {},
      "text/plain",
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("無效的請求格式");
  });
});
