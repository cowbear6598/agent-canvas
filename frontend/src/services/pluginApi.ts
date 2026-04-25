import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type { PluginListPayload } from "@/types/websocket/requests";
import type { PluginListResultPayload } from "@/types/websocket/responses";
import type { InstalledPlugin } from "@/types/plugin";
import type { PodProvider } from "@/types/pod";

export async function listPlugins(
  provider: PodProvider,
): Promise<InstalledPlugin[]> {
  const result = await createWebSocketRequest<
    PluginListPayload,
    PluginListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_LIST,
    responseEvent: WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    payload: { provider: provider as "claude" | "codex" },
  });
  return result.plugins ?? [];
}
