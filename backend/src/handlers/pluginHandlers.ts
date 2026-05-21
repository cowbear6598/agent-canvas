import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  PluginListPayload,
  PluginInstallPayload,
  PluginDeletePayload,
  PluginUpdatePayload,
  PluginReorderPayload,
} from "../schemas/pluginSchemas.js";
import { socketService } from "../services/socketService.js";
import {
  refreshAllPlugins,
  installPlugin,
  removePlugin,
  updatePlugin,
} from "../services/plugin/pluginInstallService.js";
import { managedPluginStore } from "../services/plugin/managedPluginRegistry.js";
import { createI18nError, type I18nError } from "../utils/i18nError.js";
import { emitError, emitNotFound } from "../utils/websocketResponse.js";

type PluginErrorPayload = {
  error: I18nError;
  code: string;
};

function getPluginErrorMessage(error: string | I18nError): string {
  return typeof error === "string" ? error : error.key;
}

function createPluginInstallError(
  error: string,
  githubRepo: string,
): PluginErrorPayload {
  if (error === "INVALID_GITHUB_REPO_FORMAT") {
    return {
      error: createI18nError("errors.pluginInvalidGithubRepoFormat", {
        repo: githubRepo,
      }),
      code: "INVALID_GITHUB_REPO_FORMAT",
    };
  }

  if (error === "PLUGIN_ALREADY_INSTALLED") {
    return {
      error: createI18nError("errors.pluginAlreadyInstalled", {
        repo: githubRepo,
      }),
      code: "PLUGIN_ALREADY_INSTALLED",
    };
  }

  return {
    error: createI18nError("errors.pluginInstallFailed", {
      repo: githubRepo,
      reason: error,
    }),
    code: "PLUGIN_INSTALL_FAILED",
  };
}

function createPluginUpdateError(
  error: string,
  pluginId: string,
): PluginErrorPayload {
  if (error === "INVALID_GITHUB_REPO_FORMAT") {
    return {
      error: createI18nError("errors.pluginStoredRepoInvalid", {
        pluginId,
      }),
      code: "INVALID_GITHUB_REPO_FORMAT",
    };
  }

  return {
    error: createI18nError("errors.pluginUpdateFailed", {
      pluginId,
      reason: error,
    }),
    code: "PLUGIN_UPDATE_FAILED",
  };
}

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
    const errorMessage = getPluginErrorMessage(result.error);
    const errorPayload = createPluginInstallError(
      errorMessage,
      payload.githubRepo,
    );
    emitError(
      connectionId,
      WebSocketResponseEvents.PLUGIN_INSTALLED,
      errorPayload.error,
      null,
      requestId,
      undefined,
      errorPayload.code,
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
}

export async function handlePluginDelete(
  connectionId: string,
  payload: PluginDeletePayload,
  requestId: string,
): Promise<void> {
  const result = await removePlugin(payload.pluginId);

  if (!result.success) {
    const errorMessage = getPluginErrorMessage(result.error);
    if (errorMessage === "PLUGIN_NOT_FOUND") {
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

  const response = {
    requestId,
    success: true,
    pluginId: payload.pluginId,
    plugins: managedPluginStore.list(),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_DELETED,
    response,
  );
}

export async function handlePluginUpdate(
  connectionId: string,
  payload: PluginUpdatePayload,
  requestId: string,
): Promise<void> {
  const result = await updatePlugin(payload.pluginId);

  if (!result.success) {
    const errorMessage = getPluginErrorMessage(result.error);
    if (errorMessage === "PLUGIN_NOT_FOUND") {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.PLUGIN_UPDATED,
        "plugin",
        payload.pluginId,
        requestId,
        null,
      );
    } else {
      const errorPayload = createPluginUpdateError(
        errorMessage,
        payload.pluginId,
      );
      emitError(
        connectionId,
        WebSocketResponseEvents.PLUGIN_UPDATED,
        errorPayload.error,
        null,
        requestId,
        undefined,
        errorPayload.code,
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
}

export async function handlePluginReorder(
  connectionId: string,
  payload: PluginReorderPayload,
  requestId: string,
): Promise<void> {
  const result = managedPluginStore.reorder(payload.pluginIds);

  if (!result.success) {
    if (result.error === "PLUGIN_NOT_FOUND") {
      emitNotFound(
        connectionId,
        WebSocketResponseEvents.PLUGIN_REORDERED,
        "plugin",
        payload.pluginIds.join(","),
        requestId,
        null,
      );
    } else {
      emitError(
        connectionId,
        WebSocketResponseEvents.PLUGIN_REORDERED,
        result.error,
        null,
        requestId,
        undefined,
        "INVALID_PLUGIN_REORDER",
      );
    }
    return;
  }

  const response = {
    requestId,
    success: true,
    plugins: result.data,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_REORDERED,
    response,
  );
}
