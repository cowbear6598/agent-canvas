/**
 * providerListBroadcaster
 *
 * 廣播 opencode:aliases:updated 與 provider:list:result 給所有連線。
 * P4.B handler 的 mutate 操作（create / update / delete / reorder）完成後呼叫此模組的函式。
 */

import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { getStmts } from "../../database/index.js";
import { buildProviderListPayload } from "../../handlers/providerHandlers.js";
import type { AliasItem } from "../../schemas/opencodeSettingsSchemas.js";
import { parseOpencodeThinkingLevelsJson } from "./opencodeThinkingPresetService.js";

/** DB row 形狀（model_aliases 表） */
interface ModelAliasRow {
  id: string;
  provider_id: string;
  real_provider: string;
  real_model: string;
  alias: string;
  order_idx: number;
  thinking_levels_json: string | null;
  default_thinking_level: string | null;
  thinking_metadata_fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * broadcastOpencodeAliasesUpdated：推送 opencode:aliases:updated push 事件給所有連線。
 * payload 內含當前 provider_id="opencode" 的完整 alias 列表（依 order_idx 升序）。
 */
export async function broadcastOpencodeAliasesUpdated(): Promise<void> {
  const stmts = getStmts();
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];

  const items: AliasItem[] = rows.map((r) => {
    const levels = parseOpencodeThinkingLevelsJson(r.thinking_levels_json);
    const labels = Object.fromEntries(
      levels.map((level) => [level.id, level.label]),
    );
    return {
      id: r.id,
      providerID: r.real_provider,
      modelID: r.real_model,
      alias: r.alias,
      orderIdx: r.order_idx,
      thinkingLevels: levels.map((level) => level.id),
      ...(levels.length > 0 ? { thinkingLevelLabels: labels } : {}),
      defaultThinkingLevel: r.default_thinking_level,
      thinkingMetadataFetchedAt: r.thinking_metadata_fetched_at,
    };
  });

  socketService.emitToAll(WebSocketResponseEvents.OPENCODE_ALIASES_UPDATED, {
    items,
  });
}

/**
 * broadcastProviderList：重新組整份 provider:list payload，
 * 並透過 WebSocket 廣播 provider:list:result 給所有連線。
 *
 * 呼叫 buildProviderListPayload() 確保 opencode 的 availableModels 反映 DB 最新狀態。
 */
export async function broadcastProviderList(): Promise<void> {
  const providers = buildProviderListPayload();

  socketService.emitToAll(WebSocketResponseEvents.PROVIDER_LIST_RESULT, {
    requestId: "",
    success: true,
    providers,
  });
}
