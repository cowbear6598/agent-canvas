import { randomUUID } from "crypto";
import type {
  AliasItem,
  OpencodeAliasesCreatePayload,
  OpencodeAliasesCreateResultPayload,
  OpencodeAliasesDeletePayload,
  OpencodeAliasesDeleteResultPayload,
  OpencodeAliasesListResultPayload,
  OpencodeAliasesRefreshPresetsPayload,
  OpencodeAliasesRefreshPresetsResultPayload,
  OpencodeAliasesReorderPayload,
  OpencodeAliasesReorderResultPayload,
  OpencodeAliasesUpdatePayload,
  OpencodeAliasesUpdateResultPayload,
} from "../../schemas/opencodeSettingsSchemas.js";
import { getDb, getStmts } from "../../database/index.js";
import {
  broadcastOpencodeAliasesUpdated,
  broadcastProviderList,
} from "./providerListBroadcaster.js";
import {
  buildOpenCodeProviderMetadataFailedResult,
  fetchOpencodeProviderListRaw,
} from "./opencodeProviderListService.js";
import {
  buildOpencodeThinkingPresetSnapshot,
  parseOpencodeThinkingLevelsJson,
  type OpencodeThinkingPresetSnapshot,
} from "./opencodeThinkingPresetService.js";
import { logger } from "../../utils/logger.js";

type ResultWithoutRequestId<T> = T extends { requestId: string }
  ? Omit<T, "requestId">
  : never;

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

interface ProviderModelSelection {
  provider: string;
  model: string | null;
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

async function defaultFetchThinkingPresetSnapshot(
  providerID: string,
  modelID: string,
): Promise<
  | { ok: true; snapshot: OpencodeThinkingPresetSnapshot }
  | { ok: false; code: string; message: string }
> {
  const result = await fetchOpencodeProviderListRaw();
  if (!result.ok && result.code === "opencode_server_not_ready") {
    return {
      ok: false,
      code: "opencode_server_not_ready",
      message: "opencode server 尚未啟動，請稍候或重啟後端",
    };
  }

  if (!result.ok) {
    return buildOpenCodeProviderMetadataFailedResult();
  }

  const provider = (result.data?.all ?? []).find((item) => {
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

function getSourceProviderAndModel(
  row: ConnectionAliasUsageRow,
): ProviderModelSelection {
  return {
    provider: row.source_provider ?? "claude",
    model: getConfigModel(row.source_provider_config_json),
  };
}

function getSummaryProviderAndModel(
  row: ConnectionAliasUsageRow,
): ProviderModelSelection {
  const source = getSourceProviderAndModel(row);
  return {
    provider: row.summary_provider ?? source.provider,
    model: row.summary_model,
  };
}

function getBranchProviderAndModel(
  row: ConnectionAliasUsageRow,
): ProviderModelSelection {
  const source = getSourceProviderAndModel(row);
  const sourceModel = source.model;
  const sourceProvider = source.provider;

  if (row.branch_provider !== null && row.branch_model !== null) {
    return { provider: row.branch_provider, model: row.branch_model };
  }

  if (row.branch_provider === null && row.branch_model !== null) {
    return {
      provider:
        sourceProvider === "opencode" && sourceModel ? "opencode" : "claude",
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

function queryCurrentAliasUsageCandidates(modelValue: string): {
  podRows: PodAliasUsageRow[];
  connectionRows: ConnectionAliasUsageRow[];
} {
  const stmts = getStmts();
  return {
    podRows: stmts.modelAlias.selectUsagePodsByModelValue.all({
      $modelValue: modelValue,
    }) as PodAliasUsageRow[],
    connectionRows: stmts.modelAlias.selectUsageConnectionsByModelValue.all({
      $modelValue: modelValue,
    }) as ConnectionAliasUsageRow[],
  };
}

function buildPodAliasUsage(
  row: PodAliasUsageRow,
  modelValue: string,
): AliasUsage | null {
  if (getConfigModel(row.provider_config_json) !== modelValue) {
    return null;
  }

  return {
    canvasName: row.canvas_name,
    description: `畫布「${row.canvas_name}」的 Pod「${row.pod_name}」`,
  };
}

function buildConnectionAliasUsages(
  row: ConnectionAliasUsageRow,
  modelValue: string,
): AliasUsage[] {
  const usages: AliasUsage[] = [];
  const lineLabel = getConnectionLineLabel(row);
  const summary = getSummaryProviderAndModel(row);

  if (summary.provider === "opencode" && summary.model === modelValue) {
    usages.push({
      canvasName: row.canvas_name,
      description: `畫布「${row.canvas_name}」的 connection line「${lineLabel}」Summary`,
    });
  }

  if (row.trigger_mode !== "branch") {
    return usages;
  }

  const branch = getBranchProviderAndModel(row);
  if (branch.provider !== "opencode" || branch.model !== modelValue) {
    return usages;
  }

  const labeledLine = row.label.trim()
    ? `${lineLabel}（${row.label}）`
    : lineLabel;
  usages.push({
    canvasName: row.canvas_name,
    description: `畫布「${row.canvas_name}」的 connection line「${labeledLine}」Branch`,
  });

  return usages;
}

function findCurrentAliasUsages(modelValue: string): AliasUsage[] {
  const { podRows, connectionRows } =
    queryCurrentAliasUsageCandidates(modelValue);

  return [
    ...podRows
      .map((row) => buildPodAliasUsage(row, modelValue))
      .filter((usage): usage is AliasUsage => usage !== null),
    ...connectionRows.flatMap((row) =>
      buildConnectionAliasUsages(row, modelValue),
    ),
  ];
}

function hasOtherAliasForRealModel(row: ModelAliasRow): boolean {
  const stmts = getStmts();
  const result = stmts.modelAlias.existsByProviderAndRealModel.get({
    $providerId: "opencode",
    $realProvider: row.real_provider,
    $realModel: row.real_model,
    $excludeId: row.id,
  }) as { found: 1 } | null;

  return result !== null;
}

function modelAliasExists(params: {
  providerId: string;
  realProvider: string;
  realModel: string;
  excludeId: string | null;
}): boolean {
  const stmts = getStmts();
  const result = stmts.modelAlias.existsByProviderAndRealModel.get({
    $providerId: params.providerId,
    $realProvider: params.realProvider,
    $realModel: params.realModel,
    $excludeId: params.excludeId,
  }) as { found: 1 } | null;

  return result !== null;
}

function getModelValue(
  row: Pick<ModelAliasRow, "real_provider" | "real_model">,
): string {
  return `${row.real_provider}/${row.real_model}`;
}

function isSqliteUniqueConstraint(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("UNIQUE constraint failed") ||
      (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
  );
}

function getAliasUniqueConstraintError(err: unknown): {
  code: "alias_duplicate" | "alias_model_duplicate";
  message: string;
} | null {
  if (!isSqliteUniqueConstraint(err) || !(err instanceof Error)) {
    return null;
  }

  if (
    err.message.includes(
      "model_aliases.provider_id, model_aliases.real_provider, model_aliases.real_model",
    )
  ) {
    return {
      code: "alias_model_duplicate",
      message: "此 model 已有 alias",
    };
  }

  if (
    err.message.includes(
      "model_aliases.provider_id, model_aliases.real_provider, model_aliases.alias",
    )
  ) {
    return {
      code: "alias_duplicate",
      message: "alias 已存在",
    };
  }

  return {
    code: "alias_duplicate",
    message: "alias 已存在",
  };
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

export async function listOpencodeAliases(): Promise<
  ResultWithoutRequestId<OpencodeAliasesListResultPayload>
> {
  const stmts = getStmts();
  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];

  return {
    success: true,
    items: rows.map(rowToAliasItem),
  };
}

export async function createOpencodeAlias(
  payload: OpencodeAliasesCreatePayload,
): Promise<ResultWithoutRequestId<OpencodeAliasesCreateResultPayload>> {
  const stmts = getStmts();
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const presetResult = await fetchThinkingPresetSnapshot(
    payload.providerID,
    payload.modelID,
  );

  if (!presetResult.ok) {
    return {
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
  }

  try {
    const createResult = db.transaction(
      ():
        | { type: "duplicateModel" }
        | { type: "created"; row: ModelAliasRow | null } => {
        if (
          modelAliasExists({
            providerId: "opencode",
            realProvider: payload.providerID,
            realModel: payload.modelID,
            excludeId: null,
          })
        ) {
          return { type: "duplicateModel" };
        }

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

        const row = stmts.modelAlias.selectById.get({
          $id: id,
        }) as ModelAliasRow | null;

        return { type: "created", row };
      },
    )();

    if (createResult.type === "duplicateModel") {
      return {
        success: false,
        error: {
          code: "alias_model_duplicate",
          message: "此 model 已有 alias",
        },
      };
    }

    const newRow = createResult.row;
    if (!newRow) {
      return {
        success: false,
        error: {
          code: "alias_not_found",
          message: "新增後找不到建立的 alias",
        },
      };
    }

    const result = {
      success: true,
      item: rowToAliasItem(newRow),
    } as const;

    await broadcastRefreshBestEffort();
    return result;
  } catch (err) {
    const conflict = getAliasUniqueConstraintError(err);
    if (!conflict) throw err;
    return {
      success: false,
      error: conflict,
    };
  }
}

export async function updateOpencodeAlias(
  payload: OpencodeAliasesUpdatePayload,
): Promise<ResultWithoutRequestId<OpencodeAliasesUpdateResultPayload>> {
  const stmts = getStmts();
  const now = Date.now();

  const existingRow = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!existingRow) {
    return {
      success: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法更新",
      },
    };
  }

  if (
    modelAliasExists({
      providerId: "opencode",
      realProvider: existingRow.real_provider,
      realModel: payload.modelID,
      excludeId: payload.id,
    })
  ) {
    return {
      success: false,
      error: {
        code: "alias_model_duplicate",
        message: "此 model 已有 alias",
      },
    };
  }

  if (payload.modelID !== existingRow.real_model) {
    const oldModelValue = getModelValue(existingRow);
    const usages = findCurrentAliasUsages(oldModelValue);
    if (usages.length > 0 && !hasOtherAliasForRealModel(existingRow)) {
      logAliasInUseDetails("update", existingRow, usages);
      return {
        success: false,
        error: {
          code: "alias_in_use",
          message: buildAliasInUseMessage("update"),
        },
      };
    }
  }

  const presetResult = await fetchThinkingPresetSnapshot(
    existingRow.real_provider,
    payload.modelID,
  );
  if (!presetResult.ok) {
    return {
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
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
      return {
        success: false,
        error: {
          code: "alias_not_found",
          message: "找不到指定的 alias，無法更新",
        },
      };
    }

    const result = {
      success: true,
      item: rowToAliasItem(updatedRow),
    } as const;

    await broadcastRefreshBestEffort();
    return result;
  } catch (err) {
    const conflict = getAliasUniqueConstraintError(err);
    if (!conflict) throw err;
    return {
      success: false,
      error: conflict,
    };
  }
}

export async function refreshOpencodeAliasPresets(
  payload: OpencodeAliasesRefreshPresetsPayload,
): Promise<
  ResultWithoutRequestId<OpencodeAliasesRefreshPresetsResultPayload>
> {
  const stmts = getStmts();
  const row = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!row) {
    return {
      success: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法刷新 thinking presets",
      },
    };
  }

  const presetResult = await fetchThinkingPresetSnapshot(
    row.real_provider,
    row.real_model,
  );
  if (!presetResult.ok) {
    return {
      success: false,
      error: {
        code: presetResult.code,
        message: presetResult.message,
      },
    };
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
    return {
      success: false,
      error: {
        code: "alias_not_found",
        message: "刷新後找不到指定的 alias",
      },
    };
  }

  const result = {
    success: true,
    item: rowToAliasItem(updatedRow),
  } as const;

  await broadcastRefreshBestEffort();
  return result;
}

export async function deleteOpencodeAlias(
  payload: OpencodeAliasesDeletePayload,
): Promise<ResultWithoutRequestId<OpencodeAliasesDeleteResultPayload>> {
  const stmts = getStmts();

  const row = stmts.modelAlias.selectById.get({
    $id: payload.id,
  }) as ModelAliasRow | null;

  if (!row) {
    return {
      success: false,
      error: {
        code: "alias_not_found",
        message: "找不到指定的 alias，無法刪除",
      },
    };
  }

  const modelValue = getModelValue(row);
  const usages = findCurrentAliasUsages(modelValue);
  if (usages.length > 0 && !hasOtherAliasForRealModel(row)) {
    logAliasInUseDetails("delete", row, usages);
    return {
      success: false,
      error: {
        code: "alias_in_use",
        message: buildAliasInUseMessage("delete"),
      },
    };
  }

  stmts.modelAlias.deleteById.run(payload.id);

  const result = {
    success: true,
    id: payload.id,
  } as const;

  await broadcastRefreshBestEffort();
  return result;
}

export async function reorderOpencodeAliases(
  payload: OpencodeAliasesReorderPayload,
): Promise<ResultWithoutRequestId<OpencodeAliasesReorderResultPayload>> {
  const db = getDb();
  const stmts = getStmts();
  const now = Date.now();

  const rows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];
  const aliasIds = new Set(rows.map((row) => row.id));

  const payloadIds = new Set(payload.orderedIds);
  const isPermutation =
    payload.orderedIds.length === aliasIds.size &&
    payloadIds.size === aliasIds.size &&
    payload.orderedIds.every((id) => aliasIds.has(id));

  if (!isPermutation) {
    return {
      success: false,
      error: {
        code: "invalid_ordered_ids",
        message: "orderedIds 必須為當前 alias 集合的完整排列",
      },
    };
  }

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

  const updatedRows = stmts.modelAlias.selectByProviderId.all({
    $providerId: "opencode",
  }) as ModelAliasRow[];

  const result = {
    success: true,
    items: updatedRows.map(rowToAliasItem),
  } as const;

  await broadcastRefreshBestEffort();
  return result;
}
