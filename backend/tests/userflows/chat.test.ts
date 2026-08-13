import type { TestWebSocketClient } from "../setup";
import { v4 as uuidv4 } from "uuid";
import {
  createTestServer,
  closeTestServer,
  createSocketClient,
  waitForEvent,
  disconnectSocket,
  type TestServerInstance,
} from "../setup";
import {
  createEventCollector,
  createPod,
  FAKE_UUID,
  getCanvasId,
} from "../helpers";
import { getDb } from "../../src/database/index.js";
import { getStatements } from "../../src/database/statements.js";
import { runStore } from "../../src/services/runStore.js";

// Mock Claude Agent SDK 的實作
async function* mockQuery(): AsyncGenerator<any> {
  yield {
    type: "system",
    subtype: "init",
    session_id: `test-session-${Date.now()}`,
  };

  await new Promise((resolve) => setTimeout(resolve, 50));

  yield {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Test response" }],
    },
  };

  await new Promise((resolve) => setTimeout(resolve, 50));

  yield {
    type: "result",
    subtype: "success",
    result: "Test response",
  };
}

import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ChatSendPayload as PodChatSendPayload,
} from "../../src/schemas/index.js";
import {
  type PodErrorPayload,
  type RunChatCompletePayload,
  type RunCreatedPayload,
  type RunMessagePayload,
  type RunStatusChangedPayload,
} from "../../src/types";

// 使用 vi.mock() 來 mock @anthropic-ai/claude-agent-sdk 的 query export
// ESM 模組的 namespace 是 readonly，無法用 vi.spyOn 修改
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn((..._args: any[]) => mockQuery()),
  };
});

import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";

describe("Chat 管理", () => {
  let server: TestServerInstance;
  let client: TestWebSocketClient;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    if (server) await closeTestServer(server);
  });

  beforeEach(async () => {
    // claudeAgentSdk.query 已透過頂層 vi.mock() 處理
    // 每次測試前清除呼叫紀錄
    (claudeSDK.query as any).mockClear();

    client = await createSocketClient(server.baseUrl, server.canvasId);
  });

  afterEach(async () => {
    if (client?.connected) await disconnectSocket(client);

    vi.restoreAllMocks();
  });

  describe("發送聊天訊息", () => {
    it("使用者透過 WebSocket 送訊息後建立 run、收到串流事件並將完成狀態落地", async () => {
      const canvasId = await getCanvasId(client);
      const pod = await createPod(client, { name: "Streaming Chat Pod" });
      const collector = createEventCollector(client, [
        WebSocketResponseEvents.RUN_CREATED,
        WebSocketResponseEvents.RUN_MESSAGE,
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
      ]);

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        message: "Hello from websocket",
      } satisfies PodChatSendPayload);

      const created = await collector.waitFor<RunCreatedPayload>(
        WebSocketResponseEvents.RUN_CREATED,
        {
          predicate: (payload) =>
            payload.canvasId === canvasId &&
            payload.run.sourcePodId === pod.id &&
            payload.run.triggerMessage === "Hello from websocket",
        },
      );
      const runId = created.payload.run.id;

      const userMessage = await collector.waitFor<RunMessagePayload>(
        WebSocketResponseEvents.RUN_MESSAGE,
        {
          predicate: (payload) =>
            payload.runId === runId &&
            payload.podId === pod.id &&
            payload.role === "user" &&
            payload.content === "Hello from websocket" &&
            payload.isPartial === false,
        },
      );
      const assistantMessage = await collector.waitFor<RunMessagePayload>(
        WebSocketResponseEvents.RUN_MESSAGE,
        {
          predicate: (payload) =>
            payload.runId === runId &&
            payload.podId === pod.id &&
            payload.role === "assistant" &&
            payload.delta === "Test response" &&
            payload.isPartial === true,
        },
      );
      const complete = await collector.waitFor<RunChatCompletePayload>(
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        {
          predicate: (payload) =>
            payload.runId === runId &&
            payload.podId === pod.id &&
            payload.fullContent === "Test response",
        },
      );
      const statusChanged = await collector.waitFor<RunStatusChangedPayload>(
        WebSocketResponseEvents.RUN_STATUS_CHANGED,
        {
          predicate: (payload) =>
            payload.runId === runId && payload.status === "completed",
        },
      );

      expect(userMessage.payload.canvasId).toBe(canvasId);
      expect(assistantMessage.payload.messageId).toBe(
        complete.payload.messageId,
      );
      expect(statusChanged.payload.canvasId).toBe(canvasId);

      const run = runStore.getRun(runId);
      const instance = runStore.getPodInstance(runId, pod.id);
      const messages = runStore.getRunMessages(runId, pod.id);

      expect(run).toEqual(
        expect.objectContaining({
          id: runId,
          canvasId,
          sourcePodId: pod.id,
          triggerMessage: "Hello from websocket",
          status: "completed",
        }),
      );
      expect(instance).toEqual(
        expect.objectContaining({
          podId: pod.id,
          status: "completed",
          sessionId: expect.stringMatching(/^test-session-/),
        }),
      );
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "Hello from websocket",
          }),
          expect.objectContaining({
            role: "assistant",
            content: "Test response",
          }),
        ]),
      );

      collector.stop();
    });

    it("Pod 不存在時發送失敗", async () => {
      const canvasId = await getCanvasId(client);
      const errorPromise = waitForEvent<PodErrorPayload>(
        client,
        WebSocketResponseEvents.POD_ERROR,
      );

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: FAKE_UUID,
        message: "Hello",
      } satisfies PodChatSendPayload);

      const errorEvent = await errorPromise;
      expect(errorEvent.code).toBe("NOT_FOUND");
      expect(errorEvent.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );
    });

    it("Pod 已連接外部服務時發送失敗並回傳 INTEGRATION_BOUND", async () => {
      const canvasId = await getCanvasId(client);
      const pod = await createPod(client, { name: "Integration Pod" });

      const testAppId = "chat-test-slack-app-1";
      getStatements(getDb()).integrationApp.insert.run({
        $id: testAppId,
        $provider: "slack",
        $name: "Chat Test Slack App",
        $configJson: "{}",
        $extraJson: null,
      });

      const { podStore } = await import("../../src/services/podStore.js");
      podStore.addIntegrationBinding(canvasId, pod.id, {
        provider: "slack",
        appId: testAppId,
        resourceId: "C123",
      });

      const errorPromise = waitForEvent<PodErrorPayload>(
        client,
        WebSocketResponseEvents.POD_ERROR,
      );

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        message: "Hello",
      } satisfies PodChatSendPayload);

      const errorEvent = await errorPromise;
      expect(errorEvent.code).toBe("INTEGRATION_BOUND");
      expect(errorEvent.error).toEqual(
        expect.objectContaining({ key: expect.any(String) }),
      );

      await podStore.removeIntegrationBinding(canvasId, pod.id, "slack");
    });

    // Pod 總結中時發送失敗 — 隨 pod.status 概念移除，此測試刪除
  });

  // POD_CHAT_HISTORY 已隨 messages 表移除，歷史訊息只存在於 run scope
});
