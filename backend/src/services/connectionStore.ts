import { v4 as uuidv4 } from "uuid";
import type {
  Connection,
  AnchorPosition,
  TriggerMode,
  DecideStatus,
  ConnectionStatus,
} from "../types";
import { getDb } from "../database/index.js";
import { getStatements } from "../database/statements.js";
import {
  assertModelSupportedByProvider,
  getProvider,
  type ProviderName,
} from "./provider/index.js";
import { podStore } from "./podStore.js";
import type { Pod } from "../types";

interface CreateConnectionData {
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: TriggerMode;
  /** summaryModel 接受任意非空模型名稱 */
  summaryModel?: string;
  /** summaryProvider 指定摘要時使用的 provider；未提供則依 sourcePod.provider fallback */
  summaryProvider?: ProviderName;
  label?: string;
  description?: string;
  branchProvider?: ProviderName;
  branchModel?: string;
}

function validateProviderModel(
  provider: ProviderName,
  model: string,
  fieldName: "summaryModel" | "branchModel",
): void {
  try {
    assertModelSupportedByProvider(provider, model);
  } catch {
    throw new Error(`${fieldName} 不支援 provider ${provider}`);
  }
}

function shouldResetDecideState(oldMode: string, newMode: string): boolean {
  // 從 branch 切換到其他模式時需要 reset decide state
  return oldMode === "branch" && (newMode === "auto" || newMode === "direct");
}

interface ConnectionRow {
  id: string;
  canvas_id: string;
  source_pod_id: string;
  source_anchor: string;
  target_pod_id: string;
  target_anchor: string;
  trigger_mode: string;
  decide_status: string;
  decide_reason: string | null;
  connection_status: string;
  summary_model: string;
  /** DB 欄位；NULL 代表舊資料（升級前未指定），由執行端 fallback */
  summary_provider: string | null;
  label: string;
  description: string | null;
  branch_provider: string | null;
  branch_model: string | null;
}

function rowToConnection(row: ConnectionRow, sourcePod?: Pod | null): Connection {
  const branchDefaults =
    row.branch_provider === null || row.branch_model === null
      ? resolveBranchDefaults(row, sourcePod)
      : null;
  const { provider: resolvedBranchProvider, model: resolvedBranchModel } =
    resolveBranchFields(row, branchDefaults);

  return {
    id: row.id,
    sourcePodId: row.source_pod_id,
    sourceAnchor: row.source_anchor as AnchorPosition,
    targetPodId: row.target_pod_id,
    targetAnchor: row.target_anchor as AnchorPosition,
    triggerMode: row.trigger_mode as TriggerMode,
    decideStatus: row.decide_status as DecideStatus,
    decideReason: row.decide_reason,
    connectionStatus: row.connection_status as ConnectionStatus,
    summaryModel: row.summary_model,
    // DB NULL 保留原意：未指定，由執行端 fallback 至 sourcePod.provider
    summaryProvider: row.summary_provider as ProviderName | null,
    label: row.label,
    // DB NULL 轉為 undefined（符合 Connection 介面的選填定義）
    description: row.description ?? undefined,
    // DB NULL 時依 source Pod provider 推導預設值，避免非 Claude Pod 的 Branch 決策落回 Claude。
    branchProvider: resolvedBranchProvider,
    branchModel: resolvedBranchModel,
  };
}

function resolveBranchFields(
  row: ConnectionRow,
  branchDefaults: { provider: ProviderName; model: string } | null,
): { provider: ProviderName; model: string } {
  if (row.branch_provider !== null && row.branch_model !== null) {
    return {
      provider: row.branch_provider as ProviderName,
      model: row.branch_model,
    };
  }

  if (row.branch_provider === null && row.branch_model !== null) {
    return {
      provider: branchDefaults?.provider ?? "claude",
      model: row.branch_model,
    };
  }

  if (row.branch_provider !== null) {
    const provider = row.branch_provider as ProviderName;
    if (provider === "opencode") {
      return branchDefaults?.provider === "opencode"
        ? branchDefaults
        : {
            provider: "claude",
            model: resolveProviderDefaultModel("claude") ?? "sonnet",
          };
    }

    return {
      provider,
      model:
        resolveProviderDefaultModel(provider) ??
        branchDefaults?.model ??
        resolveProviderDefaultModel("claude") ??
        "sonnet",
    };
  }

  return branchDefaults ?? { provider: "claude", model: "sonnet" };
}

function rowsToConnections(canvasId: string, rows: ConnectionRow[]): Connection[] {
  const fallbackSourcePodIds = Array.from(
    new Set(
      rows
        .filter((row) => row.branch_provider === null || row.branch_model === null)
        .map((row) => row.source_pod_id),
    ),
  );
  const sourcePods = podStore.getByIds(canvasId, fallbackSourcePodIds);

  return rows.map((row) =>
    rowToConnection(
      row,
      row.branch_provider === null || row.branch_model === null
        ? (sourcePods.get(row.source_pod_id) ?? null)
        : undefined,
    ),
  );
}

function resolveProviderDefaultModel(provider: ProviderName): string | undefined {
  const defaultModel = (getProvider(provider).metadata.defaultOptions as {
    model?: unknown;
  }).model;
  return typeof defaultModel === "string" && defaultModel.trim()
    ? defaultModel
    : undefined;
}

function resolveBranchDefaults(
  row: ConnectionRow,
  preloadedSourcePod?: Pod | null,
): {
  provider: ProviderName;
  model: string;
} {
  const sourcePod =
    preloadedSourcePod === undefined
      ? podStore.getById(row.canvas_id, row.source_pod_id)
      : preloadedSourcePod;
  const provider = sourcePod?.provider ?? "claude";
  const sourceModel =
    typeof sourcePod?.providerConfig?.model === "string" &&
    sourcePod.providerConfig.model.trim().length > 0
      ? sourcePod.providerConfig.model
      : undefined;
  if (provider === "opencode") {
    if (sourceModel) {
      return { provider, model: sourceModel };
    }
    return {
      provider: "claude",
      model: resolveProviderDefaultModel("claude") ?? "sonnet",
    };
  }

  const model = resolveProviderDefaultModel(provider);
  if (model) {
    return { provider, model };
  }

  return {
    provider: "claude",
    model: resolveProviderDefaultModel("claude") ?? "sonnet",
  };
}

class ConnectionStore {
  private get stmts(): ReturnType<typeof getStatements>["connection"] {
    return getStatements(getDb()).connection;
  }

  create(canvasId: string, data: CreateConnectionData): Connection {
    const id = uuidv4();

    // 決定摘要用 provider：客戶端指定 > sourcePod.provider > defensive fallback "claude"
    const sourcePod = podStore.getById(canvasId, data.sourcePodId);
    const resolvedSummaryProvider: ProviderName =
      data.summaryProvider ?? sourcePod?.provider ?? "claude";

    const providerMeta = getProvider(resolvedSummaryProvider).metadata;
    const defaultModel =
      (providerMeta.defaultOptions as { model?: string }).model ?? "sonnet";

    let resolvedSummaryModel: string;
    if (!data.summaryModel) {
      // 客戶端未帶 summaryModel：使用 resolvedSummaryProvider 的預設模型
      resolvedSummaryModel = defaultModel;
    } else {
      validateProviderModel(
        resolvedSummaryProvider,
        data.summaryModel,
        "summaryModel",
      );
      resolvedSummaryModel = data.summaryModel;
    }

    const resolvedBranchProvider =
      data.branchProvider ?? sourcePod?.provider ?? "claude";
    let resolvedBranchModel = data.branchModel ?? null;
    if (data.branchProvider !== undefined && data.branchModel === undefined) {
      resolvedBranchModel =
        resolveProviderDefaultModel(resolvedBranchProvider) ?? null;
    }
    if (resolvedBranchModel !== null) {
      validateProviderModel(
        resolvedBranchProvider,
        resolvedBranchModel,
        "branchModel",
      );
    }

    // branch 模式下驗證 label
    const triggerMode = data.triggerMode ?? "auto";
    if (triggerMode === "branch") {
      const trimmedLabel = (data.label ?? "").trim();
      if (!trimmedLabel) {
        throw new Error("label 必填");
      }
      if (trimmedLabel.toLowerCase() === "none") {
        throw new Error("label 不可為保留字 None");
      }
      // 同一 source 內 label 唯一性檢查
      const existing = this.findBySourcePodId(canvasId, data.sourcePodId);
      const isDuplicate = existing.some(
        (conn) =>
          conn.triggerMode === "branch" &&
          conn.label.toLowerCase() === trimmedLabel.toLowerCase(),
      );
      if (isDuplicate) {
        throw new Error("label 已存在於同一組 branch");
      }
    }

    this.stmts.insert.run({
      $id: id,
      $canvasId: canvasId,
      $sourcePodId: data.sourcePodId,
      $sourceAnchor: data.sourceAnchor,
      $targetPodId: data.targetPodId,
      $targetAnchor: data.targetAnchor,
      $triggerMode: triggerMode,
      $decideStatus: "none",
      $decideReason: null,
      $connectionStatus: "idle",
      $summaryModel: resolvedSummaryModel,
      // DB 儲存客戶端原意：未指定存 NULL，不把 sourcePod.provider 寫入
      $summaryProvider: data.summaryProvider ?? null,
      $label: data.label ?? "",
      $description: data.description ?? null,
      $branchProvider: data.branchProvider ?? null,
      $branchModel: resolvedBranchModel,
    });

    return this.getById(canvasId, id) as Connection;
  }

  getById(canvasId: string, id: string): Connection | undefined {
    const row = this.stmts.selectById.get(canvasId, id) as
      | ConnectionRow
      | undefined;
    if (!row) return undefined;
    return rowToConnection(row);
  }

  list(canvasId: string): Connection[] {
    const rows = this.stmts.selectByCanvasId.all(canvasId) as ConnectionRow[];
    return rowsToConnections(canvasId, rows);
  }

  delete(canvasId: string, id: string): boolean {
    const result = this.stmts.deleteById.run(canvasId, id);
    return result.changes > 0;
  }

  findByPodId(canvasId: string, podId: string): Connection[] {
    const rows = this.stmts.selectByPodId.all({
      $canvasId: canvasId,
      $podId: podId,
    }) as ConnectionRow[];
    return rowsToConnections(canvasId, rows);
  }

  findBySourcePodId(canvasId: string, sourcePodId: string): Connection[] {
    const rows = this.stmts.selectBySourcePodId.all({
      $canvasId: canvasId,
      $sourcePodId: sourcePodId,
    }) as ConnectionRow[];
    return rowsToConnections(canvasId, rows);
  }

  findByTargetPodId(canvasId: string, targetPodId: string): Connection[] {
    const rows = this.stmts.selectByTargetPodId.all({
      $canvasId: canvasId,
      $targetPodId: targetPodId,
    }) as ConnectionRow[];
    return rowsToConnections(canvasId, rows);
  }

  update(
    canvasId: string,
    id: string,
    updates: Partial<{
      triggerMode: TriggerMode;
      decideStatus: DecideStatus;
      decideReason: string | null;
      /** summaryModel 接受任意非空模型名稱 */
      summaryModel: string;
      /**
       * summaryProvider 可明確設為 null（清除指定，讓執行端 fallback），
       * 或指定新 provider；undefined 表示本次不修改。
       */
      summaryProvider: ProviderName | null;
      label: string;
      description: string | null;
      branchProvider: ProviderName | null;
      branchModel: string | null;
    }>,
  ): Connection | undefined {
    const existing = this.getById(canvasId, id);
    if (!existing) return undefined;

    let newTriggerMode = existing.triggerMode;
    let newDecideStatus = existing.decideStatus;
    let newDecideReason = existing.decideReason;
    let newConnectionStatus = existing.connectionStatus;
    let newSummaryModel = existing.summaryModel;
    // summaryProvider 寫回 DB：以 updates.summaryProvider 為準（沒提供就保留既有值）
    let newSummaryProvider: ProviderName | null =
      updates.summaryProvider !== undefined
        ? updates.summaryProvider
        : existing.summaryProvider;
    let newLabel = existing.label;
    let newDescription: string | null = existing.description ?? null;
    let newBranchProvider: ProviderName | null = existing.branchProvider;
    let newBranchModel: string | null = existing.branchModel ?? null;

    if (updates.triggerMode !== undefined) {
      if (shouldResetDecideState(existing.triggerMode, updates.triggerMode)) {
        newDecideStatus = "none";
        newDecideReason = null;
        newConnectionStatus = "idle";
      }
      // 切換離開 branch 時清空 branch 相關欄位
      if (
        existing.triggerMode === "branch" &&
        updates.triggerMode !== "branch"
      ) {
        newLabel = "";
        newDescription = null;
        newBranchProvider = null;
        newBranchModel = null;
      }
      newTriggerMode = updates.triggerMode;
    }

    if (updates.decideStatus !== undefined) {
      newDecideStatus = updates.decideStatus;
    }

    if (updates.decideReason !== undefined) {
      newDecideReason = updates.decideReason;
    }

    // 決定摘要 provider（用於驗證 summaryModel 合法性）
    const sourcePod = podStore.getById(canvasId, existing.sourcePodId);
    const targetSummaryProvider: ProviderName =
      updates.summaryProvider !== undefined
        ? // 客戶端明確指定（含 null 的情況：null 時 fallback 至 sourcePod.provider 或 "claude"）
          (updates.summaryProvider ?? sourcePod?.provider ?? "claude")
        : // 本次未提供 summaryProvider：沿用既有值（或 fallback）
          (existing.summaryProvider ?? sourcePod?.provider ?? "claude");

    if (
      updates.summaryProvider !== undefined &&
      updates.summaryModel === undefined
    ) {
      // 情境三：只切換 provider，未同時指定 model → 重設為新 provider 的預設模型
      const providerMeta = getProvider(targetSummaryProvider).metadata;
      newSummaryModel =
        (providerMeta.defaultOptions as { model?: string }).model ?? "sonnet";
    } else if (updates.summaryModel !== undefined) {
      // 有明確提供 summaryModel：驗證合法性，不合法直接拒絕，不再寫入時 silent fallback
      validateProviderModel(
        targetSummaryProvider,
        updates.summaryModel,
        "summaryModel",
      );
      newSummaryModel = updates.summaryModel;
    }

    const targetMode = updates.triggerMode ?? existing.triggerMode;
    const effectiveLabel = updates.label ?? existing.label;
    if (targetMode === "branch") {
      const trimmedLabel = effectiveLabel.trim();
      if (!trimmedLabel) {
        throw new Error("label 必填");
      }
      if (trimmedLabel.toLowerCase() === "none") {
        throw new Error("label 不可為保留字 None");
      }
      const siblings = this.findBySourcePodId(canvasId, existing.sourcePodId);
      const isDuplicate = siblings.some(
        (conn) =>
          conn.id !== id &&
          conn.triggerMode === "branch" &&
          conn.label.toLowerCase() === trimmedLabel.toLowerCase(),
      );
      if (isDuplicate) {
        throw new Error("label 已存在於同一組 branch");
      }
    }

    if (updates.label !== undefined && targetMode === "branch") {
      newLabel = updates.label;
    }

    if (updates.description !== undefined) {
      newDescription = updates.description;
    }

    if (updates.branchProvider !== undefined) {
      newBranchProvider = updates.branchProvider;
      if (updates.branchProvider === null) {
        newBranchModel = null;
      } else if (updates.branchModel === undefined) {
        newBranchModel =
          resolveProviderDefaultModel(updates.branchProvider) ?? newBranchModel;
      }
    }

    if (updates.branchModel !== undefined) {
      newBranchModel = updates.branchModel;
    }

    if (newBranchProvider !== null && newBranchModel !== null) {
      validateProviderModel(newBranchProvider, newBranchModel, "branchModel");
    }

    const updatedRow = this.stmts.updateReturning.get({
      $canvasId: canvasId,
      $id: id,
      $sourcePodId: existing.sourcePodId,
      $sourceAnchor: existing.sourceAnchor,
      $targetPodId: existing.targetPodId,
      $targetAnchor: existing.targetAnchor,
      $triggerMode: newTriggerMode,
      $decideStatus: newDecideStatus,
      $decideReason: newDecideReason,
      $connectionStatus: newConnectionStatus,
      $summaryModel: newSummaryModel,
      $summaryProvider: newSummaryProvider,
      $label: newLabel,
      $description: newDescription,
      $branchProvider: newBranchProvider,
      $branchModel: newBranchModel,
    }) as ConnectionRow | undefined;

    if (!updatedRow) return undefined;
    return rowToConnection(updatedRow);
  }

  updateConnectionStatus(
    canvasId: string,
    connectionId: string,
    status: ConnectionStatus,
  ): Connection | undefined {
    const updatedRow = this.stmts.updateConnectionStatusReturning.get({
      $canvasId: canvasId,
      $id: connectionId,
      $connectionStatus: status,
    }) as ConnectionRow | undefined;

    if (!updatedRow) return undefined;
    return rowToConnection(updatedRow);
  }

  updateDecideStatus(
    canvasId: string,
    connectionId: string,
    status: DecideStatus,
    reason: string | null,
  ): Connection | undefined {
    return this.update(canvasId, connectionId, {
      decideStatus: status,
      decideReason: reason,
    });
  }

  deleteByPodId(canvasId: string, podId: string): number {
    const result = this.stmts.deleteByPodId.run({
      $canvasId: canvasId,
      $podId: podId,
    });
    return result.changes;
  }

  clearDecideStatusByPodId(canvasId: string, podId: string): void {
    this.stmts.clearDecideStatusByPodId.run({
      $canvasId: canvasId,
      $podId: podId,
    });
  }

  findByTriggerMode(
    canvasId: string,
    sourcePodId: string,
    triggerMode: TriggerMode,
  ): Connection[] {
    const rows = this.stmts.selectByTriggerMode.all({
      $canvasId: canvasId,
      $sourcePodId: sourcePodId,
      $triggerMode: triggerMode,
    }) as ConnectionRow[];
    return rowsToConnections(canvasId, rows);
  }

  /** 取得某 source Pod 出去且 triggerMode === "branch" 的所有連線（per-source branch group） */
  findBranchGroup(canvasId: string, sourcePodId: string): Connection[] {
    return this.findByTriggerMode(canvasId, sourcePodId, "branch");
  }
}

export const connectionStore = new ConnectionStore();
