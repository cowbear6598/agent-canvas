import { v4 as uuidv4 } from 'uuid';
import {
  emitAndWaitResponse,
  setupIntegrationTest,
} from '../setup';
import {
  createPod,
  createCommand,
  getCanvasId,
  FAKE_UUID,
  FAKE_COMMAND_ID,
  describeCRUDTests,
  describeNoteCRUDTests,
  describePodBindingTests,
  createCommandNote,
} from '../helpers';
import { podStore } from '../../src/services/podStore.js';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodBindCommandPayload,
  type PodUnbindCommandPayload,
} from '../../src/schemas';
import {
  type PodCommandBoundPayload,
  type PodCommandUnboundPayload,
} from '../../src/types';

describe('Command 管理', () => {
  const { getClient, getServer } = setupIntegrationTest();

  const getContext = () => ({ client: getClient(), server: getServer() });

  async function makeCommand(client: any, name?: string) {
    return createCommand(client, name ?? `cmd-${uuidv4()}`, '# Command Content');
  }

  describeCRUDTests(
    {
      resourceName: 'Command',
      createResource: (client, name) => makeCommand(client, name),
      fakeResourceId: FAKE_COMMAND_ID,
      events: {
        create: { request: WebSocketRequestEvents.COMMAND_CREATE, response: WebSocketResponseEvents.COMMAND_CREATED },
        list: { request: WebSocketRequestEvents.COMMAND_LIST, response: WebSocketResponseEvents.COMMAND_LIST_RESULT },
        read: { request: WebSocketRequestEvents.COMMAND_READ, response: WebSocketResponseEvents.COMMAND_READ_RESULT },
        update: { request: WebSocketRequestEvents.COMMAND_UPDATE, response: WebSocketResponseEvents.COMMAND_UPDATED },
        delete: { request: WebSocketRequestEvents.COMMAND_DELETE, response: WebSocketResponseEvents.COMMAND_DELETED },
      },
      payloadBuilders: {
        create: (canvasId, name) => ({ canvasId, name, content: '# Command Content' }),
        list: (canvasId) => ({ canvasId }),
        read: (canvasId, commandId) => ({ canvasId, commandId }),
        update: (canvasId, commandId) => ({ canvasId, commandId, content: '# Updated' }),
        delete: (canvasId, commandId) => ({ canvasId, commandId }),
      },
      responseFieldName: {
        list: 'commands',
        read: 'command',
      },
      bindForDeleteTest: {
        bindEvent: { request: WebSocketRequestEvents.POD_BIND_COMMAND, response: WebSocketResponseEvents.POD_COMMAND_BOUND },
        buildPayload: (canvasId, podId, commandId) => ({ canvasId, podId, commandId }),
      },
      invalidNames: [
        { name: '測試指令', desc: '中文名稱' },
        { name: 'my command!', desc: '特殊字元' },
      ],
      hasContentValidation: true,
    },
    getContext
  );

  describeNoteCRUDTests(
    {
      resourceName: 'Command',
      createParentResource: (client) => makeCommand(client),
      createNote: createCommandNote,
      events: {
        list: { request: WebSocketRequestEvents.COMMAND_NOTE_LIST, response: WebSocketResponseEvents.COMMAND_NOTE_LIST_RESULT },
        update: { request: WebSocketRequestEvents.COMMAND_NOTE_UPDATE, response: WebSocketResponseEvents.COMMAND_NOTE_UPDATED },
        delete: { request: WebSocketRequestEvents.COMMAND_NOTE_DELETE, response: WebSocketResponseEvents.COMMAND_NOTE_DELETED },
      },
      parentIdFieldName: 'commandId',
    },
    getContext
  );

  describePodBindingTests(
    {
      resourceName: 'Command',
      createResource: (client) => makeCommand(client),
      fakeResourceId: FAKE_COMMAND_ID,
      bindEvent: { request: WebSocketRequestEvents.POD_BIND_COMMAND, response: WebSocketResponseEvents.POD_COMMAND_BOUND },
      buildBindPayload: (canvasId, podId, commandId) => ({ canvasId, podId, commandId }),
      verifyBoundResponse: (response, commandId) => expect(response.pod.commandId).toBe(commandId),
    },
    getContext
  );

  describe('Pod 綁定 Command - Command 特有測試', () => {
    it('Pod 已有 Command 時綁定失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd1 = await makeCommand(client);
      const cmd2 = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd1.id }
      );

      const response = await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd2.id }
      );

      expect(response.success).toBe(false);
    });

    it('綁定 Command 後 SQLite 立即持久化', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id }
      );

      const reloadedPod = podStore.getById(canvasId, pod.id);
      expect(reloadedPod).toBeDefined();
      expect(reloadedPod!.commandId).toBe(cmd.id);
    });
  });

  describe('Pod 解除綁定 Command - Command 特有測試', () => {
    it('成功解除綁定 Command', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const cmd = await makeCommand(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindCommandPayload, PodCommandBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, commandId: cmd.id }
      );

      const response = await emitAndWaitResponse<PodUnbindCommandPayload, PodCommandUnboundPayload>(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id }
      );

      expect(response.success).toBe(true);
      expect(response.pod!.commandId).toBeNull();
    });

    it('Pod 無 Command 時解除綁定成功', async () => {
      const client = getClient();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodUnbindCommandPayload, PodCommandUnboundPayload>(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id }
      );

      expect(response.success).toBe(true);
    });

    it('Pod 不存在時解除綁定失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<PodUnbindCommandPayload, PodCommandUnboundPayload>(
        client,
        WebSocketRequestEvents.POD_UNBIND_COMMAND,
        WebSocketResponseEvents.POD_COMMAND_UNBOUND,
        { requestId: uuidv4(), canvasId, podId: FAKE_UUID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain('找不到');
    });
  });
});
