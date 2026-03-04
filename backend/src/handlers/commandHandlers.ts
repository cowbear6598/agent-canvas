import {WebSocketResponseEvents} from '../schemas';
import {commandService} from '../services/commandService.js';
import {commandNoteStore} from '../services/noteStores.js';
import {podStore} from '../services/podStore.js';
import {createNoteHandlers} from './factories/createNoteHandlers.js';
import {createResourceHandlers} from './factories/createResourceHandlers.js';
import {createBindHandler, createUnbindHandler, type BindResourceConfig} from './factories/createBindHandlers.js';
import {createMoveToGroupHandler} from './factories/createMoveToGroupHandler.js';
import {GROUP_TYPES} from '../types';

export const commandNoteHandlers = createNoteHandlers({
    noteStore: commandNoteStore,
    events: {
        created: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
        listResult: WebSocketResponseEvents.COMMAND_NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
        deleted: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
    },
    foreignKeyField: 'commandId',
    entityName: 'Command',
});

const resourceHandlers = createResourceHandlers({
    service: commandService,
    events: {
        listResult: WebSocketResponseEvents.COMMAND_LIST_RESULT,
        created: WebSocketResponseEvents.COMMAND_CREATED,
        updated: WebSocketResponseEvents.COMMAND_UPDATED,
        readResult: WebSocketResponseEvents.COMMAND_READ_RESULT,
        deleted: {
            deleted: WebSocketResponseEvents.COMMAND_DELETED,
            findPodsUsing: (canvasId, commandId) => podStore.findByCommandId(canvasId, commandId),
            deleteNotes: (canvasId, commandId) => commandNoteStore.deleteByForeignKey(canvasId, commandId),
        },
    },
    resourceName: 'Command',
    responseKey: 'command',
    listResponseKey: 'commands',
    idField: 'commandId',
});

export const handleCommandList = resourceHandlers.handleList;
export const handleCommandCreate = resourceHandlers.handleCreate;
export const handleCommandUpdate = resourceHandlers.handleUpdate;
export const handleCommandRead = resourceHandlers.handleRead;
export const handleCommandDelete = resourceHandlers.handleDelete;

const commandBindConfig: BindResourceConfig<typeof commandService> = {
    resourceName: 'Command',
    idField: 'commandId',
    isMultiBind: false,
    service: commandService,
    podStoreMethod: {
        bind: (canvasId, podId, commandId) => podStore.setCommandId(canvasId, podId, commandId),
        unbind: (canvasId, podId) => podStore.setCommandId(canvasId, podId, null),
    },
    getPodResourceIds: (pod) => pod.commandId,
    copyResourceToPod: (commandId, pod) => commandService.copyCommandToPod(commandId, pod.id, pod.workspacePath),
    deleteResourceFromPath: (workspacePath) => commandService.deleteCommandFromPath(workspacePath),
    events: {
        bound: WebSocketResponseEvents.POD_COMMAND_BOUND,
        unbound: WebSocketResponseEvents.POD_COMMAND_UNBOUND,
    },
};

const commandBindHandler = createBindHandler(commandBindConfig);
const commandUnbindHandler = createUnbindHandler(commandBindConfig);

export const handlePodBindCommand = commandBindHandler;
export const handlePodUnbindCommand = commandUnbindHandler;

export const handleCommandMoveToGroup = createMoveToGroupHandler({
    service: commandService,
    resourceName: 'Command',
    idField: 'itemId',
    groupType: GROUP_TYPES.COMMAND,
    events: {
        moved: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
    },
});
