import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  closeTestServer,
  createSocketClient,
  createTestServer,
  disconnectSocket,
  emitAndWaitResponse,
  waitForEvent,
  type TestServerInstance,
  type TestWebSocketClient,
} from "../setup";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodCreatePayload,
  type PodClearMemoryPayload,
  type PodGetPayload,
  type PodMovePayload,
  type PodRenamePayload,
  type PodSetMemoryEnabledPayload,
  type PodSetSchedulePayload,
  type PodSetProviderPayload,
} from "../../src/schemas";
import type {
  PodCreatedPayload,
  PodGetResultPayload,
  PodMemoryClearedPayload,
  PodMemoryEnabledSetPayload,
  PodMemoryResultPayload,
  PodMovedPayload,
  PodProviderSetPayload,
  PodRenamedPayload,
  PodScheduleSetPayload,
} from "../../src/types";
import { getDb } from "../../src/database/index.js";
import { memoryStateService } from "../../src/services/memoryStateService.js";

describe("Pod WebSocket user flow", () => {
  let server: TestServerInstance;
  let client: TestWebSocketClient;
  let peerClient: TestWebSocketClient;

  beforeAll(async () => {
    server = await createTestServer();
    client = await createSocketClient(server.baseUrl, server.canvasId);
    peerClient = await createSocketClient(server.baseUrl, server.canvasId);
  });

  afterAll(async () => {
    await disconnectSocket(client);
    await disconnectSocket(peerClient);
    await closeTestServer(server);
  });

  it("建立、移動、重命名、讀回 pod 時，事件結果與 DB 紀錄一致", async () => {
    const created = await emitAndWaitResponse<
      PodCreatePayload,
      PodCreatedPayload
    >(
      client,
      WebSocketRequestEvents.POD_CREATE,
      WebSocketResponseEvents.POD_CREATED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        name: "ws-pod-flow",
        x: 1,
        y: 2,
        rotation: 3,
        providerConfig: { model: "haiku" },
      },
    );

    expect(created.success).toBe(true);
    expect(created.pod).toMatchObject({
      name: "ws-pod-flow",
      x: 1,
      y: 2,
      rotation: 3,
      providerConfig: { model: "haiku" },
    });
    expect((created.pod as Record<string, unknown>).workspacePath).toBeUndefined();

    const createdRow = getDb()
      .prepare(
        "SELECT workspace_path, name, x, y, rotation, provider_config_json FROM pods WHERE id = ?",
      )
      .get(created.pod!.id) as
      | {
          workspace_path: string;
          name: string;
          x: number;
          y: number;
          rotation: number;
          provider_config_json: string;
        }
      | undefined;
    expect(createdRow).toMatchObject({
      name: "ws-pod-flow",
      x: 1,
      y: 2,
      rotation: 3,
    });
    expect(JSON.parse(createdRow!.provider_config_json)).toEqual({
      model: "haiku",
    });
    expect(existsSync(createdRow!.workspace_path)).toBe(true);

    const moved = await emitAndWaitResponse<PodMovePayload, PodMovedPayload>(
      client,
      WebSocketRequestEvents.POD_MOVE,
      WebSocketResponseEvents.POD_MOVED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
        x: 321,
        y: 654,
      },
    );
    expect(moved.success).toBe(true);
    expect(moved.pod).toMatchObject({ id: created.pod!.id, x: 321, y: 654 });

    const renamed = await emitAndWaitResponse<
      PodRenamePayload,
      PodRenamedPayload
    >(
      client,
      WebSocketRequestEvents.POD_RENAME,
      WebSocketResponseEvents.POD_RENAMED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
        name: "ws-pod-flow-renamed",
      },
    );
    expect(renamed.success).toBe(true);
    expect(renamed.pod).toMatchObject({
      id: created.pod!.id,
      name: "ws-pod-flow-renamed",
      x: 321,
      y: 654,
    });

    const fetched = await emitAndWaitResponse<
      PodGetPayload,
      PodGetResultPayload
    >(
      client,
      WebSocketRequestEvents.POD_GET,
      WebSocketResponseEvents.POD_GET_RESULT,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
      },
    );
    expect(fetched.success).toBe(true);
    expect(fetched.pod).toMatchObject({
      id: created.pod!.id,
      name: "ws-pod-flow-renamed",
      x: 321,
      y: 654,
    });

    const finalRow = getDb()
      .prepare("SELECT name, x, y FROM pods WHERE id = ?")
      .get(created.pod!.id) as { name: string; x: number; y: number };
    expect(finalRow).toEqual({ name: "ws-pod-flow-renamed", x: 321, y: 654 });
  });

  it("設定 pod schedule 會序列化進 DB，讀回時仍維持產品欄位", async () => {
    const created = await emitAndWaitResponse<
      PodCreatePayload,
      PodCreatedPayload
    >(
      client,
      WebSocketRequestEvents.POD_CREATE,
      WebSocketResponseEvents.POD_CREATED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        name: "ws-scheduled-pod",
        x: 0,
        y: 0,
        rotation: 0,
      },
    );
    expect(created.success).toBe(true);

    const scheduled = await emitAndWaitResponse<
      PodSetSchedulePayload,
      PodScheduleSetPayload
    >(
      client,
      WebSocketRequestEvents.POD_SET_SCHEDULE,
      WebSocketResponseEvents.POD_SCHEDULE_SET,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
        schedule: {
          frequency: "every-day",
          second: 0,
          intervalMinute: 1,
          intervalHour: 1,
          hour: 9,
          minute: 30,
          weekdays: [],
          enabled: true,
        },
      },
    );

    expect(scheduled.success).toBe(true);
    expect(scheduled.pod?.schedule).toMatchObject({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      enabled: true,
      lastTriggeredAt: null,
    });

    const row = getDb()
      .prepare("SELECT schedule_json FROM pods WHERE id = ?")
      .get(created.pod!.id) as { schedule_json: string } | undefined;
    expect(JSON.parse(row!.schedule_json)).toMatchObject({
      frequency: "every-day",
      hour: 9,
      minute: 30,
      enabled: true,
      lastTriggeredAt: null,
    });
  });

  it("切換 pod provider 會持久化新 provider/model，並廣播更新後的 PodPublicView", async () => {
    const created = await emitAndWaitResponse<
      PodCreatePayload,
      PodCreatedPayload
    >(
      client,
      WebSocketRequestEvents.POD_CREATE,
      WebSocketResponseEvents.POD_CREATED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        name: "ws-provider-pod",
        x: 10,
        y: 20,
        rotation: 0,
        provider: "codex",
        providerConfig: { model: "gpt-5.5" },
      },
    );
    expect(created.success).toBe(true);

    const broadcastPromise = waitForEvent<PodProviderSetPayload>(
      peerClient,
      WebSocketResponseEvents.POD_PROVIDER_SET,
    );

    const switched = await emitAndWaitResponse<
      PodSetProviderPayload,
      PodProviderSetPayload
    >(
      client,
      WebSocketRequestEvents.POD_SET_PROVIDER,
      WebSocketResponseEvents.POD_PROVIDER_SET,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
        provider: "claude",
        providerConfig: { model: "sonnet" },
      },
    );

    const broadcast = await broadcastPromise;

    expect(switched.success).toBe(true);
    expect(switched.pod).toMatchObject({
      id: created.pod!.id,
      provider: "claude",
      providerConfig: { model: "sonnet" },
    });
    expect(broadcast.pod).toMatchObject({
      id: created.pod!.id,
      provider: "claude",
      providerConfig: { model: "sonnet" },
    });

    const row = getDb()
      .prepare("SELECT provider, provider_config_json FROM pods WHERE id = ?")
      .get(created.pod!.id) as
      | {
          provider: string;
          provider_config_json: string;
        }
      | undefined;
    expect(row?.provider).toBe("claude");
    expect(JSON.parse(row!.provider_config_json)).toMatchObject({
      model: "sonnet",
    });
  });

  it("pod memory 啟用狀態與清除結果應反映在 transport payload", async () => {
    const created = await emitAndWaitResponse<PodCreatePayload, PodCreatedPayload>(
      client,
      WebSocketRequestEvents.POD_CREATE,
      WebSocketResponseEvents.POD_CREATED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        name: "ws-pod-memory",
        x: 3,
        y: 4,
        rotation: 0,
      },
    );
    expect(created.success).toBe(true);

    memoryStateService.setPodMemoryEnabled(created.pod!.id, true);
    memoryStateService.writePodSummary(created.pod!.id, "既有 pod 記憶");

    const fetchedWithMemory = await emitAndWaitResponse<
      PodGetPayload,
      PodGetResultPayload
    >(
      client,
      WebSocketRequestEvents.POD_GET,
      WebSocketResponseEvents.POD_GET_RESULT,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
      },
    );

    expect(fetchedWithMemory.success).toBe(true);
    expect(fetchedWithMemory.pod).toMatchObject({
      id: created.pod!.id,
      memoryEnabled: true,
      hasPodMemory: true,
    });

    const memoryResult = await emitAndWaitResponse<
      PodGetPayload,
      PodMemoryResultPayload
    >(
      client,
      WebSocketRequestEvents.POD_GET_MEMORY,
      WebSocketResponseEvents.POD_MEMORY_RESULT,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
      },
    );

    expect(memoryResult.success).toBe(true);
    expect(memoryResult).toMatchObject({
      podId: created.pod!.id,
      memoryEnabled: true,
      hasSummary: true,
      summary: "既有 pod 記憶",
    });

    const disabled = await emitAndWaitResponse<
      PodSetMemoryEnabledPayload,
      PodMemoryEnabledSetPayload
    >(
      client,
      WebSocketRequestEvents.POD_SET_MEMORY_ENABLED,
      WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
        memoryEnabled: false,
      },
    );

    expect(disabled.success).toBe(true);
    expect(disabled.pod).toMatchObject({
      id: created.pod!.id,
      memoryEnabled: false,
      hasPodMemory: true,
    });

    const cleared = await emitAndWaitResponse<
      PodClearMemoryPayload,
      PodMemoryClearedPayload
    >(
      client,
      WebSocketRequestEvents.POD_CLEAR_MEMORY,
      WebSocketResponseEvents.POD_MEMORY_CLEARED,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
      },
    );

    expect(cleared.success).toBe(true);
    expect(cleared.pod).toMatchObject({
      id: created.pod!.id,
      memoryEnabled: false,
      hasPodMemory: false,
    });

    const fetchedAfterClear = await emitAndWaitResponse<
      PodGetPayload,
      PodGetResultPayload
    >(
      client,
      WebSocketRequestEvents.POD_GET,
      WebSocketResponseEvents.POD_GET_RESULT,
      {
        requestId: uuidv4(),
        canvasId: server.canvasId,
        podId: created.pod!.id,
      },
    );

    expect(fetchedAfterClear.success).toBe(true);
    expect(fetchedAfterClear.pod).toMatchObject({
      id: created.pod!.id,
      memoryEnabled: false,
      hasPodMemory: false,
    });
  });
});
