import { WebSocketResponseEvents } from '../schemas';
import { noteStore } from '../services/noteStores.js';
import { outputStyleService } from '../services/outputStyleService.js';
import { createNoteHandlers } from './factories/createNoteHandlers.js';

export const noteHandlers = createNoteHandlers({
  noteStore,
  events: {
    created: WebSocketResponseEvents.NOTE_CREATED,
    listResult: WebSocketResponseEvents.NOTE_LIST_RESULT,
    updated: WebSocketResponseEvents.NOTE_UPDATED,
    deleted: WebSocketResponseEvents.NOTE_DELETED,
  },
  foreignKeyField: 'outputStyleId',
  entityName: 'OutputStyle',
  logOperations: true,
  validateBeforeCreate: (outputStyleId) => outputStyleService.exists(outputStyleId),
});
