import { randomUUID } from "crypto";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  OpencodeProviderListPayload,
  OpencodeProviderListResultPayload,
  OpencodeAliasesListPayload,
  OpencodeAliasesListResultPayload,
  OpencodeAliasesCreatePayload,
  OpencodeAliasesCreateResultPayload,
  OpencodeAliasesUpdatePayload,
  OpencodeAliasesUpdateResultPayload,
  OpencodeAliasesDeletePayload,
  OpencodeAliasesDeleteResultPayload,
  OpencodeAliasesReorderPayload,
  OpencodeAliasesReorderResultPayload,
  AliasItem,
} from "../schemas/opencodeSettingsSchemas.js";
import { getOpencodeServerState } from "../services/provider/opencodeServer.js";
import { socketService } from "../services/socketService.js";
import { getStmts, getDb } from "../database/index.js";
import {
  broadcastOpencodeAliasesUpdated,
  broadcastProviderList,
} from "../services/provider/providerListBroadcaster.js";

/**
 * handleOpencodeProviderList：轉發 opencode GET /provider，
 * 取得所有 provider 清單（all、default、connected）後回傳給前端。
 *
 * - opencode server 尚未 ready → 回傳 ok=false / opencode_server_not_ready
 * - ready → 呼叫 client.provider.list()，將 all / default / connected 原樣回傳
 */
export async function handleOpencodeProviderList(
  connectionId: string,
  payload: OpencodeProviderListPayload,
  requestId: string,
): Promise<void> {
  const serverState = getOpencodeServerState();

  // opencode server 尚未啟動或啟動失敗時，立即回報錯誤
  if (serverState.status !== "ready" || !serverState.baseUrl) {
    const response: OpencodeProviderListResultPayload = {
      requestId,
      ok: false,
      error: {
        code: "opencode_server_not_ready",
        message: "opencode server 尚未啟動，請稍候或重啟後端",
      },
    };

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
      response,
    );
    return;
  }

  const client = createOpencodeClient({ baseUrl: serverState.baseUrl });
  const result = await client.provider.list();

  const data = result.data as
    | {
        all: unknown[];
        default: Record<string, string>;
        connected: string[];
      }
    | null
    | undefined;

  const response: OpencodeProviderListResultPayload = {
    requestId,
    ok: true,
    all: data?.all ?? [],
    default: data?.default ?? {},
    connected: data?.connected ?? [],
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
    response,
  );
}

// ─── 輔助函式：將 DB row 轉換為 AliasItem ─────────────────────────────────────

interface ModelAliasRow {
  id: string;
  provider_id: string;
  real_provider: string;
  real_model: string;
  alias: string;
  order_idx: number;
  created_at: number;
  updated_at: number;
}

function rowToAliasItem(row: ModelAliasRow): AliasItem {
  return {
    id: row.id,
    providerID: row.real_provider,
    modelID: row.real_model,
    alias: row.alias,
    orderIdx: row.order_idx,
  };
}

// ─── handleOpencodeAliasesList ────────────────────────────────────────────────

/**
 * handleOpencodeAliasesList：列出 provider_id="opencode" 的所有 alias，
 * 依 order_idx 升序回傳。
 */
export async function handleOpencodeAliasesList(
  connectionId: string,
  payload: OpencodeAliasesListPayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];

  const response: OpencodeAliasesListResultPayload = {
    requestId,
    ok: true,
    items: rows.map(rowToAliasItem),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT,
    response,
  );
}

// ─── handleOpencodeAliasesCreate ─────────────────────────────────────────────

/**
 * handleOpencodeAliasesCreate：新增一筆 alias。
 * - 自動產 uuid 為 id
 * - 查詢同 provider_id 內 max(order_idx) + 1 作為新 order_idx（首筆為 0）
 * - 完成後廣播 opencode:aliases:updated 與 provider:list:result
 */
export async function handleOpencodeAliasesCreate(
  connectionId: string,
  payload: OpencodeAliasesCreatePayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const id = randomUUID();
  const now = Date.now();

  // 查詢目前 max order_idx（無資料時為 -1，所以首筆為 0）
  const maxResult = stmts.modelAlias.selectMaxOrderIdxByProviderId.get({
    $providerId: "opencode",
  }) as { max_order_idx: number };
  const orderIdx = maxResult.max_order_idx + 1;

  stmts.modelAlias.insert.run({
    $id: id,
    $providerId: "opencode",
    $realProvider: payload.providerID,
    $realModel: payload.modelID,
    $alias: payload.alias,
    $orderIdx: orderIdx,
    $createdAt: now,
    $updatedAt: now,
  });

  // 查詢剛寫入的 row 以確保回傳的資料與 DB 一致
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];
  const newRow = rows.find((r) => r.id === id);

  const item = newRow
    ? rowToAliasItem(newRow)
    : {
        id,
        providerID: payload.providerID,
        modelID: payload.modelID,
        alias: payload.alias,
        orderIdx,
      };

  const response: OpencodeAliasesCreateResultPayload = {
    requestId,
    ok: true,
    item,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
    response,
  );

  // 廣播通知所有連線 alias 已更新
  await broadcastOpencodeAliasesUpdated();
  await broadcastProviderList();
}

// ─── handleOpencodeAliasesUpdate ─────────────────────────────────────────────

/**
 * handleOpencodeAliasesUpdate：更新指定 alias 的 alias 名稱與 real_model。
 * order_idx 由獨立的 reorder API 處理，本函式不會修改順序。
 * 完成後廣播。
 */
export async function handleOpencodeAliasesUpdate(
  connectionId: string,
  payload: OpencodeAliasesUpdatePayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const now = Date.now();

  stmts.modelAlias.updateAliasAndModelId.run({
    $id: payload.id,
    $alias: payload.alias,
    $realModel: payload.modelID,
    $updatedAt: now,
  });

  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];
  const updatedRow = rows.find((r) => r.id === payload.id);

  if (!updatedRow) {
    const response: OpencodeAliasesUpdateResultPayload = {
      requestId,
      ok: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法更新",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
      response,
    );
    return;
  }

  const response: OpencodeAliasesUpdateResultPayload = {
    requestId,
    ok: true,
    item: rowToAliasItem(updatedRow),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
    response,
  );

  await broadcastOpencodeAliasesUpdated();
  await broadcastProviderList();
}

// ─── handleOpencodeAliasesDelete ─────────────────────────────────────────────

/**
 * handleOpencodeAliasesDelete：刪除指定 alias。
 * 完成後廣播。
 */
export async function handleOpencodeAliasesDelete(
  connectionId: string,
  payload: OpencodeAliasesDeletePayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();

  stmts.modelAlias.deleteById.run(payload.id);

  const response: OpencodeAliasesDeleteResultPayload = {
    requestId,
    ok: true,
    id: payload.id,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
    response,
  );

  await broadcastOpencodeAliasesUpdated();
  await broadcastProviderList();
}

// ─── handleOpencodeAliasesReorder ────────────────────────────────────────────

/**
 * handleOpencodeAliasesReorder：依陣列順序批次更新每個 id 的 order_idx。
 * 先查出現有 alias 名稱，再在單一 DB transaction 內更新所有 order_idx。
 * 完成後廣播。
 */
export async function handleOpencodeAliasesReorder(
  connectionId: string,
  payload: OpencodeAliasesReorderPayload,
  requestId: string,
): Promise<void> {
  const db = getDb();
  const stmts = getStmts();
  const now = Date.now();

  // 先查出現有所有 row 以取得 alias 名稱（updateAliasAndOrderIdx 需要 alias 欄位）
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];
  const aliasMap = new Map(rows.map((r) => [r.id, r.alias]));

  // 在單一 transaction 內依陣列順序設定每個 id 的 order_idx
  db.transaction(() => {
    for (let i = 0; i < payload.orderedIds.length; i++) {
      const id = payload.orderedIds[i];
      const alias = aliasMap.get(id);
      if (alias !== undefined) {
        stmts.modelAlias.updateAliasAndOrderIdx.run({
          $id: id,
          $alias: alias,
          $orderIdx: i,
          $updatedAt: now,
        });
      }
    }
  })();

  const response: OpencodeAliasesReorderResultPayload = {
    requestId,
    ok: true,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
    response,
  );

  await broadcastOpencodeAliasesUpdated();
  await broadcastProviderList();
}
