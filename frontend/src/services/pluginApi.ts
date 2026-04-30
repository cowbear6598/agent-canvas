import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type { PluginListPayload } from "@/types/websocket/requests";
import type { PluginListResultPayload } from "@/types/websocket/responses";
import type { InstalledPlugin } from "@/types/plugin";
import type { PodProvider } from "@/types/pod";

/** Plugin 清單快取 TTL（毫秒）；避免使用者頻繁開關 popover 反覆打 API */
const PLUGIN_LIST_CACHE_TTL_MS = 30 * 1000;

/** PluginListPayload 接受的已知 provider 字面量集合 */
const KNOWN_PLUGIN_PROVIDERS = new Set(["claude", "codex", "gemini"]);

interface PluginListCacheEntry {
  data: InstalledPlugin[];
  expiresAt: number;
}

const pluginListCache = new Map<string, PluginListCacheEntry>();

export async function listPlugins(
  provider: PodProvider,
): Promise<InstalledPlugin[]> {
  const cached = pluginListCache.get(provider);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 只傳送已知 provider，避免將任意字串送往後端
  const knownProvider = KNOWN_PLUGIN_PROVIDERS.has(provider)
    ? (provider as "claude" | "codex" | "gemini")
    : undefined;

  const result = await createWebSocketRequest<
    PluginListPayload,
    PluginListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.PLUGIN_LIST,
    responseEvent: WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    payload: { provider: knownProvider },
  });

  const data = result.plugins ?? [];
  pluginListCache.set(provider, {
    data,
    expiresAt: Date.now() + PLUGIN_LIST_CACHE_TTL_MS,
  });

  return data;
}

/**
 * 讓指定 provider（或全部）的 plugin 清單快取失效。
 * 供「使用者主動刷新」等情境呼叫。
 */
export function invalidatePluginListCache(provider?: PodProvider): void {
  if (provider) {
    pluginListCache.delete(provider);
  } else {
    pluginListCache.clear();
  }
}
