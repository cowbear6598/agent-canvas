import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../schemas';
import {
  commandListSchema,
  commandCreateSchema,
  commandUpdateSchema,
  commandReadSchema,
  commandNoteCreateSchema,
  commandNoteListSchema,
  commandNoteUpdateSchema,
  commandNoteDeleteSchema,
  podBindCommandSchema,
  podUnbindCommandSchema,
  commandDeleteSchema,
  commandMoveToGroupSchema,
} from '../../schemas';
import {
  handleCommandList,
  handleCommandCreate,
  handleCommandUpdate,
  handleCommandRead,
  commandNoteHandlers,
  handlePodBindCommand,
  handlePodUnbindCommand,
  handleCommandDelete,
  handleCommandMoveToGroup,
} from '../commandHandlers.js';
import { createHandlerGroup } from './createHandlerGroup.js';

export const commandHandlerGroup = createHandlerGroup({
  name: 'command',
  handlers: [
    {
      event: WebSocketRequestEvents.COMMAND_LIST,
      handler: handleCommandList,
      schema: commandListSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.COMMAND_CREATE,
      handler: handleCommandCreate,
      schema: commandCreateSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_CREATED,
    },
    {
      event: WebSocketRequestEvents.COMMAND_UPDATE,
      handler: handleCommandUpdate,
      schema: commandUpdateSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_UPDATED,
    },
    {
      event: WebSocketRequestEvents.COMMAND_READ,
      handler: handleCommandRead,
      schema: commandReadSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_READ_RESULT,
    },
    {
      event: WebSocketRequestEvents.COMMAND_NOTE_CREATE,
      handler: commandNoteHandlers.handleNoteCreate,
      schema: commandNoteCreateSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
    },
    {
      event: WebSocketRequestEvents.COMMAND_NOTE_LIST,
      handler: commandNoteHandlers.handleNoteList,
      schema: commandNoteListSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_NOTE_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.COMMAND_NOTE_UPDATE,
      handler: commandNoteHandlers.handleNoteUpdate,
      schema: commandNoteUpdateSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
    },
    {
      event: WebSocketRequestEvents.COMMAND_NOTE_DELETE,
      handler: commandNoteHandlers.handleNoteDelete,
      schema: commandNoteDeleteSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
    },
    {
      event: WebSocketRequestEvents.POD_BIND_COMMAND,
      handler: handlePodBindCommand,
      schema: podBindCommandSchema,
      responseEvent: WebSocketResponseEvents.POD_COMMAND_BOUND,
    },
    {
      event: WebSocketRequestEvents.POD_UNBIND_COMMAND,
      handler: handlePodUnbindCommand,
      schema: podUnbindCommandSchema,
      responseEvent: WebSocketResponseEvents.POD_COMMAND_UNBOUND,
    },
    {
      event: WebSocketRequestEvents.COMMAND_DELETE,
      handler: handleCommandDelete,
      schema: commandDeleteSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_DELETED,
    },
    {
      event: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
      handler: handleCommandMoveToGroup,
      schema: commandMoveToGroupSchema,
      responseEvent: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
    },
  ],
});
