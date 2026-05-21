import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  PluginListPayload,
  PluginInstallPayload,
  PluginDeletePayload,
  PluginUpdatePayload,
  PluginReorderPayload,
} from "@/types/websocket/requests";
import type {
  PluginListResultPayload,
  PluginInstalledPayload,
  PluginDeletedPayload,
  PluginUpdatedPayload,
  PluginReorderedPayload,
} from "@/types/websocket/responses";
import type { InstalledPlugin } from "@/types/plugin";

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const result = await createWebSocketRequest<
    PluginListPayload,
    PluginListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_LIST,
    responseEvent: WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    payload: {},
  });

  if (!result.plugins) {
    throw new Error("取得 plugin 清單成功但後端未回傳 plugin 清單");
  }

  return result.plugins;
}

export async function installPlugin(
  githubRepo: string,
): Promise<InstalledPlugin> {
  const result = await createWebSocketRequest<
    PluginInstallPayload,
    PluginInstalledPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_INSTALL,
    responseEvent: WebSocketResponseEvents.PLUGIN_INSTALLED,
    payload: { githubRepo },
  });

  if (!result.plugin) {
    throw new Error("安裝 plugin 成功但後端未回傳 plugin 資料");
  }

  return result.plugin;
}

export async function deletePlugin(
  pluginId: string,
): Promise<{ pluginId: string; plugins?: InstalledPlugin[] }> {
  const result = await createWebSocketRequest<
    PluginDeletePayload,
    PluginDeletedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_DELETE,
    responseEvent: WebSocketResponseEvents.PLUGIN_DELETED,
    payload: { pluginId },
  });

  return {
    pluginId: result.pluginId ?? pluginId,
    plugins: result.plugins,
  };
}

export async function updatePlugin(pluginId: string): Promise<InstalledPlugin> {
  const result = await createWebSocketRequest<
    PluginUpdatePayload,
    PluginUpdatedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_UPDATE,
    responseEvent: WebSocketResponseEvents.PLUGIN_UPDATED,
    payload: { pluginId },
  });

  if (!result.plugin) {
    throw new Error("更新 plugin 成功但後端未回傳 plugin 資料");
  }

  return result.plugin;
}

export async function reorderPlugins(
  idsInOrder: string[],
): Promise<InstalledPlugin[]> {
  const result = await createWebSocketRequest<
    PluginReorderPayload,
    PluginReorderedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_REORDER,
    responseEvent: WebSocketResponseEvents.PLUGIN_REORDERED,
    payload: { pluginIds: idsInOrder },
  });

  if (!result.plugins) {
    throw new Error("重排 plugin 成功但後端未回傳 plugin 清單");
  }

  return result.plugins;
}
