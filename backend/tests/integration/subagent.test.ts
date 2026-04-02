import { v4 as uuidv4 } from 'uuid';
import {
  emitAndWaitResponse,
  setupIntegrationTest,
} from '../setup';
import {
  createPod,
  createSubAgent,
  createRepository,
  getCanvasId,
  FAKE_SUBAGENT_ID,
  describeCRUDTests,
  describeNoteCRUDTests,
  describePodBindingTests,
  createSubAgentNote,
} from '../helpers';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type PodBindSubAgentPayload,
  type PodBindRepositoryPayload,
} from '../../src/schemas';
import {
  type PodSubAgentBoundPayload,
  type PodRepositoryBoundPayload,
} from '../../src/types';

describe('SubAgent 管理', () => {
  const { getClient, getServer } = setupIntegrationTest();

  async function makeAgent(client: any, name?: string) {
    return createSubAgent(client, name ?? `agent-${uuidv4()}`, '# Agent Content');
  }

  describeCRUDTests(
    {
      resourceName: 'SubAgent',
      createResource: (client, name) => makeAgent(client, name),
      fakeResourceId: FAKE_SUBAGENT_ID,
      events: {
        create: {
          request: WebSocketRequestEvents.SUBAGENT_CREATE,
          response: WebSocketResponseEvents.SUBAGENT_CREATED,
        },
        list: {
          request: WebSocketRequestEvents.SUBAGENT_LIST,
          response: WebSocketResponseEvents.SUBAGENT_LIST_RESULT,
        },
        read: {
          request: WebSocketRequestEvents.SUBAGENT_READ,
          response: WebSocketResponseEvents.SUBAGENT_READ_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.SUBAGENT_UPDATE,
          response: WebSocketResponseEvents.SUBAGENT_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.SUBAGENT_DELETE,
          response: WebSocketResponseEvents.SUBAGENT_DELETED,
        },
      },
      payloadBuilders: {
        create: (canvasId, name) => ({ canvasId, name, content: '# Agent Content' }),
        list: (canvasId) => ({ canvasId }),
        read: (canvasId, subAgentId) => ({ canvasId, subAgentId }),
        update: (canvasId, subAgentId) => ({ canvasId, subAgentId, content: '# Updated' }),
        delete: (canvasId, subAgentId) => ({ canvasId, subAgentId }),
      },
      responseFieldName: {
        list: 'subAgents',
        read: 'subAgent',
      },
      bindForDeleteTest: {
        bindEvent: {
          request: WebSocketRequestEvents.POD_BIND_SUBAGENT,
          response: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        },
        buildPayload: (canvasId, podId, subAgentId) => ({ canvasId, podId, subAgentId }),
      },
      invalidNames: [
        { name: '測試代理', desc: '中文名稱' },
        { name: 'my agent!', desc: '特殊字元' },
      ],
      hasContentValidation: true,
    },
    () => ({ client: getClient(), server: getServer() })
  );

  describeNoteCRUDTests(
    {
      resourceName: 'SubAgent',
      createParentResource: (client) => makeAgent(client),
      createNote: createSubAgentNote,
      events: {
        list: {
          request: WebSocketRequestEvents.SUBAGENT_NOTE_LIST,
          response: WebSocketResponseEvents.SUBAGENT_NOTE_LIST_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.SUBAGENT_NOTE_UPDATE,
          response: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.SUBAGENT_NOTE_DELETE,
          response: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED,
        },
      },
      parentIdFieldName: 'subAgentId',
    },
    () => ({ client: getClient(), server: getServer() })
  );

  describePodBindingTests(
    {
      resourceName: 'SubAgent',
      createResource: (client) => makeAgent(client),
      fakeResourceId: FAKE_SUBAGENT_ID,
      bindEvent: {
        request: WebSocketRequestEvents.POD_BIND_SUBAGENT,
        response: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
      },
      buildBindPayload: (canvasId, podId, subAgentId) => ({ canvasId, podId, subAgentId }),
      verifyBoundResponse: (response, subAgentId) => {
        expect(response.pod!.subAgentIds).toContain(subAgentId);
      },
    },
    () => ({ client: getClient(), server: getServer() })
  );

  describe('Pod 綁定 SubAgent', () => {
    it('SubAgent 已綁定時綁定失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const agent = await makeAgent(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindSubAgentPayload, PodSubAgentBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SUBAGENT,
        WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, subAgentId: agent.id }
      );

      const response = await emitAndWaitResponse<PodBindSubAgentPayload, PodSubAgentBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SUBAGENT,
        WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, subAgentId: agent.id }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('成功綁定 SubAgent 到已有 Repository 的 Pod', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const repo = await createRepository(client, `sa-repo-${uuidv4()}`);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindRepositoryPayload, PodRepositoryBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_REPOSITORY,
        WebSocketResponseEvents.POD_REPOSITORY_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, repositoryId: repo.id }
      );

      const agent = await makeAgent(client);

      const response = await emitAndWaitResponse<PodBindSubAgentPayload, PodSubAgentBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SUBAGENT,
        WebSocketResponseEvents.POD_SUBAGENT_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, subAgentId: agent.id }
      );

      expect(response.success).toBe(true);
      expect(response.pod!.subAgentIds).toContain(agent.id);
    });
  });
});
