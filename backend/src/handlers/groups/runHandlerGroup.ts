import {WebSocketRequestEvents, WebSocketResponseEvents} from '../../schemas';
import {runDeleteSchema, runLoadHistorySchema, runLoadPodMessagesSchema} from '../../schemas';
import {handleRunDelete, handleRunLoadHistory, handleRunLoadPodMessages} from '../runHandlers.js';
import {createHandlerGroup} from './createHandlerGroup.js';

export const runHandlerGroup = createHandlerGroup({
    name: 'run',
    handlers: [
        {
            event: WebSocketRequestEvents.RUN_DELETE,
            handler: handleRunDelete,
            schema: runDeleteSchema,
            responseEvent: WebSocketResponseEvents.RUN_DELETED,
        },
        {
            event: WebSocketRequestEvents.RUN_LOAD_HISTORY,
            handler: handleRunLoadHistory,
            schema: runLoadHistorySchema,
            responseEvent: WebSocketResponseEvents.RUN_HISTORY_LOADED,
        },
        {
            event: WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES,
            handler: handleRunLoadPodMessages,
            schema: runLoadPodMessagesSchema,
            responseEvent: WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED,
        },
    ],
});
