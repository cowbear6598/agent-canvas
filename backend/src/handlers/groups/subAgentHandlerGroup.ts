import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  subAgentListSchema,
  subAgentCreateSchema,
  subAgentUpdateSchema,
  subAgentReadSchema,
  subAgentNoteCreateSchema,
  subAgentNoteListSchema,
  subAgentNoteUpdateSchema,
  subAgentNoteDeleteSchema,
  podBindSubAgentSchema,
  subAgentDeleteSchema,
  subAgentMoveToGroupSchema,
} from '../../schemas';
import {
  handleSubAgentList,
  handleSubAgentCreate,
  handleSubAgentUpdate,
  handleSubAgentRead,
  subAgentNoteHandlers,
  handlePodBindSubAgent,
  handleSubAgentDelete,
  handleSubAgentMoveToGroup,
} from '../subAgentHandlers.js';
import { createHandlerGroup } from './createHandlerGroup.js';

export const subAgentHandlerGroup = createHandlerGroup({
  name: 'subagent',
  handlers: [
    {
      event: WebSocketRequestEvents.SUBAGENT_LIST,
      handler: handleSubAgentList,
      schema: subAgentListSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_CREATE,
      handler: handleSubAgentCreate,
      schema: subAgentCreateSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_CREATED,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_UPDATE,
      handler: handleSubAgentUpdate,
      schema: subAgentUpdateSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_UPDATED,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_READ,
      handler: handleSubAgentRead,
      schema: subAgentReadSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_READ_RESULT,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_NOTE_CREATE,
      handler: subAgentNoteHandlers.handleNoteCreate,
      schema: subAgentNoteCreateSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_NOTE_CREATED,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_NOTE_LIST,
      handler: subAgentNoteHandlers.handleNoteList,
      schema: subAgentNoteListSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_NOTE_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_NOTE_UPDATE,
      handler: subAgentNoteHandlers.handleNoteUpdate,
      schema: subAgentNoteUpdateSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_NOTE_DELETE,
      handler: subAgentNoteHandlers.handleNoteDelete,
      schema: subAgentNoteDeleteSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED,
    },
    {
      event: WebSocketRequestEvents.POD_BIND_SUBAGENT,
      handler: handlePodBindSubAgent,
      schema: podBindSubAgentSchema,
      responseEvent: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_DELETE,
      handler: handleSubAgentDelete,
      schema: subAgentDeleteSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_DELETED,
    },
    {
      event: WebSocketRequestEvents.SUBAGENT_MOVE_TO_GROUP,
      handler: handleSubAgentMoveToGroup,
      schema: subAgentMoveToGroupSchema,
      responseEvent: WebSocketResponseEvents.SUBAGENT_MOVED_TO_GROUP,
    },
  ],
});
