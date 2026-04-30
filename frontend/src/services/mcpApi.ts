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

// ─── MCP server list cache helpers ────────────────────────────────────────────

/** MCP server 清單快取 TTL（毫秒）；避免使用者頻繁開關 popover 反覆打 API */
const MCP_SERVER_LIST_CACHE_TTL_MS = 30 * 1000;

/**
 * MCP server 清單快取最大容量。
 * 目前最多 3 個 provider（claude / codex / gemini），保留餘裕設為 16。
 * 超過上限時刪除最舊的 entry（Map 迭代順序 = 插入順序）。
 */
const MCP_SERVER_LIST_CACHE_MAX_SIZE = 16;

/** McpListPayload 接受的已知 provider 字面量集合 */
const KNOWN_MCP_PROVIDERS = new Set(["claude", "codex", "gemini"]);

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

  // 只傳送已知 provider，避免將任意字串送往後端
  if (!KNOWN_MCP_PROVIDERS.has(provider)) {
    return [];
  }

  const result = await createWebSocketRequest<
    McpListPayload,
    McpListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.MCP_LIST,
    responseEvent: WebSocketResponseEvents.MCP_LIST_RESULT,
    payload: { provider: provider as "claude" | "codex" | "gemini" },
  });

  const data = result.items ?? [];

  // 超過容量上限時，刪除最舊的 entry（Map 迭代順序 = 插入順序）
  if (mcpServerListCache.size >= MCP_SERVER_LIST_CACHE_MAX_SIZE) {
    const oldestKey = mcpServerListCache.keys().next().value;
    if (oldestKey !== undefined) mcpServerListCache.delete(oldestKey);
  }

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

// ─── Pod MCP server names update ──────────────────────────────────────────────

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
 * 將後端回傳的 rawError（string / i18nError 物件 / 其他）解析為 McpServerNamesError。
 * - i18nError 格式（含 key）：reason = key，message = i18n 翻譯後字串
 * - 字串格式：reason = message = 原字串
 * - 其他：reason = "unknown"，message = 通用錯誤文案
 */
export function parseUpdateError(rawError: unknown): McpServerNamesError {
  if (rawError && typeof rawError === "object" && "key" in rawError) {
    const err = rawError as RawErrorObject;
    const translated = t(err.key, err.params ?? {});
    return {
      reason: err.key,
      message: translated === err.key ? t("common.error.unknown") : translated,
    };
  }
  if (typeof rawError === "string") {
    // 純字串不原樣傳遞，避免後端內部訊息洩漏到前端 toast
    return { reason: "unknown", message: t("common.error.unknown") };
  }
  return { reason: "unknown", message: t("common.error.unknown") };
}

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
        reject(parseUpdateError(raw.error));
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
