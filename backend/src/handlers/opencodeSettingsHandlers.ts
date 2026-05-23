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
  OpencodeAliasesRefreshPresetsPayload,
  OpencodeAliasesRefreshPresetsResultPayload,
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
import {
  buildOpencodeThinkingPresetSnapshot,
  parseOpencodeThinkingLevelsJson,
  type OpencodeThinkingPresetSnapshot,
} from "../services/provider/opencodeThinkingPresetService.js";
import { logger } from "../utils/logger.js";

// ─── 廣播輔助：best-effort refresh，不影響已完成的 DB 操作 ─────────────────────

async function broadcastRefreshBestEffort(): Promise<void> {
  try {
    await Promise.all([
      broadcastOpencodeAliasesUpdated(),
      broadcastProviderList(),
    ]);
  } catch (err) {
    logger.error(
      "Integration",
      "Error",
      "opencode aliases refresh 廣播失敗",
      err,
    );
  }
}

const OPENCODE_PROVIDER_LIST_TIMEOUT_MS = 10_000;

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  const timeoutFetch = ((input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })) as typeof fetch;
  timeoutFetch.preconnect = fetch.preconnect.bind(fetch);
  return timeoutFetch;
}

function sanitizeOpencodeProviderModel(
  model: unknown,
  fallbackId?: string,
): {
  id: string;
  name: string;
} | null {
  if (!model || typeof model !== "object") return null;
  const rawModel = model as { id?: unknown; name?: unknown };
  const id = typeof rawModel.id === "string" ? rawModel.id : fallbackId;
  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }

  return {
    id,
    name: typeof rawModel.name === "string" ? rawModel.name : id,
  };
}

function sanitizeOpencodeProvider(provider: unknown): {
  id: string;
  name: string;
  models: { id: string; name: string }[];
} | null {
  if (!provider || typeof provider !== "object") return null;
  const rawProvider = provider as {
    id?: unknown;
    name?: unknown;
    models?: unknown;
  };
  if (
    typeof rawProvider.id !== "string" ||
    rawProvider.id.trim().length === 0
  ) {
    return null;
  }

  const rawModels = rawProvider.models;
  const models = Array.isArray(rawModels)
    ? rawModels.map((model) => sanitizeOpencodeProviderModel(model))
    : rawModels && typeof rawModels === "object"
      ? Object.entries(rawModels).map(([modelId, model]) =>
          sanitizeOpencodeProviderModel(model, modelId),
        )
      : [];

  return {
    id: rawProvider.id,
    name:
      typeof rawProvider.name === "string" ? rawProvider.name : rawProvider.id,
    models: models.filter((model) => model !== null),
  };
}

function isSqliteUniqueConstraint(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("UNIQUE constraint failed") ||
      (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
  );
}

/**
 * 先呼叫 restartOpencodeServer()（stop → start），完成後取得最新 state：
 * - status === "ready" → 回傳 success=true
 * - 其他（"failed" 等）→ 回傳 success=false，error.code = opencode_restart_failed。
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
    logger.error(
      "Integration",
      "Error",
      `opencode 重新啟動失敗（status=${state.status}）`,
      state.failureReason,
    );
    response = {
      requestId,
      success: false,
      error: {
        code: "opencode_restart_failed",
        message: "opencode 重新啟動失敗，請稍後再試",
      },
    };
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT,
    response,
  );
}

/**
 * 轉發 opencode GET /provider，取得 all/default/connected 後回傳前端需要的欄位。
 * - opencode server 尚未 ready → 回傳 success=false / opencode_server_not_ready
 * - ready → 呼叫 client.provider.list()，只回傳 id/name/models.id/name
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
    const client = createOpencodeClient({
      baseUrl: serverState.baseUrl,
      fetch: createTimeoutFetch(OPENCODE_PROVIDER_LIST_TIMEOUT_MS),
    });
    const result = await client.provider.list();

    if (result.error) {
      logger.error(
        "Integration",
        "Error",
        "取得 opencode provider 清單失敗",
        result.error,
      );
      const response: OpencodeProviderListResultPayload = {
        requestId,
        success: false,
        error: {
          code: "opencode_provider_list_failed",
          message: "取得 provider 清單失敗，請稍後再試",
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
      all: (data?.all ?? [])
        .map(sanitizeOpencodeProvider)
        .filter((provider) => provider !== null),
      default: data?.default ?? {},
      connected: (data?.connected ?? []).filter(
        (providerId): providerId is string => typeof providerId === "string",
      ),
    };

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
      response,
    );
  } catch (err) {
    logger.error(
      "Integration",
      "Error",
      "取得 opencode provider 清單時發生例外",
      err,
    );
    const response: OpencodeProviderListResultPayload = {
      requestId,
      success: false,
      error: {
        code: "opencode_provider_list_failed",
        message: "取得 provider 清單失敗，請稍後再試",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
      response,
    );
  }
}

interface ModelAliasRow {
  id: string;
  provider_id: string;
  real_provider: string;
  real_model: string;
  alias: string;
  order_idx: number;
  thinking_levels_json: string | null;
  default_thinking_level: string | null;
  thinking_metadata_json: string | null;
  thinking_metadata_fetched_at: number | null;
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
  const levels = parseOpencodeThinkingLevelsJson(row.thinking_levels_json);
  const labels = Object.fromEntries(
    levels.map((level) => [level.id, level.label]),
  );
  return {
    id: row.id,
    providerID: row.real_provider,
    modelID: row.real_model,
    alias: row.alias,
    orderIdx: row.order_idx,
    thinkingLevels: levels.map((level) => level.id),
    ...(levels.length > 0 ? { thinkingLevelLabels: labels } : {}),
    defaultThinkingLevel: row.default_thinking_level,
    thinkingMetadataFetchedAt: row.thinking_metadata_fetched_at,
  };
}

async function defaultFetchThinkingPresetSnapshot(
  providerID: string,
  modelID: string,
): Promise<
  | { ok: true; snapshot: OpencodeThinkingPresetSnapshot }
  | { ok: false; code: string; message: string }
> {
  const serverState = getOpencodeServerState();
  if (serverState.status !== "ready" || !serverState.baseUrl) {
    return {
      ok: false,
      code: "opencode_server_not_ready",
      message: "opencode server 尚未啟動，請稍候或重啟後端",
    };
  }

  const client = createOpencodeClient({
    baseUrl: serverState.baseUrl,
    fetch: createTimeoutFetch(OPENCODE_PROVIDER_LIST_TIMEOUT_MS),
  });
  const result = await client.provider.list();
  if (result.error) {
    return {
      ok: false,
      code: "opencode_provider_list_failed",
      message: "取得 OpenCode provider metadata 失敗，請稍後再試",
    };
  }

  const data = result.data as { all?: unknown[] } | null | undefined;
  const provider = (data?.all ?? []).find((item) => {
    const record = item as { id?: unknown };
    return record && record.id === providerID;
  }) as { models?: unknown } | undefined;
  if (!provider) {
    return {
      ok: false,
      code: "opencode_provider_not_found",
      message: "找不到指定的 OpenCode provider",
    };
  }

  const models = provider.models;
  const modelMetadata =
    models && typeof models === "object" && !Array.isArray(models)
      ? (models as Record<string, unknown>)[modelID]
      : Array.isArray(models)
        ? models.find((model) => (model as { id?: unknown }).id === modelID)
        : null;
  if (!modelMetadata) {
    return {
      ok: false,
      code: "opencode_model_not_found",
      message: "找不到指定的 OpenCode model",
    };
  }

  return buildOpencodeThinkingPresetSnapshot({
    providerID,
    modelID,
    providerMetadata: provider,
    modelMetadata,
  });
}

let fetchThinkingPresetSnapshot = defaultFetchThinkingPresetSnapshot;

export function setOpencodeThinkingPresetSnapshotFetcher(
  fetcher: typeof fetchThinkingPresetSnapshot,
): void {
  fetchThinkingPresetSnapshot = fetcher;
}

export function resetOpencodeThinkingPresetSnapshotFetcher(): void {
  fetchThinkingPresetSnapshot = defaultFetchThinkingPresetSnapshot;
}

function snapshotStatementParams(snapshot: OpencodeThinkingPresetSnapshot): {
  $thinkingLevelsJson: string;
  $defaultThinkingLevel: string | null;
  $thinkingMetadataJson: string;
  $thinkingMetadataFetchedAt: number;
} {
  return {
    $thinkingLevelsJson: JSON.stringify(snapshot.levels),
    $defaultThinkingLevel: snapshot.defaultLevel,
    $thinkingMetadataJson: JSON.stringify(snapshot.metadata),
    $thinkingMetadataFetchedAt: snapshot.fetchedAt,
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
       WHERE p.provider = 'opencode'
         AND p.provider_config_json IS NOT NULL
         AND json_valid(p.provider_config_json)
         AND json_extract(p.provider_config_json, '$.model') = $modelValue`,
    )
    .all({ $modelValue: modelValue }) as PodAliasUsageRow[];

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
       LEFT JOIN pods target_pod ON target_pod.id = conn.target_pod_id
       WHERE (
           conn.summary_model = $modelValue
           AND (
             conn.summary_provider = 'opencode'
             OR (conn.summary_provider IS NULL AND source_pod.provider = 'opencode')
           )
         )
         OR (
           conn.trigger_mode = 'branch'
           AND (
             (conn.branch_provider = 'opencode' AND conn.branch_model = $modelValue)
             OR (
               conn.branch_provider IS NULL
               AND conn.branch_model = $modelValue
               AND source_pod.provider = 'opencode'
               AND source_pod.provider_config_json IS NOT NULL
               AND json_valid(source_pod.provider_config_json)
               AND json_extract(source_pod.provider_config_json, '$.model') IS NOT NULL
             )
             OR (
               conn.branch_provider = 'opencode'
               AND conn.branch_model IS NULL
               AND source_pod.provider = 'opencode'
               AND source_pod.provider_config_json IS NOT NULL
               AND json_valid(source_pod.provider_config_json)
               AND json_extract(source_pod.provider_config_json, '$.model') = $modelValue
             )
             OR (
               conn.branch_provider IS NULL
               AND conn.branch_model IS NULL
               AND source_pod.provider = 'opencode'
               AND source_pod.provider_config_json IS NOT NULL
               AND json_valid(source_pod.provider_config_json)
               AND json_extract(source_pod.provider_config_json, '$.model') = $modelValue
             )
           )
         )`,
    )
    .all({ $modelValue: modelValue }) as ConnectionAliasUsageRow[];

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

function hasOtherAliasForRealModel(row: ModelAliasRow): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM model_aliases
       WHERE provider_id = 'opencode'
         AND real_provider = $realProvider
         AND real_model = $realModel
         AND id != $id`,
    )
    .get({
      $realProvider: row.real_provider,
      $realModel: row.real_model,
      $id: row.id,
    }) as { count: number };

  return result.count > 0;
}

function logAliasInUseDetails(
  action: "delete" | "update",
  row: ModelAliasRow,
  usages: AliasUsage[],
): void {
  const canvasCount = new Set(usages.map((usage) => usage.canvasName)).size;
  logger.warn(
    "Integration",
    "Warn",
    `opencode alias 使用中，已阻擋 ${action} 操作（aliasId=${row.id}, realProvider=${row.real_provider}, realModel=${row.real_model}, usageCount=${usages.length}, canvasCount=${canvasCount}）`,
  );
}

function buildAliasInUseMessage(action: "delete" | "update"): string {
  return action === "delete"
    ? "無法刪除 alias，仍被目前設定使用中。請先改用其他模型後再刪除。"
    : "無法更新 alias，原模型仍被目前設定使用中。請先改用其他模型後再更新。";
}

/**
 * 列出 provider_id="opencode" 的所有 alias，依 order_idx 升序回傳。
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

/**
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
  const presetResult = await fetchThinkingPresetSnapshot(
    payload.providerID,
    payload.modelID,
  );

  if (!presetResult.ok) {
    const response: OpencodeAliasesCreateResultPayload = {
      requestId,
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
      response,
    );
    return;
  }

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
        ...snapshotStatementParams(presetResult.snapshot),
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

    await broadcastRefreshBestEffort();
  } catch (err) {
    if (isSqliteUniqueConstraint(err)) {
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

/**
 * 更新指定 alias 的 alias 名稱與 real_model。
 * order_idx 由獨立的 reorder API 處理，本函式不會修改順序；完成後廣播。
 */
export async function handleOpencodeAliasesUpdate(
  connectionId: string,
  payload: OpencodeAliasesUpdatePayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const now = Date.now();

  const existingRow = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!existingRow) {
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

  if (payload.modelID !== existingRow.real_model) {
    const oldModelValue = `${existingRow.real_provider}/${existingRow.real_model}`;
    const usages = findCurrentAliasUsages(oldModelValue);
    if (usages.length > 0 && !hasOtherAliasForRealModel(existingRow)) {
      logAliasInUseDetails("update", existingRow, usages);
      const response: OpencodeAliasesUpdateResultPayload = {
        requestId,
        success: false,
        error: {
          code: "alias_in_use",
          message: buildAliasInUseMessage("update"),
        },
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
        response,
      );
      return;
    }
  }

  const presetResult = await fetchThinkingPresetSnapshot(
    existingRow.real_provider,
    payload.modelID,
  );
  if (!presetResult.ok) {
    const response: OpencodeAliasesUpdateResultPayload = {
      requestId,
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
      response,
    );
    return;
  }

  try {
    stmts.modelAlias.updateAliasAndModelId.run({
      $id: payload.id,
      $alias: payload.alias,
      $realModel: payload.modelID,
      ...snapshotStatementParams(presetResult.snapshot),
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

    await broadcastRefreshBestEffort();
  } catch (err) {
    if (isSqliteUniqueConstraint(err)) {
      const response: OpencodeAliasesUpdateResultPayload = {
        requestId,
        success: false,
        error: { code: "alias_duplicate", message: "alias 已存在" },
      };
      socketService.emitToConnection(
        connectionId,
        WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
        response,
      );
    } else {
      throw err;
    }
  }
}

export async function handleOpencodeAliasesRefreshPresets(
  connectionId: string,
  payload: OpencodeAliasesRefreshPresetsPayload,
  requestId: string,
): Promise<void> {
  const stmts = getStmts();
  const row = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!row) {
    const response: OpencodeAliasesRefreshPresetsResultPayload = {
      requestId,
      success: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法刷新 thinking presets",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
      response,
    );
    return;
  }

  const presetResult = await fetchThinkingPresetSnapshot(
    row.real_provider,
    row.real_model,
  );
  if (!presetResult.ok) {
    const response: OpencodeAliasesRefreshPresetsResultPayload = {
      requestId,
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
      response,
    );
    return;
  }

  stmts.modelAlias.updateThinkingPresets.run({
    $id: payload.id,
    ...snapshotStatementParams(presetResult.snapshot),
    $updatedAt: Date.now(),
  });

  const updatedRow = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!updatedRow) {
    const response: OpencodeAliasesRefreshPresetsResultPayload = {
      requestId,
      success: false,
      error: {
        code: "alias_not_found",
        message: "刷新後找不到指定的 alias",
      },
    };
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
      response,
    );
    return;
  }

  const response: OpencodeAliasesRefreshPresetsResultPayload = {
    requestId,
    success: true,
    item: rowToAliasItem(updatedRow),
  };

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
    response,
  );

  await broadcastRefreshBestEffort();
}

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
  if (usages.length > 0 && !hasOtherAliasForRealModel(row)) {
    logAliasInUseDetails("delete", row, usages);
    const response: OpencodeAliasesDeleteResultPayload = {
      requestId,
      success: false,
      error: {
        code: "alias_in_use",
        message: buildAliasInUseMessage("delete"),
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

  await broadcastRefreshBestEffort();
}

/**
 * 依陣列順序批次更新每個 id 的 order_idx。
 * 先查出現有 alias id，再在單一 DB transaction 內批次更新所有 order_idx。
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

  // 先查出現有所有 row 以驗證 orderedIds 是否為完整排列
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];
  const aliasIds = new Set(rows.map((row) => row.id));

  // 驗證 orderedIds 必須是當前 DB alias id 的完整集合（長度與成員皆相等），
  // 否則殘缺/含未知 id 的 reorder 會在 DB 留下 order_idx 落差
  const payloadIds = new Set(payload.orderedIds);
  const isPermutation =
    payload.orderedIds.length === aliasIds.size &&
    payloadIds.size === aliasIds.size &&
    payload.orderedIds.every((id) => aliasIds.has(id));

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

  // 在單一 transaction 內以 CASE WHEN 批次設定 order_idx
  db.transaction(() => {
    if (payload.orderedIds.length === 0) return;

    const caseClauses = payload.orderedIds.map(() => "WHEN ? THEN ?").join(" ");
    const idPlaceholders = payload.orderedIds.map(() => "?").join(", ");
    const params: Array<string | number> = [];
    payload.orderedIds.forEach((id, orderIdx) => {
      params.push(id, orderIdx);
    });
    params.push(now, "opencode", ...payload.orderedIds);

    db.prepare(
      `UPDATE model_aliases
       SET order_idx = CASE id ${caseClauses} END,
           updated_at = ?
       WHERE provider_id = ?
         AND id IN (${idPlaceholders})`,
    ).run(...params);
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

  await broadcastRefreshBestEffort();
}
