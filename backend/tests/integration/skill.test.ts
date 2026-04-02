import { v4 as uuidv4 } from 'uuid';
import {
  emitAndWaitResponse,
  setupIntegrationTest,
} from '../setup';
import {
  createPod,
  createSkillFile,
  getCanvasId,
  FAKE_SKILL_ID,
  describeNoteCRUDTests,
  describePodBindingTests,
  createSkillNote,
} from '../helpers';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type SkillListPayload,
  type PodBindSkillPayload,
  type SkillDeletePayload,
} from '../../src/schemas';
import {
  type SkillListResultPayload,
  type PodSkillBoundPayload,
  type SkillDeletedPayload,
} from '../../src/types';

describe('Skill 管理', () => {
  const { getClient, getServer } = setupIntegrationTest();

  async function ensureSkill(client: any, name?: string): Promise<{ id: string }> {
    const skillName = name ?? `skill-${uuidv4()}`;
    await createSkillFile(skillName, '# Test Skill');
    return { id: skillName };
  }

  describe('Skill 列表', () => {
    it('成功回傳所有 Skill', async () => {
      const client = getClient();
      const skill = await ensureSkill(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<SkillListPayload, SkillListResultPayload>(
        client,
        WebSocketRequestEvents.SKILL_LIST,
        WebSocketResponseEvents.SKILL_LIST_RESULT,
        { requestId: uuidv4(), canvasId }
      );

      expect(response.success).toBe(true);
      const names = response.skills!.map((s) => s.name);
      expect(names).toContain(skill.id);
    });
  });

  describeNoteCRUDTests(
    {
      resourceName: 'Skill',
      createParentResource: (client) => ensureSkill(client),
      createNote: createSkillNote,
      events: {
        list: {
          request: WebSocketRequestEvents.SKILL_NOTE_LIST,
          response: WebSocketResponseEvents.SKILL_NOTE_LIST_RESULT,
        },
        update: {
          request: WebSocketRequestEvents.SKILL_NOTE_UPDATE,
          response: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
        },
        delete: {
          request: WebSocketRequestEvents.SKILL_NOTE_DELETE,
          response: WebSocketResponseEvents.SKILL_NOTE_DELETED,
        },
      },
      parentIdFieldName: 'skillId',
    },
    () => ({ client: getClient(), server: getServer() })
  );

  describePodBindingTests(
    {
      resourceName: 'Skill',
      createResource: (client) => ensureSkill(client),
      fakeResourceId: FAKE_SKILL_ID,
      bindEvent: {
        request: WebSocketRequestEvents.POD_BIND_SKILL,
        response: WebSocketResponseEvents.POD_SKILL_BOUND,
      },
      buildBindPayload: (canvasId, podId, skillId) => ({ canvasId, podId, skillId }),
      verifyBoundResponse: (response, skillId) => {
        expect(response.pod!.skillIds).toContain(skillId);
      },
    },
    () => ({ client: getClient(), server: getServer() })
  );

  describe('Pod 綁定 Skill', () => {
    it('Skill 已綁定時綁定失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const skill = await ensureSkill(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindSkillPayload, PodSkillBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SKILL,
        WebSocketResponseEvents.POD_SKILL_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, skillId: skill.id }
      );

      const response = await emitAndWaitResponse<PodBindSkillPayload, PodSkillBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SKILL,
        WebSocketResponseEvents.POD_SKILL_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, skillId: skill.id }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });

  describe('Skill 刪除', () => {
    it('成功刪除', async () => {
      const client = getClient();
      const skill = await ensureSkill(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<SkillDeletePayload, SkillDeletedPayload>(
        client,
        WebSocketRequestEvents.SKILL_DELETE,
        WebSocketResponseEvents.SKILL_DELETED,
        { requestId: uuidv4(), canvasId, skillId: skill.id }
      );

      expect(response.success).toBe(true);
    });

    it('不存在的 ID 時刪除失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<SkillDeletePayload, SkillDeletedPayload>(
        client,
        WebSocketRequestEvents.SKILL_DELETE,
        WebSocketResponseEvents.SKILL_DELETED,
        { requestId: uuidv4(), canvasId, skillId: FAKE_SKILL_ID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('使用中時刪除失敗', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const skill = await ensureSkill(client);

      const canvasId = await getCanvasId(client);
      await emitAndWaitResponse<PodBindSkillPayload, PodSkillBoundPayload>(
        client,
        WebSocketRequestEvents.POD_BIND_SKILL,
        WebSocketResponseEvents.POD_SKILL_BOUND,
        { requestId: uuidv4(), canvasId, podId: pod.id, skillId: skill.id }
      );

      const response = await emitAndWaitResponse<SkillDeletePayload, SkillDeletedPayload>(
        client,
        WebSocketRequestEvents.SKILL_DELETE,
        WebSocketResponseEvents.SKILL_DELETED,
        { requestId: uuidv4(), canvasId, skillId: skill.id }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });
});
