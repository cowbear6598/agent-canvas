import type {
  AnchorPosition,
  Connection,
  ConnectionBaseTriggerMode,
  Pod,
} from "../../types/index.js";
import type { ProviderName } from "../provider/index.js";

export interface ConnectionRow {
  id: string;
  canvas_id: string;
  source_pod_id: string;
  source_anchor: string;
  target_pod_id: string;
  target_anchor: string;
  trigger_mode: string;
  summary_model: string;
  summary_provider: string | null;
  summary_thinking_level: string | null;
  direct_enabled: number | null;
  label: string;
  description: string | null;
}

export function needsBranchDefaults(row: ConnectionRow): boolean {
  return row.summary_provider === null;
}

function resolveConnectionLineProvider(
  row: ConnectionRow,
  sourcePod?: Pod | null,
): ProviderName {
  return (row.summary_provider as ProviderName | null) ?? sourcePod?.provider ?? "claude";
}

function normalizeTriggerMode(
  row: Pick<ConnectionRow, "trigger_mode">,
): ConnectionBaseTriggerMode {
  return row.trigger_mode === "branch" ? "branch" : "auto";
}

export function rowToConnection(
  row: ConnectionRow,
  sourcePod?: Pod | null,
): Connection {
  const resolvedLineProvider = resolveConnectionLineProvider(row, sourcePod);

  return {
    id: row.id,
    sourcePodId: row.source_pod_id,
    sourceAnchor: row.source_anchor as AnchorPosition,
    targetPodId: row.target_pod_id,
    targetAnchor: row.target_anchor as AnchorPosition,
    triggerMode: normalizeTriggerMode(row),
    direct: row.direct_enabled === 1 || row.trigger_mode === "direct",
    summaryModel: row.summary_model,
    summaryProvider: row.summary_provider as ProviderName | null,
    summaryThinkingLevel: row.summary_thinking_level,
    label: row.label,
    description: row.description ?? undefined,
    branchProvider: resolvedLineProvider,
    branchModel: row.summary_model,
    branchThinkingLevel: row.summary_thinking_level,
  };
}

export function getBranchFallbackSourcePodIds(rows: ConnectionRow[]): string[] {
  return Array.from(
    new Set(
      rows.filter(needsBranchDefaults).map((row) => row.source_pod_id),
    ),
  );
}
