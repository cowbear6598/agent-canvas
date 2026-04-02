import { v4 as uuidv4 } from 'uuid';
import {
  emitAndWaitResponse,
  setupIntegrationTest,
} from '../setup';
import { createPod, createOutputStyle, createSkillFile, FAKE_UUID, FAKE_STYLE_ID, getCanvasId} from '../helpers';
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type NoteCreatePayload,
  type NoteListPayload,
  type NoteUpdatePayload,
  type NoteDeletePayload,
  type SkillNoteCreatePayload,
  type SkillNoteUpdatePayload,
  type SkillNoteDeletePayload,
} from '../../src/schemas';
import {
  type NoteCreatedPayload,
  type NoteListResultPayload,
  type NoteUpdatedPayload,
  type NoteDeletedPayload,
  type SkillNoteCreatedPayload,
  type SkillNoteUpdatedPayload,
  type SkillNoteDeletedPayload,
} from '../../src/types';

describe('Note 管理', () => {
  const { getClient } = setupIntegrationTest();

  async function createTestNote(boundToPodId: string | null = null) {
    const client = getClient();
    const style = await createOutputStyle(client, `note-style-${uuidv4()}`, '# S');
    const canvasId = await getCanvasId(client);

    const response = await emitAndWaitResponse<NoteCreatePayload, NoteCreatedPayload>(
      client,
      WebSocketRequestEvents.NOTE_CREATE,
      WebSocketResponseEvents.NOTE_CREATED,
      {
        requestId: uuidv4(),
        canvasId,
        outputStyleId: style.id,
        name: 'Test Note',
        x: 100,
        y: 200,
        boundToPodId,
        originalPosition: null,
      }
    );

    return response.note!;
  }

  describe('Note 建立', () => {
    it('成功建立', async () => {
      const note = await createTestNote();

      expect(note.id).toBeDefined();
      expect(note.name).toBe('Test Note');
      expect(note.x).toBe(100);
      expect(note.y).toBe(200);
      expect(note.boundToPodId).toBeNull();
    });

    it('綁定 Pod 時成功建立', async () => {
      const client = getClient();
      const pod = await createPod(client);
      const note = await createTestNote(pod.id);

      expect(note.boundToPodId).toBe(pod.id);
    });
  });

  describe('Note 列表', () => {
    it('成功回傳所有 Note', async () => {
      const client = getClient();
      await createTestNote();
      await createTestNote();

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteListPayload, NoteListResultPayload>(
        client,
        WebSocketRequestEvents.NOTE_LIST,
        WebSocketResponseEvents.NOTE_LIST_RESULT,
        { requestId: uuidv4(), canvasId }
      );

      expect(response.success).toBe(true);
      expect(response.notes!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Note 更新', () => {
    it('成功更新位置', async () => {
      const client = getClient();
      const note = await createTestNote();

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteUpdatePayload, NoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_UPDATE,
        WebSocketResponseEvents.NOTE_UPDATED,
        { requestId: uuidv4(), canvasId, noteId: note.id, x: 999, y: 888 }
      );

      expect(response.success).toBe(true);
      expect(response.note!.x).toBe(999);
      expect(response.note!.y).toBe(888);
    });

    it('成功更新綁定', async () => {
      const client = getClient();
      const note = await createTestNote();
      const pod = await createPod(client);

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteUpdatePayload, NoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_UPDATE,
        WebSocketResponseEvents.NOTE_UPDATED,
        { requestId: uuidv4(), canvasId, noteId: note.id, boundToPodId: pod.id }
      );

      expect(response.success).toBe(true);
      expect(response.note!.boundToPodId).toBe(pod.id);
    });

    it('不存在的 ID 時更新失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteUpdatePayload, NoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_UPDATE,
        WebSocketResponseEvents.NOTE_UPDATED,
        { requestId: uuidv4(), canvasId, noteId: FAKE_UUID, x: 0 }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });

  describe('Note 刪除', () => {
    it('成功刪除', async () => {
      const client = getClient();
      const note = await createTestNote();

      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteDeletePayload, NoteDeletedPayload>(
        client,
        WebSocketRequestEvents.NOTE_DELETE,
        WebSocketResponseEvents.NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: note.id }
      );

      expect(response.success).toBe(true);
      expect(response.noteId).toBe(note.id);
    });

    it('不存在的 ID 時刪除失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteDeletePayload, NoteDeletedPayload>(
        client,
        WebSocketRequestEvents.NOTE_DELETE,
        WebSocketResponseEvents.NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: FAKE_UUID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });
  });

  describe('OutputStyle Note 邊界測試', () => {
    it('OutputStyle 不存在時建立失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<NoteCreatePayload, NoteCreatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_CREATE,
        WebSocketResponseEvents.NOTE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          outputStyleId: FAKE_STYLE_ID,
          name: 'Test Note',
          x: 100,
          y: 100,
          boundToPodId: null,
          originalPosition: null,
        }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('已刪除後再更新失敗', async () => {
      const client = getClient();
      const note = await createTestNote();
      const canvasId = await getCanvasId(client);

      await emitAndWaitResponse<NoteDeletePayload, NoteDeletedPayload>(
        client,
        WebSocketRequestEvents.NOTE_DELETE,
        WebSocketResponseEvents.NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: note.id }
      );

      const updateResponse = await emitAndWaitResponse<NoteUpdatePayload, NoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_UPDATE,
        WebSocketResponseEvents.NOTE_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          noteId: note.id,
          x: 500,
        }
      );

      expect(updateResponse.success).toBe(false);
      expect(updateResponse.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('重複刪除失敗', async () => {
      const client = getClient();
      const note = await createTestNote();
      const canvasId = await getCanvasId(client);

      await emitAndWaitResponse<NoteDeletePayload, NoteDeletedPayload>(
        client,
        WebSocketRequestEvents.NOTE_DELETE,
        WebSocketResponseEvents.NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: note.id }
      );

      const deleteResponse = await emitAndWaitResponse<NoteDeletePayload, NoteDeletedPayload>(
        client,
        WebSocketRequestEvents.NOTE_DELETE,
        WebSocketResponseEvents.NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: note.id }
      );

      expect(deleteResponse.success).toBe(false);
      expect(deleteResponse.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('部分欄位只更新提供的', async () => {
      const client = getClient();
      const style = await createOutputStyle(client, `style-${uuidv4()}`, '# Test');
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<NoteCreatePayload, NoteCreatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_CREATE,
        WebSocketResponseEvents.NOTE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          outputStyleId: style.id,
          name: 'Original Note',
          x: 100,
          y: 200,
          boundToPodId: null,
          originalPosition: null,
        }
      );

      const noteId = createResponse.note!.id;

      const updateResponse = await emitAndWaitResponse<NoteUpdatePayload, NoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.NOTE_UPDATE,
        WebSocketResponseEvents.NOTE_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          noteId,
          x: 500,
        }
      );

      expect(updateResponse.success).toBe(true);
      expect(updateResponse.note!.x).toBe(500);
      expect(updateResponse.note!.y).toBe(200);
      expect(updateResponse.note!.name).toBe('Original Note');
    });
  });

  describe('Skill Note 邊界測試', () => {
    it('無驗證函數時成功建立', async () => {
      const client = getClient();
      const skillId = await createSkillFile(`skill-${uuidv4()}`, '# Test');
      const canvasId = await getCanvasId(client);

      const response = await emitAndWaitResponse<SkillNoteCreatePayload, SkillNoteCreatedPayload>(
        client,
        WebSocketRequestEvents.SKILL_NOTE_CREATE,
        WebSocketResponseEvents.SKILL_NOTE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          skillId,
          name: 'Skill Note',
          x: 100,
          y: 100,
          boundToPodId: null,
          originalPosition: null,
        }
      );

      expect(response.success).toBe(true);
      expect(response.note).toBeDefined();
    });

    it('不存在的 ID 時更新失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<SkillNoteUpdatePayload, SkillNoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.SKILL_NOTE_UPDATE,
        WebSocketResponseEvents.SKILL_NOTE_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          noteId: FAKE_UUID,
          x: 500,
        }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('不存在的 ID 時刪除失敗', async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);
      const response = await emitAndWaitResponse<SkillNoteDeletePayload, SkillNoteDeletedPayload>(
        client,
        WebSocketRequestEvents.SKILL_NOTE_DELETE,
        WebSocketResponseEvents.SKILL_NOTE_DELETED,
        { requestId: uuidv4(), canvasId, noteId: FAKE_UUID }
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
    });

    it('部分欄位只更新提供的', async () => {
      const client = getClient();
      const skillId = await createSkillFile(`skill-${uuidv4()}`, '# Test');
      const canvasId = await getCanvasId(client);
      const createResponse = await emitAndWaitResponse<SkillNoteCreatePayload, SkillNoteCreatedPayload>(
        client,
        WebSocketRequestEvents.SKILL_NOTE_CREATE,
        WebSocketResponseEvents.SKILL_NOTE_CREATED,
        {
          requestId: uuidv4(),
          canvasId,
          skillId,
          name: 'Original Skill Note',
          x: 100,
          y: 200,
          boundToPodId: null,
          originalPosition: null,
        }
      );

      const noteId = createResponse.note!.id;

      const updateResponse = await emitAndWaitResponse<SkillNoteUpdatePayload, SkillNoteUpdatedPayload>(
        client,
        WebSocketRequestEvents.SKILL_NOTE_UPDATE,
        WebSocketResponseEvents.SKILL_NOTE_UPDATED,
        {
          requestId: uuidv4(),
          canvasId,
          noteId,
          y: 300,
        }
      );

      expect(updateResponse.success).toBe(true);
      expect(updateResponse.note!.x).toBe(100);
      expect(updateResponse.note!.y).toBe(300);
      expect(updateResponse.note!.name).toBe('Original Skill Note');
    });
  });
});
