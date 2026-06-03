import type {
  AnchorPosition,
  Connection,
  ConnectionStatus,
  DecideStatus,
  Pod,
  TriggerMode,
} from "../../types/index.js";
import type { ProviderName } from "../provider/index.js";
import {
  resolveBranchDefaults,
  resolveProviderDefaultModel,
} from "./connectionPolicy.js";

export interface ConnectionRow {
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
  summary_provider: string | null;
  summary_thinking_level: string | null;
  label: string;
  description: string | null;
  branch_provider: string | null;
  branch_model: string | null;
  branch_thinking_level: string | null;
}

export function needsBranchDefaults(row: ConnectionRow): boolean {
  return row.branch_provider === null || row.branch_model === null;
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

export function rowToConnection(
  row: ConnectionRow,
  sourcePod?: Pod | null,
): Connection {
  const branchDefaults = needsBranchDefaults(row)
    ? resolveBranchDefaults(sourcePod)
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
    summaryProvider: row.summary_provider as ProviderName | null,
    summaryThinkingLevel: row.summary_thinking_level,
    label: row.label,
    description: row.description ?? undefined,
    branchProvider: resolvedBranchProvider,
    branchModel: resolvedBranchModel,
    branchThinkingLevel: row.branch_thinking_level,
  };
}

export function getBranchFallbackSourcePodIds(rows: ConnectionRow[]): string[] {
  return Array.from(
    new Set(
      rows.filter(needsBranchDefaults).map((row) => row.source_pod_id),
    ),
  );
}
