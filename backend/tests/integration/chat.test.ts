import type { TestWebSocketClient } from '../setup';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestServer,
  closeTestServer,
  createSocketClient,
  emitAndWaitResponse,
  waitForEvent,
  disconnectSocket,
  type TestServerInstance,
} from '../setup';
import { createPod, FAKE_UUID, getCanvasId } from '../helpers';

// Mock Claude Agent SDK 的實作
async function* mockQuery(): AsyncGenerator<any> {
  yield {
    type: 'system',
    subtype: 'init',
    session_id: `test-session-${Date.now()}`,
  };

  await new Promise((resolve) => setTimeout(resolve, 50));

  yield {
    type: 'assistant',
    message: {
      content: [{ text: 'Test response' }],
    },
  };

  await new Promise((resolve) => setTimeout(resolve, 1500));

  yield {
    type: 'result',
    subtype: 'success',
    result: 'Test response',
  };
}

import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ChatSendPayload as PodChatSendPayload,
  type ChatHistoryPayload as PodChatHistoryPayload,
} from '../../src/schemas/index.js';
import {
  type PodChatHistoryResultPayload,
  type PodErrorPayload,
} from '../../src/types';

// 使用 vi.mock() 來 mock @anthropic-ai/claude-agent-sdk 的 query export
// ESM 模組的 namespace 是 readonly，無法用 vi.spyOn 修改
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...original,
    query: vi.fn((..._args: any[]) => mockQuery()),
  };
});

import * as claudeSDK from '@anthropic-ai/claude-agent-sdk';

describe('Chat 管理', () => {
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

  describe('發送聊天訊息', () => {
    it('Pod 不存在時發送失敗', async () => {
      const canvasId = await getCanvasId(client);
      const errorPromise = waitForEvent<PodErrorPayload>(
        client,
        WebSocketResponseEvents.POD_ERROR
      );

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: FAKE_UUID,
        message: 'Hello',
      } satisfies PodChatSendPayload);

      const errorEvent = await errorPromise;
      expect(errorEvent.code).toBe('NOT_FOUND');
      expect(errorEvent.error).toContain('找不到');
    });

    it('Pod 已連接 Slack 時發送失敗並回傳 SLACK_BOUND', async () => {
      const canvasId = await getCanvasId(client);
      const pod = await createPod(client, { name: 'Slack Pod' });

      const { podStore } = await import('../../src/services/podStore.js');
      podStore.setSlackBinding(canvasId, pod.id, { slackAppId: 'app-1', slackChannelId: 'C123' });

      const errorPromise = waitForEvent<PodErrorPayload>(
        client,
        WebSocketResponseEvents.POD_ERROR
      );

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        message: 'Hello',
      } satisfies PodChatSendPayload);

      const errorEvent = await errorPromise;
      expect(errorEvent.code).toBe('SLACK_BOUND');
      expect(errorEvent.error).toContain('Slack');

      podStore.setSlackBinding(canvasId, pod.id, null);
    });

    it('Pod 總結中時發送失敗', async () => {
      const canvasId = await getCanvasId(client);
      const pod = await createPod(client, { name: 'Summarizing Pod' });

      const { podStore } = await import('../../src/services/podStore.js');
      podStore.setStatus(canvasId, pod.id, 'summarizing');

      const errorPromise = waitForEvent<PodErrorPayload>(
        client,
        WebSocketResponseEvents.POD_ERROR
      );

      client.emit(WebSocketRequestEvents.POD_CHAT_SEND, {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        message: 'Hello',
      } satisfies PodChatSendPayload);

      const errorEvent = await errorPromise;
      expect(errorEvent.code).toBe('POD_BUSY');
      expect(errorEvent.error).toContain('summarizing');

      podStore.setStatus(canvasId, pod.id, 'idle');
    });
  });

  describe('取得聊天歷史', () => {
    it('新 Pod 回傳空陣列', async () => {
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodChatHistoryPayload, PodChatHistoryResultPayload>(
        client,
        WebSocketRequestEvents.POD_CHAT_HISTORY,
        WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT,
        { requestId: uuidv4(), canvasId, podId: pod.id }
      );

      expect(response.success).toBe(true);
      expect(response.messages).toEqual([]);
    });

    it('Pod 不存在時取得歷史失敗', async () => {
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodChatHistoryPayload, PodChatHistoryResultPayload>(
        client,
        WebSocketRequestEvents.POD_CHAT_HISTORY,
        WebSocketResponseEvents.POD_CHAT_HISTORY_RESULT,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain('找不到');
    });
  });
});
