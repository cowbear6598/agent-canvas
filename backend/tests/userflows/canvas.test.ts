import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  createSocketClient,
  disconnectSocket,
  emitAndWaitResponse,
  type TestServerInstance,
  type TestWebSocketClient,
} from "../setup";
import { closeTestServer, createTestServer } from "../setup/testServer.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type CanvasCreatePayload,
  type CanvasDeletePayload,
  type PodCreatePayload,
  type PodMovePayload,
} from "../../src/schemas";
import type {
  CanvasCreatedPayload,
  CanvasDeletedPayload,
  PodCreatedPayload,
  PodMovedPayload,
} from "../../src/types";
import { getDb } from "../../src/database/index.js";
import { switchCanvas } from "../helpers";

describe("Canvas WebSocket user flow", () => {
  let server: TestServerInstance;
  let client: TestWebSocketClient;

  beforeAll(async () => {
    server = await createTestServer();
    client = await createSocketClient(server.baseUrl, server.canvasId);
  });

  afterAll(async () => {
    await disconnectSocket(client);
    await closeTestServer(server);
  });

  it("建立 canvas、建立 pod、移動 pod 後 WebSocket 回應與 DB 狀態一致", async () => {
    const createCanvas = await emitAndWaitResponse<
      CanvasCreatePayload,
      CanvasCreatedPayload
    >(
      client,
      WebSocketRequestEvents.CANVAS_CREATE,
      WebSocketResponseEvents.CANVAS_CREATED,
      { requestId: uuidv4(), name: "ws-userflow-canvas" },
    );

    expect(createCanvas.success).toBe(true);
    expect(createCanvas.canvas?.name).toBe("ws-userflow-canvas");

    const canvasRow = getDb()
      .prepare("SELECT id, name FROM canvases WHERE id = ?")
      .get(createCanvas.canvas!.id) as { id: string; name: string } | undefined;
    expect(canvasRow).toEqual({
      id: createCanvas.canvas!.id,
      name: "ws-userflow-canvas",
    });

    const switchToCreatedCanvas = await switchCanvas(
      client,
      createCanvas.canvas!.id,
    );
    expect(switchToCreatedCanvas).toMatchObject({
      success: true,
      canvasId: createCanvas.canvas!.id,
    });

    const createPod = await emitAndWaitResponse<
      PodCreatePayload,
      PodCreatedPayload
    >(
      client,
      WebSocketRequestEvents.POD_CREATE,
      WebSocketResponseEvents.POD_CREATED,
      {
        requestId: uuidv4(),
        canvasId: createCanvas.canvas!.id,
        name: "ws-flow-pod",
        x: 10,
        y: 20,
        rotation: 15,
        providerConfig: { model: "opus" },
      },
    );

    expect(createPod.success).toBe(true);
    expect(createPod.pod).toMatchObject({
      name: "ws-flow-pod",
      x: 10,
      y: 20,
      rotation: 15,
    });
    expect((createPod.pod as Record<string, unknown>).workspacePath).toBeUndefined();

    const createdPodRow = getDb()
      .prepare(
        "SELECT id, name, workspace_path, x, y, rotation, provider_config_json FROM pods WHERE id = ?",
      )
      .get(createPod.pod!.id) as
      | {
          id: string;
          name: string;
          workspace_path: string;
          x: number;
          y: number;
          rotation: number;
          provider_config_json: string;
        }
      | undefined;
    expect(createdPodRow).toBeDefined();
    expect(createdPodRow).toMatchObject({
      id: createPod.pod!.id,
      name: "ws-flow-pod",
      x: 10,
      y: 20,
      rotation: 15,
    });
    expect(JSON.parse(createdPodRow!.provider_config_json)).toEqual({
      model: "opus",
      thinkingLevel: "high",
    });
    expect(existsSync(createdPodRow!.workspace_path)).toBe(true);

    const movePod = await emitAndWaitResponse<PodMovePayload, PodMovedPayload>(
      client,
      WebSocketRequestEvents.POD_MOVE,
      WebSocketResponseEvents.POD_MOVED,
      {
        requestId: uuidv4(),
        canvasId: createCanvas.canvas!.id,
        podId: createPod.pod!.id,
        x: -300,
        y: 450,
      },
    );

    expect(movePod.success).toBe(true);
    expect(movePod.pod).toMatchObject({ id: createPod.pod!.id, x: -300, y: 450 });

    const movedPodRow = getDb()
      .prepare("SELECT x, y FROM pods WHERE id = ?")
      .get(createPod.pod!.id) as { x: number; y: number } | undefined;
    expect(movedPodRow).toEqual({ x: -300, y: 450 });

    const canvasDirectory = dirname(createdPodRow!.workspace_path);
    const switchToDefaultCanvas = await switchCanvas(client, server.canvasId);
    expect(switchToDefaultCanvas).toMatchObject({
      success: true,
      canvasId: server.canvasId,
    });

    const deleteCanvas = await emitAndWaitResponse<
      CanvasDeletePayload,
      CanvasDeletedPayload
    >(
      client,
      WebSocketRequestEvents.CANVAS_DELETE,
      WebSocketResponseEvents.CANVAS_DELETED,
      { requestId: uuidv4(), canvasId: createCanvas.canvas!.id },
    );

    expect(deleteCanvas).toMatchObject({
      success: true,
      canvasId: createCanvas.canvas!.id,
    });
    expect(
      getDb()
        .prepare("SELECT id FROM canvases WHERE id = ?")
        .get(createCanvas.canvas!.id),
    ).toBeNull();
    expect(existsSync(canvasDirectory)).toBe(false);
  });
});
