import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import { generateRequestId } from "@/services/utils";
import { websocketClient } from "@/services/websocket/WebSocketClient";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import { t } from "@/i18n";
import type {
  McpListPayload,
  PodSetMcpServerNamesPayload,
} from "@/types/websocket/requests";
import type {
  McpListResultPayload,
  PodMcpServerNamesUpdatedPayload,
} from "@/types/websocket/responses";
import type { McpListItem } from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

/** MCP server 清單快取 TTL（毫秒）；避免使用者頻繁開關 popover 反覆打 API */
const MCP_SERVER_LIST_CACHE_TTL_MS = 30 * 1000;

interface McpServerListCacheEntry {
  data: McpListItem[];
  expiresAt: number;
}

const mcpServerListCache = new Map<string, McpServerListCacheEntry>();

/** 查詢指定 Provider 的 MCP server 清單（30 秒 TTL 快取） */
export async function listMcpServers(
  provider: PodProvider,
): Promise<McpListItem[]> {
  const cached = mcpServerListCache.get(provider);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const result = await createWebSocketRequest<
    McpListPayload,
    McpListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.MCP_LIST,
    responseEvent: WebSocketResponseEvents.MCP_LIST_RESULT,
    payload: { provider: provider as "claude" | "codex" },
  });

  const data = result.items ?? [];
  mcpServerListCache.set(provider, {
    data,
    expiresAt: Date.now() + MCP_SERVER_LIST_CACHE_TTL_MS,
  });

  return data;
}

/**
 * 讓指定 provider（或全部）的 MCP server 清單快取失效。
 * 供「使用者主動刷新」等情境呼叫。
 */
export function invalidateMcpServersCache(provider?: PodProvider): void {
  if (provider) {
    mcpServerListCache.delete(provider);
  } else {
    mcpServerListCache.clear();
  }
}

/** 後端錯誤物件（i18n key 格式） */
interface RawErrorObject {
  key: string;
  params?: Record<string, unknown>;
}

/** 含 reason 欄位的錯誤物件，供呼叫端依 i18nError key 決定 toast 文案 */
export interface McpServerNamesError {
  reason: string;
  message: string;
}

/** WebSocket 原始回應（success=false 時使用） */
interface RawUpdateResponse {
  requestId?: string;
  success?: boolean;
  error?: string | RawErrorObject;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 設定指定 Pod 的 MCP server 名稱清單。
 * 失敗時 throw McpServerNamesError，reason 為後端 i18nError 的 key 字串。
 */
export async function updatePodMcpServers(
  canvasId: string,
  podId: string,
  mcpServerNames: string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!websocketClient.isConnected.value) {
      reject(new Error(t("websocket.notConnected")));
      return;
    }

    const requestId = generateRequestId();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleResponse = (
      response: PodMcpServerNamesUpdatedPayload,
    ): void => {
      const raw = response as unknown as RawUpdateResponse;
      if (raw.requestId !== requestId) return;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      websocketClient.off(
        WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
        handleResponse,
      );

      if (raw.success === false) {
        const rawError = raw.error;
        let reason: string;
        let message: string;

        if (rawError && typeof rawError === "object" && "key" in rawError) {
          // 後端回傳 i18nError 格式，保留 key 作為 reason 供呼叫端判斷
          reason = rawError.key;
          const translated = t(rawError.key, rawError.params ?? {});
          message =
            translated === rawError.key
              ? t("common.error.unknown")
              : translated;
        } else if (typeof rawError === "string") {
          reason = rawError;
          message = rawError;
        } else {
          reason = "unknown";
          message = t("common.error.unknown");
        }

        const err: McpServerNamesError = { reason, message };
        reject(err);
        return;
      }

      resolve();
    };

    websocketClient.on(
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      handleResponse,
    );

    websocketClient.emit(WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES, {
      canvasId,
      podId,
      mcpServerNames,
      requestId,
    } as PodSetMcpServerNamesPayload);

    timeoutId = setTimeout(() => {
      websocketClient.off(
        WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
        handleResponse,
      );
      reject(
        new Error(
          t("websocket.requestTimeout", {
            event: WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES,
          }),
        ),
      );
    }, DEFAULT_TIMEOUT_MS);
  });
}
