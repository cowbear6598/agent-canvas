import type {
  AnchorPosition,
  Connection,
  ConnectionStatus,
  DecideStatus,
  TriggerMode,
} from "@/types/connection";
import type { PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { normalizePodProvider } from "@/lib/providerOptions";
import type { ConnectionPayloadItem } from "@/types/websocket";

export interface RawConnection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: "auto" | "branch" | "direct";
  summaryModel?: string;
  summaryProvider?: PodProvider | null;
  label?: string;
  description?: string;
  branchProvider?: PodProvider;
  branchModel?: string;
  connectionStatus?: string;
  decideReason?: string | null;
  decideStatus?: string;
}

function normalizeLegacySummarySelection(params: {
  summaryModel?: string;
  summaryProvider: PodProvider | null;
}): Pick<Connection, "summaryModel" | "summaryProvider"> {
  const { summaryModel, summaryProvider } = params;

  if (summaryModel?.startsWith("gemini-") === true) {
    return {
      summaryModel: DEFAULT_SUMMARY_MODEL,
      summaryProvider: "claude",
    };
  }

  return {
    summaryModel: summaryModel ?? DEFAULT_SUMMARY_MODEL,
    summaryProvider,
  };
}

export function normalizeConnection(
  raw: RawConnection,
  sourceProvider?: PodProvider,
): Connection {
  const normalizedExplicitProvider =
    raw.summaryProvider == null
      ? null
      : normalizePodProvider(raw.summaryProvider);
  const summaryProvider =
    normalizedExplicitProvider ??
    (normalizePodProvider(sourceProvider ?? "claude") ?? "claude");
  const normalizedSummary = normalizeLegacySummarySelection({
    summaryModel: raw.summaryModel,
    summaryProvider,
  });

  return {
    ...raw,
    triggerMode: (raw.triggerMode ?? "auto") as TriggerMode,
    summaryModel: normalizedSummary.summaryModel,
    summaryProvider: normalizedSummary.summaryProvider,
    label: raw.label,
    description: raw.description,
    branchProvider: raw.branchProvider,
    branchModel: raw.branchModel,
    status: (raw.connectionStatus ?? "idle") as ConnectionStatus,
    decideReason: raw.decideReason ?? undefined,
    decideStatus: (raw.decideStatus as DecideStatus) ?? "none",
  };
}

export function normalizeConnectionListPayload(
  connections: ConnectionPayloadItem[],
  getSourceProvider: (sourcePodId: string) => PodProvider | undefined,
): Connection[] {
  return connections.map((connection) =>
    normalizeConnection(
      connection,
      connection.sourcePodId
        ? getSourceProvider(connection.sourcePodId)
        : undefined,
    ),
  );
}

export function normalizeCreatedConnectionEvent(
  connection: Omit<Connection, "status">,
): Connection {
  const normalizedSummary = normalizeLegacySummarySelection({
    summaryModel: connection.summaryModel,
    summaryProvider:
      normalizePodProvider(connection.summaryProvider ?? "claude") ?? "claude",
  });

  return {
    ...connection,
    summaryModel: normalizedSummary.summaryModel,
    summaryProvider: normalizedSummary.summaryProvider,
    triggerMode: connection.triggerMode ?? "auto",
    status: "idle",
    decideStatus: "none",
  };
}

function resolveSummaryProviderFromUpdatePayload(
  connection: ConnectionPayloadItem,
  existingConnection: Connection,
  getSourceProvider: (sourcePodId: string) => PodProvider | undefined,
): PodProvider | null {
  if (connection.summaryProvider === undefined) {
    return existingConnection.summaryProvider ?? null;
  }

  if (connection.summaryProvider !== null) {
    return normalizePodProvider(connection.summaryProvider) ?? "claude";
  }

  if (!existingConnection.sourcePodId) {
    return "claude";
  }

  return (
    normalizePodProvider(getSourceProvider(existingConnection.sourcePodId)) ??
    "claude"
  );
}

export function mapConnectionUpdatedEventPayload(
  connection: ConnectionPayloadItem,
  existingConnection: Connection,
  getSourceProvider: (sourcePodId: string) => PodProvider | undefined,
): Connection {
  const normalizedSummary = normalizeLegacySummarySelection({
    summaryModel:
      connection.summaryModel ??
      existingConnection.summaryModel ??
      DEFAULT_SUMMARY_MODEL,
    summaryProvider: resolveSummaryProviderFromUpdatePayload(
      connection,
      existingConnection,
      getSourceProvider,
    ),
  });

  return {
    ...existingConnection,
    id: connection.id,
    sourcePodId: connection.sourcePodId ?? existingConnection.sourcePodId,
    sourceAnchor: connection.sourceAnchor,
    targetPodId: connection.targetPodId,
    targetAnchor: connection.targetAnchor,
    triggerMode:
      (connection.triggerMode as TriggerMode) ?? existingConnection.triggerMode,
    summaryModel: normalizedSummary.summaryModel,
    summaryProvider: normalizedSummary.summaryProvider,
    // branch 欄位直接以後端回傳值覆寫（包含 undefined 視為清空）
    label: connection.label,
    description: connection.description,
    branchProvider: connection.branchProvider as PodProvider | undefined,
    branchModel: connection.branchModel,
    // connectionStatus 有帶值則覆寫；未帶則保留既有 status（避免 multi-input rejected 後 status 卡住）
    status: connection.connectionStatus
      ? (connection.connectionStatus as ConnectionStatus)
      : existingConnection.status,
    // decideStatus：incoming 有值則覆寫，undefined 則保留既有值
    decideStatus:
      connection.decideStatus !== undefined
        ? (connection.decideStatus as DecideStatus)
        : existingConnection.decideStatus,
    decideReason: connection.decideReason ?? existingConnection.decideReason,
  };
}
