import {WebSocketResponseEvents} from '../schemas';
import type {
    PodBindSubAgentPayload,
    SubAgentMoveToGroupPayload,
} from '../schemas';
import {subAgentService} from '../services/subAgentService.js';
import {subAgentNoteStore} from '../services/noteStores.js';
import {podStore} from '../services/podStore.js';
import {repositoryService} from '../services/repositoryService.js';
import {createNoteHandlers} from './factories/createNoteHandlers.js';
import {createResourceHandlers} from './factories/createResourceHandlers.js';
import {createBindHandler} from './factories/createBindHandlers.js';
import {createMoveToGroupHandler} from './factories/createMoveToGroupHandler.js';
import {GROUP_TYPES} from '../types';
import type {Pod} from '../types/pod.js';

export const subAgentNoteHandlers = createNoteHandlers({
    noteStore: subAgentNoteStore,
    events: {
        created: WebSocketResponseEvents.SUBAGENT_NOTE_CREATED,
        listResult: WebSocketResponseEvents.SUBAGENT_NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED,
        deleted: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED,
    },
    foreignKeyField: 'subAgentId',
    entityName: 'SubAgent',
});

const resourceHandlers = createResourceHandlers({
    service: subAgentService,
    events: {
        listResult: WebSocketResponseEvents.SUBAGENT_LIST_RESULT,
        created: WebSocketResponseEvents.SUBAGENT_CREATED,
        updated: WebSocketResponseEvents.SUBAGENT_UPDATED,
        readResult: WebSocketResponseEvents.SUBAGENT_READ_RESULT,
        deleted: {
            deleted: WebSocketResponseEvents.SUBAGENT_DELETED,
            findPodsUsing: (canvasId, subAgentId) => podStore.findBySubAgentId(canvasId, subAgentId),
            deleteNotes: (canvasId, subAgentId) => subAgentNoteStore.deleteByForeignKey(canvasId, subAgentId),
        },
    },
    resourceName: 'SubAgent',
    responseKey: 'subAgent',
    listResponseKey: 'subAgents',
    idField: 'subAgentId',
});

export const handleSubAgentList = resourceHandlers.handleList;
export const handleSubAgentCreate = resourceHandlers.handleCreate;
export const handleSubAgentUpdate = resourceHandlers.handleUpdate;
export const handleSubAgentRead = resourceHandlers.handleRead;
export const handleSubAgentDelete = resourceHandlers.handleDelete;

const subAgentBindHandler = createBindHandler({
    resourceName: 'SubAgent',
    idField: 'subAgentId',
    isMultiBind: true,
    service: subAgentService,
    podStoreMethod: {
        bind: (canvasId, podId, subAgentId) => podStore.addSubAgentId(canvasId, podId, subAgentId),
    },
    getPodResourceIds: (pod) => pod.subAgentIds,
    copyResourceToPod: async (subAgentId: string, pod: Pod) => {
        if (!pod.repositoryId) {
            await subAgentService.copySubAgentToPod(subAgentId, pod.id, pod.workspacePath);
        } else {
            const repositoryPath = repositoryService.getRepositoryPath(pod.repositoryId);
            await subAgentService.copySubAgentToRepository(subAgentId, repositoryPath);
        }
    },
    events: {
        bound: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
    },
});

export async function handlePodBindSubAgent(
    connectionId: string,
    payload: PodBindSubAgentPayload,
    requestId: string
): Promise<void> {
    return subAgentBindHandler(connectionId, payload, requestId);
}

const subAgentMoveToGroupHandler = createMoveToGroupHandler({
    service: subAgentService,
    resourceName: 'SubAgent',
    idField: 'itemId',
    groupType: GROUP_TYPES.SUBAGENT,
    events: {
        moved: WebSocketResponseEvents.SUBAGENT_MOVED_TO_GROUP,
    },
});

export async function handleSubAgentMoveToGroup(
    connectionId: string,
    payload: SubAgentMoveToGroupPayload,
    requestId: string
): Promise<void> {
    return subAgentMoveToGroupHandler(connectionId, payload, requestId);
}
