import { v4 as uuidv4 } from 'uuid';
import { emitAndWaitResponse, setupIntegrationTest } from '../setup';
import { createPod, FAKE_UUID, getCanvasId} from '../helpers';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodSetMultiInstancePayload,
} from '../../src/schemas';
import { type PodMultiInstanceSetPayload } from '../../src/types';

describe('Multi Instance', () => {
  const { getClient } = setupIntegrationTest();

  describe('設定 Pod Multi Instance', () => {
    it('成功設定為 true', async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodSetMultiInstancePayload, PodMultiInstanceSetPayload>(
        client,
        WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
        WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
        { requestId: uuidv4(), canvasId, podId: pod.id, multiInstance: true }
      );

      expect(response.success).toBe(true);
      expect(response.pod!.multiInstance).toBe(true);
    });

    it('成功設定為 false', async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodSetMultiInstancePayload, PodMultiInstanceSetPayload>(
        client,
        WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
        WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
        { requestId: uuidv4(), canvasId, podId: pod.id, multiInstance: true }
      );

      const response = await emitAndWaitResponse<PodSetMultiInstancePayload, PodMultiInstanceSetPayload>(
        client,
        WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
        WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
        { requestId: uuidv4(), canvasId, podId: pod.id, multiInstance: false }
      );

      expect(response.success).toBe(true);
      expect(response.pod!.multiInstance).toBe(false);
    });

    it('Pod 不存在時設定失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodSetMultiInstancePayload, PodMultiInstanceSetPayload>(
        client,
        WebSocketRequestEvents.POD_SET_MULTI_INSTANCE,
        WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID, multiInstance: true }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });
});
