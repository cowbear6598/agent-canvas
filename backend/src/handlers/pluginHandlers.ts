import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  PluginListPayload,
  PluginInstallPayload,
  PluginDeletePayload,
  PluginUpdatePayload,
} from "../schemas/pluginSchemas.js";
import { socketService } from "../services/socketService.js";
import {
  refreshAllPlugins,
  installPlugin,
  removePlugin,
  updatePlugin,
} from "../services/plugin/pluginInstallService.js";
import { emitError, emitNotFound } from "../utils/websocketResponse.js";

export async function handlePluginList(
  connectionId: string,
  _payload: PluginListPayload,
  requestId: string,
): Promise<void> {
  const result = await refreshAllPlugins();

  if (!result.success) {
    emitError(
      connectionId,
      WebSocketResponseEvents.PLUGIN_LIST_RESULT,
      result.error,
      null,
      requestId,
    );
    return;
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    {
      requestId,
      success: true,
      plugins: result.data,
    },
  );
}

export async function handlePluginInstall(
  connectionId: string,
  payload: PluginInstallPayload,
  requestId: string,
): Promise<void> {
  const result = await installPlugin(payload.githubRepo);

  if (!result.success) {
    emitError(
      connectionId,
      WebSocketResponseEvents.PLUGIN_INSTALLED,
      result.error,
      null,
      requestId,
      undefined,
      result.error === "PLUGIN_ALREADY_INSTALLED"
        ? "PLUGIN_ALREADY_INSTALLED"
        : "INTERNAL_ERROR",
    );
    return;
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_INSTALLED,
    {
      requestId,
      success: true,
      plugin: result.data,
    },
  );

  socketService.emitToAll(WebSocketResponseEvents.PLUGIN_INSTALLED, {
    requestId,
    success: true,
    plugin: result.data,
  });
}

export async function handlePluginDelete(
  connectionId: string,
  payload: PluginDeletePayload,
  requestId: string,
): Promise<void> {
  const result = await removePlugin(payload.pluginId);

  if (!result.success) {
    if (result.error === "PLUGIN_NOT_FOUND") {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.PLUGIN_DELETED,
        "plugin",
        payload.pluginId,
        requestId,
        null,
      );
    } else {
      emitError(
        connectionId,
        WebSocketResponseEvents.PLUGIN_DELETED,
        result.error,
        null,
        requestId,
      );
    }
    return;
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_DELETED,
    {
      requestId,
      success: true,
      pluginId: payload.pluginId,
    },
  );

  socketService.emitToAll(WebSocketResponseEvents.PLUGIN_DELETED, {
    requestId,
    success: true,
    pluginId: payload.pluginId,
  });
}

export async function handlePluginUpdate(
  connectionId: string,
  payload: PluginUpdatePayload,
  requestId: string,
): Promise<void> {
  const result = await updatePlugin(payload.pluginId);

  if (!result.success) {
    if (result.error === "PLUGIN_NOT_FOUND") {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.PLUGIN_UPDATED,
        "plugin",
        payload.pluginId,
        requestId,
        null,
      );
    } else {
      emitError(
        connectionId,
        WebSocketResponseEvents.PLUGIN_UPDATED,
        result.error,
        null,
        requestId,
      );
    }
    return;
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_UPDATED,
    {
      requestId,
      success: true,
      plugin: result.data,
    },
  );

  socketService.emitToAll(WebSocketResponseEvents.PLUGIN_UPDATED, {
    requestId,
    success: true,
    plugin: result.data,
  });
}
