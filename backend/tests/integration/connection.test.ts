import { v4 as uuidv4 } from 'uuid';
import {
  emitAndWaitResponse,
  setupIntegrationTest,
} from '../setup';
import { createPod, createPodPair, setPodSchedule, FAKE_UUID, getCanvasId} from '../helpers';
import { createConnection } from '../helpers';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ConnectionCreatePayload,
  type ConnectionListPayload,
  type ConnectionDeletePayload,
  type ConnectionUpdatePayload,
} from '../../src/schemas';
import {
  type ConnectionCreatedPayload,
  type ConnectionListResultPayload,
  type ConnectionDeletedPayload,
  type ConnectionUpdatedPayload,
} from '../../src/types';

describe('Connection 管理', () => {
  const { getClient } = setupIntegrationTest();

  describe('Connection 建立', () => {
    it('成功建立兩個 Pod 之間的連線', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      expect(conn.id).toBeDefined();
      expect(conn.sourcePodId).toBe(podA.id);
      expect(conn.targetPodId).toBe(podB.id);
      expect(conn.sourceAnchor).toBe('right');
      expect(conn.targetAnchor).toBe('left');
    });

    it('目標 Pod 無排程時成功建立連線', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      expect(conn.id).toBeDefined();
      expect(conn.sourcePodId).toBe(podA.id);
      expect(conn.targetPodId).toBe(podB.id);
    });

    it('建立連線時成功清除目標 Pod 的排程', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);

      const scheduleConfig = {
        frequency: 'every-day' as const,
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

      const canvasModule = await import('../../src/services/podStore.js');
      const podAfterConnection = canvasModule.podStore.getById(await getCanvasId(client), podB.id);
      expect(podAfterConnection?.schedule).toBeUndefined();
    });

    it('來源 Pod 不存在時建立連線失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionCreatePayload, ConnectionCreatedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_CREATE,
        WebSocketResponseEvents.CONNECTION_CREATED,
        { requestId: uuidv4(), canvasId, sourcePodId: FAKE_UUID, sourceAnchor: 'right', targetPodId: pod.id, targetAnchor: 'left' }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('目標 Pod 不存在時建立連線失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionCreatePayload, ConnectionCreatedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_CREATE,
        WebSocketResponseEvents.CONNECTION_CREATED,
        { requestId: uuidv4(), canvasId, sourcePodId: pod.id, sourceAnchor: 'right', targetPodId: FAKE_UUID, targetAnchor: 'left' }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });

  describe('Connection 列表', () => {
    it('成功取得所有連線列表', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionListPayload, ConnectionListResultPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_LIST,
        WebSocketResponseEvents.CONNECTION_LIST_RESULT,
        { requestId: uuidv4(), canvasId }
      );

      expect(response.success).toBe(true);
      const found = response.connections!.find((c) => c.id === conn.id);
      expect(found).toBeDefined();
    });

    it('成功回傳連線陣列', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionListPayload, ConnectionListResultPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_LIST,
        WebSocketResponseEvents.CONNECTION_LIST_RESULT,
        { requestId: uuidv4(), canvasId }
      );

      expect(response.success).toBe(true);
      expect(Array.isArray(response.connections)).toBe(true);
    });
  });

  describe('Connection 刪除', () => {
    it('成功刪除連線', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionDeletePayload, ConnectionDeletedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_DELETE,
        WebSocketResponseEvents.CONNECTION_DELETED,
        { requestId: uuidv4(), canvasId, connectionId: conn.id }
      );

      expect(response.success).toBe(true);
      expect(response.connectionId).toBe(conn.id);
    });

    it('連線 ID 不存在時刪除失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionDeletePayload, ConnectionDeletedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_DELETE,
        WebSocketResponseEvents.CONNECTION_DELETED,
        { requestId: uuidv4(), canvasId, connectionId: FAKE_UUID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });

  describe('Connection 更新', () => {
    it('成功更新連線的觸發模式', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionUpdatePayload, ConnectionUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        { requestId: uuidv4(), canvasId, connectionId: conn.id, triggerMode: 'ai-decide' }
      );

      expect(response.success).toBe(true);
      expect(response.connection!.triggerMode).toBe('ai-decide');
    });

    it('成功更新連線的觸發模式為 direct', async () => {
      const client = getClient();
      const { podA, podB } = await createPodPair(client);
      const conn = await createConnection(client, podA.id, podB.id);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionUpdatePayload, ConnectionUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        { requestId: uuidv4(), canvasId, connectionId: conn.id, triggerMode: 'direct' }
      );

      expect(response.success).toBe(true);
      expect(response.connection!.triggerMode).toBe('direct');
    });

    it('連線 ID 不存在時更新失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<ConnectionUpdatePayload, ConnectionUpdatedPayload>(
        client,
        WebSocketRequestEvents.CONNECTION_UPDATE,
        WebSocketResponseEvents.CONNECTION_UPDATED,
        { requestId: uuidv4(), canvasId, connectionId: FAKE_UUID, triggerMode: 'auto' }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });
});
