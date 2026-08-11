import { v4 as uuidv4 } from "uuid";
import type {
  Connection,
  AnchorPosition,
  TriggerMode,
  DecideStatus,
  ConnectionStatus,
  Pod,
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
  direct?: boolean;
  label?: string;
  description?: string;
  branchProvider?: ProviderName;
  branchModel?: string;
  branchThinkingLevel?: string | null;
}

type ConnectionUpdateData = Partial<{
  triggerMode: TriggerMode;
  decideStatus: DecideStatus;
  decideReason: string | null;
  /** summaryModel 接受任意非空模型名稱 */
  summaryModel: string;
  /** null 代表清除指定 provider；undefined 代表本次不修改 */
  summaryProvider: ProviderName | null;
  summaryThinkingLevel: string | null;
  direct: boolean;
  label: string;
  description: string | null;
  branchProvider: ProviderName | null;
  branchModel: string | null;
  branchThinkingLevel: string | null;
}>;

interface ConnectionUpdateOptions {
  skipBranchLabelValidation?: boolean;
}

type ConnectionUpdateState = Pick<
  UpdateConnectionRowInput,
  | "triggerMode"
  | "decideStatus"
  | "decideReason"
  | "connectionStatus"
  | "summaryModel"
  | "summaryProvider"
  | "summaryThinkingLevel"
  | "direct"
  | "label"
  | "description"
  | "branchProvider"
  | "branchModel"
  | "branchThinkingLevel"
>;

function normalizeDirectMode(input: {
  triggerMode?: TriggerMode;
  direct?: boolean;
}): { triggerMode: Connection["triggerMode"]; direct: boolean } {
  if (input.triggerMode === "direct") {
    return { triggerMode: "auto", direct: true };
  }

  return {
    triggerMode: input.triggerMode === "branch" ? "branch" : "auto",
    direct: input.direct ?? false,
  };
}

function normalizeTriggerMode(
  triggerMode: TriggerMode,
): Connection["triggerMode"] {
  return triggerMode === "direct" ? "auto" : triggerMode;
}

function createConnectionUpdateState(
  existing: Connection,
): ConnectionUpdateState {
  return {
    triggerMode: existing.triggerMode,
    decideStatus: existing.decideStatus,
    decideReason: existing.decideReason,
    connectionStatus: existing.connectionStatus,
    summaryModel: existing.summaryModel,
    summaryProvider: existing.summaryProvider,
    summaryThinkingLevel: existing.summaryThinkingLevel,
    direct: existing.direct,
    label: existing.label,
    description: existing.description ?? null,
    branchProvider: existing.branchProvider,
    branchModel: existing.branchModel ?? null,
    branchThinkingLevel: existing.branchThinkingLevel,
  };
}

function applyModeAndDecisionUpdates(
  state: ConnectionUpdateState,
  existing: Connection,
  updates: ConnectionUpdateData,
): void {
  if (updates.triggerMode !== undefined) {
    const triggerMode = normalizeTriggerMode(updates.triggerMode);
    if (shouldResetDecideState(existing.triggerMode, triggerMode)) {
      state.decideStatus = "none";
      state.decideReason = null;
      state.connectionStatus = "idle";
    }

    if (existing.triggerMode === "branch" && triggerMode !== "branch") {
      state.label = "";
      state.description = null;
      state.branchProvider = null;
      state.branchModel = null;
      state.branchThinkingLevel = null;
    }

    state.triggerMode = triggerMode;
    state.direct =
      updates.triggerMode === "direct" ? true : updates.direct ?? false;
  }

  if (updates.direct !== undefined) state.direct = updates.direct;
  if (updates.decideStatus !== undefined) {
    state.decideStatus = updates.decideStatus;
  }
  if (updates.decideReason !== undefined) {
    state.decideReason = updates.decideReason;
  }
}

function resolveTargetSummaryProvider(
  existing: Connection,
  sourcePod: Pod | undefined,
  updates: ConnectionUpdateData,
): ProviderName {
  const configuredProvider =
    updates.summaryProvider !== undefined
      ? updates.summaryProvider
      : existing.summaryProvider;
  return configuredProvider ?? sourcePod?.provider ?? "claude";
}

function shouldResetThinkingLevel(
  thinkingLevel: string | null | undefined,
  providerChanged: boolean,
  modelChanged: boolean,
): boolean {
  return thinkingLevel === undefined && (providerChanged || modelChanged);
}

function applySummaryUpdates(
  state: ConnectionUpdateState,
  existing: Connection,
  sourcePod: Pod | undefined,
  updates: ConnectionUpdateData,
): void {
  if (updates.summaryProvider !== undefined) {
    state.summaryProvider = updates.summaryProvider;
  }
  if (updates.summaryThinkingLevel !== undefined) {
    state.summaryThinkingLevel = updates.summaryThinkingLevel;
  }

  const provider = resolveTargetSummaryProvider(existing, sourcePod, updates);
  if (
    updates.summaryProvider !== undefined &&
    updates.summaryModel === undefined
  ) {
    const providerMeta = getProvider(provider).metadata;
    state.summaryModel =
      (providerMeta.defaultOptions as { model?: string }).model ?? "sonnet";
  } else if (updates.summaryModel !== undefined) {
    validateProviderModel(provider, updates.summaryModel, "summaryModel");
    state.summaryModel = updates.summaryModel;
  }

  if (
    shouldResetThinkingLevel(
      updates.summaryThinkingLevel,
      updates.summaryProvider !== undefined,
      updates.summaryModel !== undefined,
    )
  ) {
    state.summaryThinkingLevel = getDefaultThinkingLevel(
      provider,
      state.summaryModel,
    );
  }

  validateConnectionThinkingLevel(
    provider,
    state.summaryModel,
    state.summaryThinkingLevel,
    "summaryThinkingLevel",
  );
}

function validateBranchModel(state: ConnectionUpdateState): void {
  if (state.branchProvider !== null && state.branchModel !== null) {
    validateProviderModel(
      state.branchProvider,
      state.branchModel,
      "branchModel",
    );
  }
}

function validateBranchThinkingLevel(state: ConnectionUpdateState): void {
  if (state.branchProvider !== null) {
    validateConnectionThinkingLevel(
      state.branchProvider,
      state.branchModel,
      state.branchThinkingLevel,
      "branchThinkingLevel",
    );
    return;
  }

  if (state.branchThinkingLevel !== null) {
    throw new Error("branchThinkingLevel 不支援指定的 provider/model");
  }
}

function applyBranchUpdates(
  state: ConnectionUpdateState,
  updates: ConnectionUpdateData,
): void {
  if (updates.branchProvider !== undefined) {
    state.branchProvider = updates.branchProvider;
    if (updates.branchProvider === null) {
      state.branchModel = null;
    } else if (updates.branchModel === undefined) {
      state.branchModel =
        resolveProviderDefaultModel(updates.branchProvider) ?? state.branchModel;
    }
  }

  if (updates.branchModel !== undefined) {
    state.branchModel = updates.branchModel;
  }
  if (updates.branchThinkingLevel !== undefined) {
    state.branchThinkingLevel = updates.branchThinkingLevel;
  }

  validateBranchModel(state);

  if (
    shouldResetThinkingLevel(
      updates.branchThinkingLevel,
      updates.branchProvider !== undefined,
      updates.branchModel !== undefined,
    )
  ) {
    state.branchThinkingLevel =
      state.branchProvider !== null && state.branchModel !== null
        ? getDefaultThinkingLevel(state.branchProvider, state.branchModel)
        : null;
  }

  validateBranchThinkingLevel(state);
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
    const normalizedMode = normalizeDirectMode(data);

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
    if (normalizedMode.triggerMode === "branch") {
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
      triggerMode: normalizedMode.triggerMode,
      direct: normalizedMode.direct,
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

    const createdConnection = this.getById(canvasId, id);
    if (!createdConnection) {
      throw new Error("建立連線後找不到連線資料");
    }
    return createdConnection;
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
    updates: ConnectionUpdateData,
    options?: ConnectionUpdateOptions,
  ): Connection | undefined {
    const existing = this.getById(canvasId, id);
    if (!existing) return undefined;

    const state = createConnectionUpdateState(existing);
    applyModeAndDecisionUpdates(state, existing, updates);

    const sourcePod = podStore.getById(canvasId, existing.sourcePodId);
    applySummaryUpdates(state, existing, sourcePod, updates);

    if (
      state.triggerMode === "branch" &&
      !options?.skipBranchLabelValidation
    ) {
      validateBranchLabel(
        updates.label ?? existing.label,
        this.findBySourcePodId(canvasId, existing.sourcePodId),
        id,
      );
    }

    if (updates.label !== undefined && state.triggerMode === "branch") {
      state.label = updates.label;
    }
    if (updates.description !== undefined) {
      state.description = updates.description;
    }
    applyBranchUpdates(state, updates);

    const updatedRow = this.repository.updateReturning({
      id,
      canvasId,
      sourcePodId: existing.sourcePodId,
      sourceAnchor: existing.sourceAnchor,
      targetPodId: existing.targetPodId,
      targetAnchor: existing.targetAnchor,
      ...state,
    } satisfies UpdateConnectionRowInput);

    if (!updatedRow) return undefined;
    return this.mapRow(canvasId, updatedRow);
  }

  updateBranchSiblingSettings(
    canvasId: string,
    id: string,
    updates: ConnectionUpdateData,
  ):
    | { targetConnection: Connection; updatedConnections: Connection[] }
    | undefined {
    const existing = this.getById(canvasId, id);
    if (!existing) return undefined;

    const targetMode =
      updates.triggerMode !== undefined
        ? updates.triggerMode === "direct"
          ? "auto"
          : updates.triggerMode
        : existing.triggerMode;
    const shouldSyncBranchSiblings =
      targetMode === "branch" && updates.direct !== undefined;

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

    validateBranchLabel(
      updates.label ?? existing.label,
      this.findBySourcePodId(canvasId, existing.sourcePodId),
      id,
    );

    const branchUpdates: Partial<{ direct: boolean }> = {
      direct: updates.direct,
    };

    const syncBranchSiblings = getDb().transaction(() => {
      const updatedConnections: Connection[] = [];
      const targetConnection = this.update(canvasId, id, updates, {
        skipBranchLabelValidation: true,
      });
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
          {
            skipBranchLabelValidation: true,
          },
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
