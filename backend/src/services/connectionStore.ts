import { v4 as uuidv4 } from "uuid";
import type {
  Connection,
  AnchorPosition,
  TriggerMode,
  DecideStatus,
  ConnectionStatus,
} from "../types";
import { getDb } from "../database/index.js";
import { getProvider, type ProviderName } from "./provider/index.js";
import {
  getDefaultThinkingLevel,
} from "./pod/providerConfigResolver.js";
import { podStore } from "./podStore.js";
import {
  ConnectionRepository,
  type UpdateConnectionRowInput,
} from "./connection/connectionRepository.js";
import type { ConnectionRow } from "./connection/connectionRowMapper.js";
import {
  getBranchFallbackSourcePodIds,
  needsBranchDefaults,
  rowToConnection,
} from "./connection/connectionRowMapper.js";
import {
  resolveBranchThinkingModel,
  resolveConnectionThinkingLevel,
  resolveProviderDefaultModel,
  shouldResetDecideState,
  validateBranchLabel,
  validateConnectionThinkingLevel,
  validateProviderModel,
} from "./connection/connectionPolicy.js";

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
  summaryThinkingLevel?: string | null;
  label?: string;
  description?: string;
  branchProvider?: ProviderName;
  branchModel?: string;
  branchThinkingLevel?: string | null;
}

class ConnectionStore {
  private readonly repository = new ConnectionRepository();

  private mapRow(canvasId: string, row: ConnectionRow): Connection {
    const sourcePod = needsBranchDefaults(row)
      ? (podStore.getById(canvasId, row.source_pod_id) ?? null)
      : undefined;
    return rowToConnection(row, sourcePod);
  }

  private mapRows(canvasId: string, rows: ConnectionRow[]): Connection[] {
    const sourcePods = podStore.getByIds(
      canvasId,
      getBranchFallbackSourcePodIds(rows),
    );
    return rows.map((row) =>
      rowToConnection(
        row,
        needsBranchDefaults(row)
          ? (sourcePods.get(row.source_pod_id) ?? null)
          : undefined,
      ),
    );
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

    const resolvedSummaryThinkingLevel =
      data.summaryThinkingLevel !== undefined
        ? data.summaryThinkingLevel
        : resolveConnectionThinkingLevel(
            sourcePod,
            resolvedSummaryProvider,
            resolvedSummaryModel,
          );
    validateConnectionThinkingLevel(
      resolvedSummaryProvider,
      resolvedSummaryModel,
      resolvedSummaryThinkingLevel,
      "summaryThinkingLevel",
    );

    const resolvedBranchThinkingLevel =
      data.branchThinkingLevel !== undefined
        ? data.branchThinkingLevel
        : resolveConnectionThinkingLevel(
            sourcePod,
            resolvedBranchProvider,
            resolveBranchThinkingModel(
              sourcePod,
              resolvedBranchProvider,
              resolvedBranchModel,
            ),
          );
    validateConnectionThinkingLevel(
      resolvedBranchProvider,
      resolveBranchThinkingModel(
        sourcePod,
        resolvedBranchProvider,
        resolvedBranchModel,
      ),
      resolvedBranchThinkingLevel,
      "branchThinkingLevel",
    );

    // branch 模式下驗證 label
    const triggerMode = data.triggerMode ?? "auto";
    if (triggerMode === "branch") {
      validateBranchLabel(
        data.label ?? "",
        this.findBySourcePodId(canvasId, data.sourcePodId),
      );
    }

    this.repository.insert({
      id,
      canvasId,
      sourcePodId: data.sourcePodId,
      sourceAnchor: data.sourceAnchor,
      targetPodId: data.targetPodId,
      targetAnchor: data.targetAnchor,
      triggerMode,
      decideStatus: "none",
      decideReason: null,
      connectionStatus: "idle",
      summaryModel: resolvedSummaryModel,
      summaryProvider: data.summaryProvider ?? null,
      summaryThinkingLevel: resolvedSummaryThinkingLevel,
      label: data.label ?? "",
      description: data.description ?? null,
      branchProvider: data.branchProvider ?? null,
      branchModel: resolvedBranchModel,
      branchThinkingLevel: resolvedBranchThinkingLevel,
    });

    return this.getById(canvasId, id) as Connection;
  }

  getById(canvasId: string, id: string): Connection | undefined {
    const row = this.repository.getById(canvasId, id);
    if (!row) return undefined;
    return this.mapRow(canvasId, row);
  }

  list(canvasId: string): Connection[] {
    return this.mapRows(canvasId, this.repository.list(canvasId));
  }

  delete(canvasId: string, id: string): boolean {
    return this.repository.delete(canvasId, id);
  }

  findByPodId(canvasId: string, podId: string): Connection[] {
    return this.mapRows(canvasId, this.repository.findByPodId(canvasId, podId));
  }

  findBySourcePodId(canvasId: string, sourcePodId: string): Connection[] {
    return this.mapRows(
      canvasId,
      this.repository.findBySourcePodId(canvasId, sourcePodId),
    );
  }

  findByTargetPodId(canvasId: string, targetPodId: string): Connection[] {
    return this.mapRows(
      canvasId,
      this.repository.findByTargetPodId(canvasId, targetPodId),
    );
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
      summaryThinkingLevel: string | null;
      label: string;
      description: string | null;
      branchProvider: ProviderName | null;
      branchModel: string | null;
      branchThinkingLevel: string | null;
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
    let newSummaryThinkingLevel =
      updates.summaryThinkingLevel !== undefined
        ? updates.summaryThinkingLevel
        : existing.summaryThinkingLevel;
    let newLabel = existing.label;
    let newDescription: string | null = existing.description ?? null;
    let newBranchProvider: ProviderName | null = existing.branchProvider;
    let newBranchModel: string | null = existing.branchModel ?? null;
    let newBranchThinkingLevel =
      updates.branchThinkingLevel !== undefined
        ? updates.branchThinkingLevel
        : existing.branchThinkingLevel;

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
        newBranchThinkingLevel = null;
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
    const shouldResetSummaryThinkingLevel =
      updates.summaryThinkingLevel === undefined &&
      (updates.summaryProvider !== undefined ||
        updates.summaryModel !== undefined);
    if (shouldResetSummaryThinkingLevel) {
      newSummaryThinkingLevel = getDefaultThinkingLevel(
        targetSummaryProvider,
        newSummaryModel,
      );
    }
    validateConnectionThinkingLevel(
      targetSummaryProvider,
      newSummaryModel,
      newSummaryThinkingLevel,
      "summaryThinkingLevel",
    );

    const targetMode = updates.triggerMode ?? existing.triggerMode;
    if (targetMode === "branch") {
      validateBranchLabel(
        updates.label ?? existing.label,
        this.findBySourcePodId(canvasId, existing.sourcePodId),
        id,
      );
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

    if (updates.branchThinkingLevel !== undefined) {
      newBranchThinkingLevel = updates.branchThinkingLevel;
    }

    if (newBranchProvider !== null && newBranchModel !== null) {
      validateProviderModel(newBranchProvider, newBranchModel, "branchModel");
    }
    const shouldResetBranchThinkingLevel =
      updates.branchThinkingLevel === undefined &&
      (updates.branchProvider !== undefined ||
        updates.branchModel !== undefined);
    if (shouldResetBranchThinkingLevel) {
      newBranchThinkingLevel =
        newBranchProvider !== null && newBranchModel !== null
          ? getDefaultThinkingLevel(newBranchProvider, newBranchModel)
          : null;
    }
    if (newBranchProvider !== null) {
      validateConnectionThinkingLevel(
        newBranchProvider,
        newBranchModel,
        newBranchThinkingLevel,
        "branchThinkingLevel",
      );
    } else if (newBranchThinkingLevel !== null) {
      throw new Error("branchThinkingLevel 不支援指定的 provider/model");
    }

    const updatedRow = this.repository.updateReturning({
      id,
      canvasId,
      sourcePodId: existing.sourcePodId,
      sourceAnchor: existing.sourceAnchor,
      targetPodId: existing.targetPodId,
      targetAnchor: existing.targetAnchor,
      triggerMode: newTriggerMode,
      decideStatus: newDecideStatus,
      decideReason: newDecideReason,
      connectionStatus: newConnectionStatus,
      summaryModel: newSummaryModel,
      summaryProvider: newSummaryProvider,
      summaryThinkingLevel: newSummaryThinkingLevel,
      label: newLabel,
      description: newDescription,
      branchProvider: newBranchProvider,
      branchModel: newBranchModel,
      branchThinkingLevel: newBranchThinkingLevel,
    } satisfies UpdateConnectionRowInput);

    if (!updatedRow) return undefined;
    return this.mapRow(canvasId, updatedRow);
  }

  updateBranchSiblingSettings(
    canvasId: string,
    id: string,
    updates: Partial<{
      triggerMode: TriggerMode;
      decideStatus: DecideStatus;
      decideReason: string | null;
      summaryModel: string;
      summaryProvider: ProviderName | null;
      summaryThinkingLevel: string | null;
      label: string;
      description: string | null;
      branchProvider: ProviderName | null;
      branchModel: string | null;
      branchThinkingLevel: string | null;
    }>,
  ):
    | { targetConnection: Connection; updatedConnections: Connection[] }
    | undefined {
    const existing = this.getById(canvasId, id);
    if (!existing) return undefined;

    const targetMode = updates.triggerMode ?? existing.triggerMode;
    const shouldSyncBranchSiblings =
      targetMode === "branch" &&
      (updates.branchProvider !== undefined ||
        updates.branchModel !== undefined ||
        updates.branchThinkingLevel !== undefined);

    if (!shouldSyncBranchSiblings) {
      const targetConnection = this.update(canvasId, id, updates);
      return targetConnection
        ? { targetConnection, updatedConnections: [targetConnection] }
        : undefined;
    }

    const siblingIds = this.findBySourcePodId(canvasId, existing.sourcePodId)
      .filter((connection) => connection.triggerMode === "branch")
      .map((connection) => connection.id);
    const ids = Array.from(new Set([id, ...siblingIds]));

    const branchUpdates: Partial<{
      branchProvider: ProviderName | null;
      branchModel: string | null;
      branchThinkingLevel: string | null;
    }> = {};
    if (updates.branchProvider !== undefined) {
      branchUpdates.branchProvider = updates.branchProvider;
    }
    if (updates.branchModel !== undefined) {
      branchUpdates.branchModel = updates.branchModel;
    }
    if (updates.branchThinkingLevel !== undefined) {
      branchUpdates.branchThinkingLevel = updates.branchThinkingLevel;
    }

    const syncBranchSiblings = getDb().transaction(() => {
      const updatedConnections: Connection[] = [];
      const targetConnection = this.update(canvasId, id, updates);
      if (!targetConnection) {
        throw new Error("找不到要更新的 branch connection");
      }
      updatedConnections.push(targetConnection);

      for (const siblingId of ids) {
        if (siblingId === id) continue;
        const siblingConnection = this.update(
          canvasId,
          siblingId,
          branchUpdates,
        );
        if (!siblingConnection) {
          throw new Error("更新 branch sibling connection 失敗");
        }
        updatedConnections.push(siblingConnection);
      }

      return { targetConnection, updatedConnections };
    });

    return syncBranchSiblings();
  }

  updateConnectionStatus(
    canvasId: string,
    connectionId: string,
    status: ConnectionStatus,
  ): Connection | undefined {
    const updatedRow = this.repository.updateConnectionStatusReturning(
      canvasId,
      connectionId,
      status,
    );

    if (!updatedRow) return undefined;
    return this.mapRow(canvasId, updatedRow);
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
    return this.repository.deleteByPodId(canvasId, podId);
  }

  clearDecideStatusByPodId(canvasId: string, podId: string): void {
    this.repository.clearDecideStatusByPodId(canvasId, podId);
  }

  findByTriggerMode(
    canvasId: string,
    sourcePodId: string,
    triggerMode: TriggerMode,
  ): Connection[] {
    return this.mapRows(
      canvasId,
      this.repository.findByTriggerMode(canvasId, sourcePodId, triggerMode),
    );
  }

  /** 取得某 source Pod 出去且 triggerMode === "branch" 的所有連線（per-source branch group） */
  findBranchGroup(canvasId: string, sourcePodId: string): Connection[] {
    return this.findByTriggerMode(canvasId, sourcePodId, "branch");
  }
}

export const connectionStore = new ConnectionStore();
