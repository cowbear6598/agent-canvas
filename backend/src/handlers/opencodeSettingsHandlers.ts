import { randomUUID } from "crypto";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  OpencodeServerRestartPayload,
  OpencodeServerRestartResultPayload,
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
import {
  getOpencodeServerState,
  restartOpencodeServer,
} from "../services/provider/opencodeServer.js";
import { socketService } from "../services/socketService.js";
import { getStmts, getDb } from "../database/index.js";
import {
  broadcastOpencodeAliasesUpdated,
  broadcastProviderList,
} from "../services/provider/providerListBroadcaster.js";

// ─── 廣播輔助：失敗時不向上傳遞例外 ──────────────────────────────────────────

async function safeBroadcast(): Promise<void> {
  try {
    await Promise.all([
      broadcastOpencodeAliasesUpdated(),
      broadcastProviderList(),
    ]);
  } catch (err) {
    console.error("[opencodeSettingsHandlers] broadcast 失敗：", err);
  }
}

// ─── handleOpencodeServerRestart ─────────────────────────────────────────────

/**
 * handleOpencodeServerRestart：重新啟動 opencode 子程序。
 *
 * 先呼叫 restartOpencodeServer()（stop → start），完成後取得最新 state：
 * - status === "ready" → 回傳 success=true
 * - 其他（"failed" 等）→ 回傳 success=false，error.code = opencode_restart_failed，
 *   error.message 取 failureReason，若無則使用預設說明文字。
 */
export async function handleOpencodeServerRestart(
  connectionId: string,
  payload: OpencodeServerRestartPayload,
  requestId: string,
): Promise<void> {
  await restartOpencodeServer();

  const state = getOpencodeServerState();

  let response: OpencodeServerRestartResultPayload;

  if (state.status === "ready") {
    response = { requestId, success: true };
  } else {
    response = {
      requestId,
      success: false,
      error: {
        code: "opencode_restart_failed",
        message: state.failureReason ?? "opencode 重新啟動失敗",
      },
    };
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT,
    response,
  );
}

// ─── handleOpencodeProviderList ───────────────────────────────────────────────

/**
 * handleOpencodeProviderList：轉發 opencode GET /provider，
 * 取得所有 provider 清單（all、default、connected）後回傳給前端。
 *
 * - opencode server 尚未 ready → 回傳 success=false / opencode_server_not_ready
 * - ready → 呼叫 client.provider.list()，將 all / default / connected 原樣回傳
 */
export async function handleOpencodeProviderList(
  connectionId: string,
  payload: OpencodeProviderListPayload,
  requestId: string,
): Promise<void> {
  const serverState = getOpencodeServerState();

  if (serverState.status !== "ready" || !serverState.baseUrl) {
    const response: OpencodeProviderListResultPayload = {
      requestId,
      success: false,
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

  try {
    const client = createOpencodeClient({ baseUrl: serverState.baseUrl });
    const result = await client.provider.list();

    if (result.error) {
      const response: OpencodeProviderListResultPayload = {
        requestId,
        success: false,
        error: {
          code: "opencode_provider_list_failed",
          message:
            (result.error as { message?: string })?.message ??
            "取得 provider 清單失敗",
        },
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
        response,
      );
      return;
    }

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
      success: true,
      all: data?.all ?? [],
      default: data?.default ?? {},
      connected: data?.connected ?? [],
    };

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
      response,
    );
  } catch (err) {
    console.error("[handleOpencodeProviderList]", err);
    const response: OpencodeProviderListResultPayload = {
      requestId,
      success: false,
      error: {
        code: "opencode_provider_list_failed",
        message: err instanceof Error ? err.message : "取得 provider 清單失敗",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
      response,
    );
  }
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

interface AliasUsage {
  canvasName: string;
  description: string;
}

interface PodAliasUsageRow {
  canvas_name: string;
  pod_name: string;
  provider_config_json: string | null;
}

interface ConnectionAliasUsageRow {
  canvas_name: string;
  connection_id: string;
  source_pod_name: string | null;
  source_provider: string | null;
  source_provider_config_json: string | null;
  target_pod_name: string | null;
  trigger_mode: string;
  summary_model: string;
  summary_provider: string | null;
  label: string;
  branch_provider: string | null;
  branch_model: string | null;
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

function parseProviderConfig(json: string | null): Record<string, unknown> {
  if (!json) return {};

  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getConfigModel(json: string | null): string | null {
  const model = parseProviderConfig(json).model;
  return typeof model === "string" && model.trim().length > 0 ? model : null;
}

function getConnectionLineLabel(row: ConnectionAliasUsageRow): string {
  const sourceName = row.source_pod_name ?? row.connection_id;
  const targetName = row.target_pod_name ?? row.connection_id;
  return `${sourceName} → ${targetName}`;
}

function getBranchProviderAndModel(row: ConnectionAliasUsageRow): {
  provider: string;
  model: string | null;
} {
  const sourceModel = getConfigModel(row.source_provider_config_json);
  const sourceProvider = row.source_provider ?? "claude";

  if (row.branch_provider !== null && row.branch_model !== null) {
    return { provider: row.branch_provider, model: row.branch_model };
  }

  if (row.branch_provider === null && row.branch_model !== null) {
    return {
      provider: sourceProvider === "opencode" && sourceModel ? "opencode" : "claude",
      model: row.branch_model,
    };
  }

  if (row.branch_provider !== null) {
    if (row.branch_provider === "opencode" && sourceProvider === "opencode") {
      return { provider: "opencode", model: sourceModel };
    }
    return { provider: row.branch_provider, model: null };
  }

  return { provider: sourceProvider, model: sourceModel };
}

function findCurrentAliasUsages(modelValue: string): AliasUsage[] {
  const db = getDb();
  const usages: AliasUsage[] = [];

  const podRows = db
    .prepare(
      `SELECT c.name AS canvas_name,
              p.name AS pod_name,
              p.provider_config_json AS provider_config_json
       FROM pods p
       INNER JOIN canvases c ON c.id = p.canvas_id
       WHERE p.provider = 'opencode'`,
    )
    .all() as PodAliasUsageRow[];

  for (const row of podRows) {
    if (getConfigModel(row.provider_config_json) === modelValue) {
      usages.push({
        canvasName: row.canvas_name,
        description: `畫布「${row.canvas_name}」的 Pod「${row.pod_name}」`,
      });
    }
  }

  const connectionRows = db
    .prepare(
      `SELECT c.name AS canvas_name,
              conn.id AS connection_id,
              source_pod.name AS source_pod_name,
              source_pod.provider AS source_provider,
              source_pod.provider_config_json AS source_provider_config_json,
              target_pod.name AS target_pod_name,
              conn.trigger_mode AS trigger_mode,
              conn.summary_model AS summary_model,
              conn.summary_provider AS summary_provider,
              conn.label AS label,
              conn.branch_provider AS branch_provider,
              conn.branch_model AS branch_model
       FROM connections conn
       INNER JOIN canvases c ON c.id = conn.canvas_id
       LEFT JOIN pods source_pod ON source_pod.id = conn.source_pod_id
       LEFT JOIN pods target_pod ON target_pod.id = conn.target_pod_id`,
    )
    .all() as ConnectionAliasUsageRow[];

  for (const row of connectionRows) {
    const summaryProvider =
      row.summary_provider ?? row.source_provider ?? "claude";
    if (summaryProvider === "opencode" && row.summary_model === modelValue) {
      usages.push({
        canvasName: row.canvas_name,
        description: `畫布「${row.canvas_name}」的 connection line「${getConnectionLineLabel(row)}」Summary`,
      });
    }

    if (row.trigger_mode === "branch") {
      const branch = getBranchProviderAndModel(row);
      if (branch.provider === "opencode" && branch.model === modelValue) {
        const label = row.label.trim()
          ? `${getConnectionLineLabel(row)}（${row.label}）`
          : getConnectionLineLabel(row);
        usages.push({
          canvasName: row.canvas_name,
          description: `畫布「${row.canvas_name}」的 connection line「${label}」Branch`,
        });
      }
    }
  }

  return usages;
}

function buildAliasInUseMessage(usages: AliasUsage[]): string {
  const details = usages.map((usage) => usage.description).join("、");
  return `無法刪除 alias，仍被目前設定使用中：${details}。請先改用其他模型後再刪除。`;
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
    success: true,
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
 * - 整個 DB 操作包在 transaction 內，UNIQUE 衝突轉成結構化錯誤
 * - 完成後廣播 opencode:aliases:updated 與 provider:list:result
 */
export async function handleOpencodeAliasesCreate(
  connectionId: string,
  payload: OpencodeAliasesCreatePayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  try {
    // 在單一 transaction 內：查 max orderIdx → insert → selectById
    const newRow = db.transaction((): ModelAliasRow | null => {
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

      return stmts.modelAlias.selectById.get({
        $id: id,
      }) as ModelAliasRow | null;
    })();

    if (!newRow) {
      const response: OpencodeAliasesCreateResultPayload = {
        requestId,
        success: false,
        error: { code: "alias_not_found", message: "新增後找不到建立的 alias" },
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
        response,
      );
      return;
    }

    const response: OpencodeAliasesCreateResultPayload = {
      requestId,
      success: true,
      item: rowToAliasItem(newRow),
    };

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
      response,
    );

    await safeBroadcast();
  } catch (err) {
    // UNIQUE 衝突轉成結構化錯誤
    const isUnique =
      err instanceof Error &&
      (err.message.includes("UNIQUE constraint failed") ||
        (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE");

    if (isUnique) {
      const response: OpencodeAliasesCreateResultPayload = {
        requestId,
        success: false,
        error: { code: "alias_duplicate", message: "alias 已存在" },
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
        response,
      );
    } else {
      throw err;
    }
  }
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

  const updatedRow = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!updatedRow) {
    const response: OpencodeAliasesUpdateResultPayload = {
      requestId,
      success: false,
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
    success: true,
    item: rowToAliasItem(updatedRow),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
    response,
  );

  await safeBroadcast();
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

  const row = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!row) {
    const response: OpencodeAliasesDeleteResultPayload = {
      requestId,
      success: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法刪除",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
      response,
    );
    return;
  }

  const modelValue = `${row.real_provider}/${row.real_model}`;
  const usages = findCurrentAliasUsages(modelValue);
  if (usages.length > 0) {
    const response: OpencodeAliasesDeleteResultPayload = {
      requestId,
      success: false,
      error: {
        code: "alias_in_use",
        message: buildAliasInUseMessage(usages),
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
      response,
    );
    return;
  }

  stmts.modelAlias.deleteById.run(payload.id);

  const response: OpencodeAliasesDeleteResultPayload = {
    requestId,
    success: true,
    id: payload.id,
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
    response,
  );

  await safeBroadcast();
}

// ─── handleOpencodeAliasesReorder ────────────────────────────────────────────

/**
 * handleOpencodeAliasesReorder：依陣列順序批次更新每個 id 的 order_idx。
 * 先查出現有 alias 名稱，再在單一 DB transaction 內更新所有 order_idx。
 * 成功後查出最新清單放進 result.items。
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

  // 驗證 orderedIds 必須是當前 DB alias id 的完整集合（長度與成員皆相等），
  // 否則殘缺/含未知 id 的 reorder 會在 DB 留下 order_idx 落差
  const dbIds = new Set(aliasMap.keys());
  const payloadIds = new Set(payload.orderedIds);
  const isPermutation =
    payload.orderedIds.length === dbIds.size &&
    payloadIds.size === dbIds.size &&
    payload.orderedIds.every((id) => dbIds.has(id));

  if (!isPermutation) {
    const response: OpencodeAliasesReorderResultPayload = {
      requestId,
      success: false,
      error: {
        code: "invalid_ordered_ids",
        message: "orderedIds 必須為當前 alias 集合的完整排列",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
      response,
    );
    return;
  }

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

  // commit 完成後查出最新清單
  const updatedRows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];

  const response: OpencodeAliasesReorderResultPayload = {
    requestId,
    success: true,
    items: updatedRows.map(rowToAliasItem),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
    response,
  );

  await safeBroadcast();
}
