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
} from "@/types/websocket/requests";
import type {
  PluginListResultPayload,
  PluginInstalledPayload,
  PluginDeletedPayload,
  PluginUpdatedPayload,
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

  return result.plugins ?? [];
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

export async function deletePlugin(pluginId: string): Promise<string> {
  const result = await createWebSocketRequest<
    PluginDeletePayload,
    PluginDeletedPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_DELETE,
    responseEvent: WebSocketResponseEvents.PLUGIN_DELETED,
    payload: { pluginId },
  });

  return result.pluginId ?? pluginId;
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
