import type { WebSocketResponseEvents } from '../../schemas';
import type { Pod } from '../../types/index.js';
import { socketService } from '../../services/socketService.js';
import { emitError, emitNotFound } from '../../utils/websocketResponse.js';
import { createI18nError } from '../../utils/i18nError.js';
import { logger, type LogCategory } from '../../utils/logger.js';
import { handleResourceDelete } from '../../utils/handlerHelpers.js';

interface ResourceService<T = { id: string; name: string }> {
  list(): Promise<T[]>;
  exists(id: string): Promise<boolean>;
  create(name: string, content: string): Promise<T>;
  update(id: string, content: string): Promise<T>;
  getContent(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
}

export type DeleteResourcePayload<TIdField extends string = string> = Record<TIdField, string>;

interface DeleteHandlerConfig {
  deleted: WebSocketResponseEvents;
  findPodsUsing: (canvasId: string, resourceId: string) => Pod[];
  deleteNotes: (canvasId: string, resourceId: string) => string[];
  idFieldName?: string;
}

interface ResourceHandlerConfig<T = { id: string; name: string }, TIdField extends string = string> {
  service: ResourceService<T>;
  events: {
    listResult: WebSocketResponseEvents;
    created: WebSocketResponseEvents;
    updated: WebSocketResponseEvents;
    readResult: WebSocketResponseEvents;
    deleted?: DeleteHandlerConfig;
  };
  resourceName: LogCategory;
  responseKey: string;
  listResponseKey: string;
  idField: TIdField;
}

export interface CreateResourcePayload {
  name: string;
  content: string;
}

export type UpdateResourcePayload<TIdField extends string = string> = Record<TIdField, string> & {
  content: string;
};

export type ReadResourcePayload<TIdField extends string = string> = Record<TIdField, string>;

interface BaseResponse {
  requestId: string;
  success: true;
}

type DynamicResponse = BaseResponse & { [key: string]: unknown };

export function createListHandler<T>(config: {
  service: { list(): Promise<T[]> };
  event: WebSocketResponseEvents;
  responseKey: string;
}): (connectionId: string, payload: unknown, requestId: string) => Promise<void> {
  return async function (connectionId: string, _payload: unknown, requestId: string): Promise<void> {
    const items = await config.service.list();

    const response: DynamicResponse = {
      requestId,
      success: true,
      [config.responseKey]: items,
    };

    socketService.emitToConnection(connectionId, config.event, response);
  };
}

export function createDeleteHandler<TIdField extends string>(config: {
  service: { exists(id: string): Promise<boolean>; delete(id: string): Promise<void> };
  resourceName: LogCategory;
  idField: TIdField;
  deleteConfig: DeleteHandlerConfig;
}): (connectionId: string, payload: DeleteResourcePayload<TIdField>, requestId: string) => Promise<void> {
  return async function (connectionId: string, payload: DeleteResourcePayload<TIdField>, requestId: string): Promise<void> {
    const resourceId = payload[config.idField];
    const deleteConfig = config.deleteConfig;

    await handleResourceDelete({
      connectionId,
      requestId,
      resourceId,
      resourceName: config.resourceName,
      responseEvent: deleteConfig.deleted,
      existsCheck: () => config.service.exists(resourceId),
      findPodsUsing: (canvasId: string) => deleteConfig.findPodsUsing(canvasId, resourceId),
      deleteNotes: (canvasId: string) => deleteConfig.deleteNotes(canvasId, resourceId),
      deleteResource: () => config.service.delete(resourceId),
      idFieldName: deleteConfig.idFieldName,
    });
  };
}

export function createResourceHandlers<T extends { id: string; name: string }, TIdField extends string>(
  config: ResourceHandlerConfig<T, TIdField>
): {
  handleList: (connectionId: string, payload: unknown, requestId: string) => Promise<void>;
  handleCreate: (connectionId: string, payload: CreateResourcePayload, requestId: string) => Promise<void>;
  handleUpdate: (connectionId: string, payload: UpdateResourcePayload<TIdField>, requestId: string) => Promise<void>;
  handleRead: (connectionId: string, payload: ReadResourcePayload<TIdField>, requestId: string) => Promise<void>;
  handleDelete: (connectionId: string, payload: DeleteResourcePayload<TIdField>, requestId: string) => Promise<void>;
} {
  const { service, events, resourceName, responseKey, listResponseKey, idField } = config;

  const handleList = createListHandler({
    service,
    event: events.listResult,
    responseKey: listResponseKey,
  });

  async function handleCreate(
    connectionId: string,
    payload: CreateResourcePayload,
    requestId: string
  ): Promise<void> {
    const { name, content } = payload;

    const exists = await service.exists(name);
    if (exists) {
      emitError(
        connectionId,
        events.created,
        createI18nError('errors.resourceExists', { resource: resourceName, name }),
        requestId,
        undefined,
        'ALREADY_EXISTS'
      );
      return;
    }

    const resource = await service.create(name, content);

    const response: DynamicResponse = {
      requestId,
      success: true,
      [responseKey]: resource,
    };

    socketService.emitToConnection(connectionId, events.created, response);

    logger.log(resourceName, 'Create', `已建立${resourceName.toLowerCase()}「${resource.name}」`);
  }

  async function handleUpdate(
    connectionId: string,
    payload: UpdateResourcePayload<TIdField>,
    requestId: string
  ): Promise<void> {
    const resourceId = payload[idField];
    const { content } = payload;

    const exists = await service.exists(resourceId);
    if (!exists) {
      emitNotFound(connectionId, events.updated, resourceName, resourceId, requestId);
      return;
    }

    const resource = await service.update(resourceId, content);

    const response: DynamicResponse = {
      requestId,
      success: true,
      [responseKey]: {
        id: resource.id,
        name: resource.name,
      },
    };

    socketService.emitToConnection(connectionId, events.updated, response);

    logger.log(resourceName, 'Update', `已更新${resourceName.toLowerCase()}「${resource.name}」`);
  }

  async function handleRead(
    connectionId: string,
    payload: ReadResourcePayload<TIdField>,
    requestId: string
  ): Promise<void> {
    const resourceId = payload[idField];

    const content = await service.getContent(resourceId);
    if (content === null) {
      emitNotFound(connectionId, events.readResult, resourceName, resourceId, requestId);
      return;
    }

    const response: DynamicResponse = {
      requestId,
      success: true,
      [responseKey]: {
        id: resourceId,
        name: resourceId,
        content,
      },
    };

    socketService.emitToConnection(connectionId, events.readResult, response);
  }

  async function handleDelete(
    connectionId: string,
    payload: DeleteResourcePayload<TIdField>,
    requestId: string
  ): Promise<void> {
    if (!events.deleted) {
      return;
    }

    const handler = createDeleteHandler({
      service,
      resourceName,
      idField,
      deleteConfig: events.deleted,
    });

    await handler(connectionId, payload, requestId);
  }

  return {
    handleList,
    handleCreate,
    handleUpdate,
    handleRead,
    handleDelete,
  };
}
