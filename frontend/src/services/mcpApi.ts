import { generateRequestId } from "@/services/utils";
import { websocketClient } from "@/services/websocket/WebSocketClient";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import { t } from "@/i18n";
import type { PodSetMcpServerNamesPayload } from "@/types/websocket/requests";
import type { PodMcpServerNamesUpdatedPayload } from "@/types/websocket/responses";
import { invalidatePodMcpAvailabilityCache } from "@/services/managedMcpApi";

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
  agentCanvasMcpEnabled?: boolean,
  codexMcpServerKeys?: string[],
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

      invalidatePodMcpAvailabilityCache(undefined, podId);
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
      ...(codexMcpServerKeys !== undefined && { codexMcpServerKeys }),
      ...(agentCanvasMcpEnabled !== undefined && { agentCanvasMcpEnabled }),
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
