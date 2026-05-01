import { v4 as uuidv4 } from "uuid";
import type {
  Connection,
  AnchorPosition,
  TriggerMode,
  DecideStatus,
  ConnectionStatus,
  AiDecideModelType,
} from "../types";
import { DEFAULT_AI_DECIDE_MODEL } from "../types/connection.js";
import { getDb } from "../database/index.js";
import { getStatements } from "../database/statements.js";
import {
  getProvider,
  resolveModelWithFallback,
  type ProviderName,
} from "./provider/index.js";
import { podStore } from "./podStore.js";
import { logger } from "../utils/logger.js";

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
  aiDecideModel?: AiDecideModelType;
}

function shouldResetDecideState(oldMode: string, newMode: string): boolean {
  return (
    oldMode === "ai-decide" && (newMode === "auto" || newMode === "direct")
  );
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
  ai_decide_model: string;
}

function rowToConnection(row: ConnectionRow): Connection {
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
    aiDecideModel: row.ai_decide_model as AiDecideModelType,
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
      const { resolved, didFallback } = resolveModelWithFallback(
        resolvedSummaryProvider,
        data.summaryModel,
      );
      if (didFallback) {
        logger.warn(
          "Connection",
          "Warn",
          `[ConnectionStore] summaryModel "${data.summaryModel}" 不在 ${resolvedSummaryProvider} 合法清單內，fallback 到預設模型 "${resolved}"`,
        );
      }
      resolvedSummaryModel = resolved;
    }

    this.stmts.insert.run({
      $id: id,
      $canvasId: canvasId,
      $sourcePodId: data.sourcePodId,
      $sourceAnchor: data.sourceAnchor,
      $targetPodId: data.targetPodId,
      $targetAnchor: data.targetAnchor,
      $triggerMode: data.triggerMode ?? "auto",
      $decideStatus: "none",
      $decideReason: null,
      $connectionStatus: "idle",
      $summaryModel: resolvedSummaryModel,
      // DB 儲存客戶端原意：未指定存 NULL，不把 sourcePod.provider 寫入
      $summaryProvider: data.summaryProvider ?? null,
      $aiDecideModel: data.aiDecideModel ?? DEFAULT_AI_DECIDE_MODEL,
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
    return rows.map(rowToConnection);
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
    return rows.map(rowToConnection);
  }

  findBySourcePodId(canvasId: string, sourcePodId: string): Connection[] {
    const rows = this.stmts.selectBySourcePodId.all({
      $canvasId: canvasId,
      $sourcePodId: sourcePodId,
    }) as ConnectionRow[];
    return rows.map(rowToConnection);
  }

  findByTargetPodId(canvasId: string, targetPodId: string): Connection[] {
    const rows = this.stmts.selectByTargetPodId.all({
      $canvasId: canvasId,
      $targetPodId: targetPodId,
    }) as ConnectionRow[];
    return rows.map(rowToConnection);
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
      aiDecideModel: AiDecideModelType;
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
    let newAiDecideModel = existing.aiDecideModel;

    if (updates.triggerMode !== undefined) {
      if (shouldResetDecideState(existing.triggerMode, updates.triggerMode)) {
        newDecideStatus = "none";
        newDecideReason = null;
        newConnectionStatus = "idle";
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
      // 有明確提供 summaryModel：驗證合法性，不合法則 fallback
      const { resolved, didFallback } = resolveModelWithFallback(
        targetSummaryProvider,
        updates.summaryModel,
      );
      if (didFallback) {
        logger.warn(
          "Connection",
          "Warn",
          `[ConnectionStore] update summaryModel "${updates.summaryModel}" 不在 ${targetSummaryProvider} 合法清單內，fallback 到預設模型 "${resolved}"`,
        );
      }
      newSummaryModel = resolved;
    }

    if (updates.aiDecideModel !== undefined) {
      newAiDecideModel = updates.aiDecideModel;
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
      $aiDecideModel: newAiDecideModel,
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
    return rows.map(rowToConnection);
  }
}

export const connectionStore = new ConnectionStore();
