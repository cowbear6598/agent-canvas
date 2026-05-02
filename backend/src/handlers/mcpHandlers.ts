import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  McpListRequest,
  PodSetMcpServerNamesPayload,
} from "../schemas/mcpSchemas.js";
import { readClaudeMcpServers } from "../services/mcp/claudeMcpReader.js";
import { readCodexMcpServers } from "../services/mcp/codexMcpReader.js";
import { readGeminiMcpServers } from "../services/mcp/geminiMcpReader.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import { isPodBusy } from "../types/index.js";
import { createI18nError } from "../utils/i18nError.js";
import { emitError } from "../utils/websocketResponse.js";
import { getCanvasId } from "../utils/handlerHelpers.js";
import { logger } from "../utils/logger.js";
import type { ProviderName } from "../services/provider/index.js";

/**
 * 依 provider 分派到對應的 reader，回傳可用的 MCP server 清單。
 * - claude → readClaudeMcpServers（僅 user-scoped，name 欄位，無 type）
 * - gemini → readGeminiMcpServers（回傳 { name, type }）
 * - codex  → readCodexMcpServers（回傳 { name, type }）
 */
function resolveAvailableMcpServers(
  provider: ProviderName,
): Array<{ name: string; type?: "stdio" | "http" | "sse" }> {
  if (provider === "claude") {
    const servers = readClaudeMcpServers();
    return servers.map(({ name }) => ({ name }));
  } else if (provider === "gemini") {
    return readGeminiMcpServers();
  } else {
    const servers = readCodexMcpServers();
    return servers.map(({ name, type }) => ({ name, type }));
  }
}

/**
 * handleMcpList：依 provider 分派到對應的 reader，回傳 MCP_LIST_RESULT。
 * - provider = "claude" → readClaudeMcpServers（僅 user-scoped，從 top-level mcpServers 讀取）
 * - provider = "codex"  → readCodexMcpServers（回傳 { name, type }[]）
 * - provider = "gemini" → readGeminiMcpServers（讀取 ~/.gemini/settings.json root.mcpServers）
 * 統一對應 mcpListItemSchema 格式後回傳。
 */
export async function handleMcpList(
  connectionId: string,
  payload: McpListRequest,
  requestId: string,
): Promise<void> {
  const { provider } = payload;

  const items = resolveAvailableMcpServers(provider);

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.MCP_LIST_RESULT,
    {
      requestId,
      success: true,
      provider,
      items,
    },
  );
}

/**
 * handlePodSetMcpServerNames：設定指定 pod 的 MCP server 名稱清單。
 * - pod 不存在 → i18nError
 * - pod busy → 拒絕並 i18nError
 * - self-healing：過濾掉 ~/.claude.json 不存在的 name
 * - 寫入並廣播 POD_MCP_SERVER_NAMES_UPDATED
 */
export async function handlePodSetMcpServerNames(
  connectionId: string,
  payload: PodSetMcpServerNamesPayload,
  requestId: string,
): Promise<void> {
  const { podId, mcpServerNames } = payload;

  // 取得 canvasId（未設定 active canvas 時 getCanvasId 已自動回傳 error）
  const canvasId = getCanvasId(
    connectionId,
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    requestId,
  );
  if (!canvasId) return;

  // 驗證 pod 是否存在
  const pod = podStore.getById(canvasId, podId);
  if (!pod) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      createI18nError("errors.notFound", { entity: "Pod", id: podId }),
      canvasId,
      requestId,
      podId,
      "NOT_FOUND",
    );
    return;
  }

  // pod busy 時拒絕變更
  if (isPodBusy(pod.status)) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      createI18nError("errors.podBusy", { id: podId }),
      canvasId,
      requestId,
      podId,
      "POD_BUSY",
    );
    return;
  }

  // self-healing：依 provider 讀取對應的可用 MCP server 清單，
  // 過濾掉已不存在的 name（例如使用者在外部刪除了 settings.json 中的 server）
  // Codex popover 為唯讀，理論上不會觸發此事件；
  // 仍統一走 resolveAvailableMcpServers 過濾，避免異常呼叫時繞過驗證
  const availableServers = resolveAvailableMcpServers(pod.provider);
  const availableNameSet = new Set(availableServers.map((s) => s.name));

  const invalidNames = mcpServerNames.filter((n) => !availableNameSet.has(n));
  if (invalidNames.length > 0) {
    logger.warn(
      "Pod",
      "Warn",
      `handlePodSetMcpServerNames：略過不存在的 MCP server name（已遮罩，共 ${invalidNames.length} 筆）`,
    );
  }
  const validNames = mcpServerNames.filter((n) => availableNameSet.has(n));

  // 寫入 podStore
  podStore.setMcpServerNames(podId, validNames);

  // 廣播 POD_MCP_SERVER_NAMES_UPDATED 給 canvas 所有連線
  // ignoredNames：被過濾掉的 name 清單，前端可據此提示使用者
  socketService.emitToCanvas(
    canvasId,
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    {
      requestId,
      canvasId,
      podId,
      success: true,
      mcpServerNames: validNames,
      ignoredNames: invalidNames,
    },
  );
}
