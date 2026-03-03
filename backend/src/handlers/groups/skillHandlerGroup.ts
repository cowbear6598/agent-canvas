import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  skillListSchema,
  skillNoteCreateSchema,
  skillNoteListSchema,
  skillNoteUpdateSchema,
  skillNoteDeleteSchema,
  podBindSkillSchema,
  skillDeleteSchema,
  skillImportSchema,
} from '../../schemas';
import {
  handleSkillList,
  skillNoteHandlers,
  handlePodBindSkill,
  handleSkillDelete,
  handleSkillImport,
} from '../skillHandlers.js';
import { createHandlerGroup, createNoteHandlerGroupEntries } from './createHandlerGroup.js';

export const skillHandlerGroup = createHandlerGroup({
  name: 'skill',
  handlers: [
    {
      event: WebSocketRequestEvents.SKILL_LIST,
      handler: handleSkillList,
      schema: skillListSchema,
      responseEvent: WebSocketResponseEvents.SKILL_LIST_RESULT,
    },
    ...createNoteHandlerGroupEntries(
      skillNoteHandlers,
      { create: skillNoteCreateSchema, list: skillNoteListSchema, update: skillNoteUpdateSchema, delete: skillNoteDeleteSchema },
      {
        create: WebSocketRequestEvents.SKILL_NOTE_CREATE,
        list: WebSocketRequestEvents.SKILL_NOTE_LIST,
        update: WebSocketRequestEvents.SKILL_NOTE_UPDATE,
        delete: WebSocketRequestEvents.SKILL_NOTE_DELETE,
        created: WebSocketResponseEvents.SKILL_NOTE_CREATED,
        listResult: WebSocketResponseEvents.SKILL_NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
        deleted: WebSocketResponseEvents.SKILL_NOTE_DELETED,
      }
    ),
    {
      event: WebSocketRequestEvents.POD_BIND_SKILL,
      handler: handlePodBindSkill,
      schema: podBindSkillSchema,
      responseEvent: WebSocketResponseEvents.POD_SKILL_BOUND,
    },
    {
      event: WebSocketRequestEvents.SKILL_DELETE,
      handler: handleSkillDelete,
      schema: skillDeleteSchema,
      responseEvent: WebSocketResponseEvents.SKILL_DELETED,
    },
    {
      event: WebSocketRequestEvents.SKILL_IMPORT,
      handler: handleSkillImport,
      schema: skillImportSchema,
      responseEvent: WebSocketResponseEvents.SKILL_IMPORTED,
    },
  ],
});
