import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type { PluginListPayload } from "@/types/websocket/requests";
import type { PluginListResultPayload } from "@/types/websocket/responses";
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
