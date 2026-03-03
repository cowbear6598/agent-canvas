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
import { createHandlerGroup } from './createHandlerGroup.js';

export const skillHandlerGroup = createHandlerGroup({
  name: 'skill',
  handlers: [
    {
      event: WebSocketRequestEvents.SKILL_LIST,
      handler: handleSkillList,
      schema: skillListSchema,
      responseEvent: WebSocketResponseEvents.SKILL_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.SKILL_NOTE_CREATE,
      handler: skillNoteHandlers.handleNoteCreate,
      schema: skillNoteCreateSchema,
      responseEvent: WebSocketResponseEvents.SKILL_NOTE_CREATED,
    },
    {
      event: WebSocketRequestEvents.SKILL_NOTE_LIST,
      handler: skillNoteHandlers.handleNoteList,
      schema: skillNoteListSchema,
      responseEvent: WebSocketResponseEvents.SKILL_NOTE_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.SKILL_NOTE_UPDATE,
      handler: skillNoteHandlers.handleNoteUpdate,
      schema: skillNoteUpdateSchema,
      responseEvent: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
    },
    {
      event: WebSocketRequestEvents.SKILL_NOTE_DELETE,
      handler: skillNoteHandlers.handleNoteDelete,
      schema: skillNoteDeleteSchema,
      responseEvent: WebSocketResponseEvents.SKILL_NOTE_DELETED,
    },
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
