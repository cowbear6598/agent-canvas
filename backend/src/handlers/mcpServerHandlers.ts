import {WebSocketResponseEvents} from '../schemas';
import type {
    McpServerCreatePayload,
    McpServerUpdatePayload,
    McpServerReadPayload,
    PodUnbindMcpServerPayload,
} from '../schemas';
import {mcpServerStore} from '../services/mcpServerStore.js';
import {mcpServerNoteStore} from '../services/noteStores.js';
import type {McpServerConfig} from '../types/mcpServer.js';
import {podStore} from '../services/podStore.js';
import {emitNotFound, emitSuccess} from '../utils/websocketResponse.js';
import {createNoteHandlers} from './factories/createNoteHandlers.js';
import {createBindHandler} from './factories/createBindHandlers.js';
import {createDeleteHandler} from './factories/createResourceHandlers.js';
import {withCanvasId, validatePod, emitPodUpdated} from '../utils/handlerHelpers.js';
import {logger} from '../utils/logger.js';

export const mcpServerNoteHandlers = createNoteHandlers({
    noteStore: mcpServerNoteStore,
    events: {
        created: WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED,
        listResult: WebSocketResponseEvents.MCP_SERVER_NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.MCP_SERVER_NOTE_UPDATED,
        deleted: WebSocketResponseEvents.MCP_SERVER_NOTE_DELETED,
    },
    foreignKeyField: 'mcpServerId',
    entityName: 'McpServer',
});

export async function handleMcpServerList(
    connectionId: string,
    _payload: unknown,
    requestId: string
): Promise<void> {
    const servers = mcpServerStore.list();
    emitSuccess(connectionId, WebSocketResponseEvents.MCP_SERVER_LIST_RESULT, {
        requestId,
        success: true,
        mcpServers: servers,
    });
}

export async function handleMcpServerCreate(
    connectionId: string,
    payload: McpServerCreatePayload,
    requestId: string
): Promise<void> {
    const {name, config} = payload;
    const server = mcpServerStore.create(name, config as McpServerConfig);

    logger.log('McpServer', 'Create', `建立 MCP Server: ${server.id} (${server.name})`);

    emitSuccess(connectionId, WebSocketResponseEvents.MCP_SERVER_CREATED, {
        requestId,
        success: true,
        mcpServer: server,
    });
}

export async function handleMcpServerUpdate(
    connectionId: string,
    payload: McpServerUpdatePayload,
    requestId: string
): Promise<void> {
    const {mcpServerId, name, config} = payload;

    const existing = mcpServerStore.getById(mcpServerId);
    if (!existing) {
        emitNotFound(connectionId, WebSocketResponseEvents.MCP_SERVER_UPDATED, 'MCP Server', mcpServerId, requestId);
        return;
    }

    const updated = mcpServerStore.update(mcpServerId, name, config as McpServerConfig);

    logger.log('McpServer', 'Update', `更新 MCP Server: ${mcpServerId}`);

    emitSuccess(connectionId, WebSocketResponseEvents.MCP_SERVER_UPDATED, {
        requestId,
        success: true,
        mcpServer: {id: updated!.id, name: updated!.name},
    });
}

export async function handleMcpServerRead(
    connectionId: string,
    payload: McpServerReadPayload,
    requestId: string
): Promise<void> {
    const {mcpServerId} = payload;

    const server = mcpServerStore.getById(mcpServerId);
    if (!server) {
        emitNotFound(connectionId, WebSocketResponseEvents.MCP_SERVER_READ_RESULT, 'MCP Server', mcpServerId, requestId);
        return;
    }

    emitSuccess(connectionId, WebSocketResponseEvents.MCP_SERVER_READ_RESULT, {
        requestId,
        success: true,
        mcpServer: {id: server.id, name: server.name, config: server.config},
    });
}

export const handleMcpServerDelete = createDeleteHandler({
    service: {
        exists: (id) => mcpServerStore.exists(id),
        delete: (id) => { mcpServerStore.delete(id); return Promise.resolve(); },
    },
    resourceName: 'McpServer',
    idField: 'mcpServerId',
    deleteConfig: {
        deleted: WebSocketResponseEvents.MCP_SERVER_DELETED,
        findPodsUsing: (canvasId, mcpServerId) => podStore.findByMcpServerId(canvasId, mcpServerId),
        deleteNotes: (canvasId, mcpServerId) => mcpServerNoteStore.deleteByForeignKey(canvasId, mcpServerId),
        idFieldName: 'mcpServerId',
    },
});

const mcpServerBindHandler = createBindHandler({
    resourceName: 'McpServer',
    idField: 'mcpServerId',
    isMultiBind: true,
    service: mcpServerStore,
    podStoreMethod: {
        bind: (canvasId, podId, mcpServerId) => podStore.addMcpServerId(canvasId, podId, mcpServerId),
    },
    getPodResourceIds: (pod) => pod.mcpServerIds,
    skipRepositorySync: true,
    events: {
        bound: WebSocketResponseEvents.POD_MCP_SERVER_BOUND,
    },
});

export const handlePodBindMcpServer = mcpServerBindHandler;

export const handlePodUnbindMcpServer = withCanvasId<PodUnbindMcpServerPayload>(
    WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND,
    async (connectionId: string, canvasId: string, payload: PodUnbindMcpServerPayload, requestId: string): Promise<void> => {
        const {podId, mcpServerId} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND, requestId);
        if (!pod) {
            return;
        }

        if (!pod.mcpServerIds.includes(mcpServerId)) {
            emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND);
            return;
        }

        podStore.removeMcpServerId(canvasId, podId, mcpServerId);

        logger.log('McpServer', 'Unbind', `從 Pod ${podId} 解綁 MCP Server ${mcpServerId}`);

        emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND);
    }
);
