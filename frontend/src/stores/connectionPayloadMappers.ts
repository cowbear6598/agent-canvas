import type {
  AnchorPosition,
  Connection,
  ConnectionBaseMode,
} from "@/types/connection";
import type { PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { normalizePodProvider } from "@/lib/providerOptions";
import type {
  ConnectionPayloadItem,
  ConnectionUpdatedPayload,
} from "@/types/websocket";

export interface RawConnection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: ConnectionBaseMode | "direct";
  direct?: boolean;
  summaryModel?: string;
  summaryProvider?: PodProvider | null;
  summaryThinkingLevel?: string | null;
  label?: string;
  description?: string;
}

function normalizeOptionalLabel(label?: string): string | undefined {
  return label === "" ? undefined : label;
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

function normalizeConnectionMode(
  raw: Pick<RawConnection, "triggerMode" | "direct">,
): Pick<Connection, "triggerMode" | "direct"> {
  if (raw.triggerMode === "direct") {
    return {
      triggerMode: "auto",
      direct: raw.direct ?? true,
    };
  }

  return {
    triggerMode: raw.triggerMode ?? "auto",
    direct: raw.direct ?? false,
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
  const normalizedMode = normalizeConnectionMode(raw);

  return {
    ...raw,
    triggerMode: normalizedMode.triggerMode,
    direct: normalizedMode.direct,
    summaryModel: normalizedSummary.summaryModel,
    summaryProvider: normalizedSummary.summaryProvider,
    summaryThinkingLevel: raw.summaryThinkingLevel ?? null,
    label: normalizeOptionalLabel(raw.label),
    description: raw.description,
  };
}

function normalizeUpdatedConnectionMode(
  connection: ConnectionPayloadItem,
  existingConnection: Connection,
): Pick<Connection, "triggerMode" | "direct"> {
  if (connection.triggerMode === "direct") {
    return {
      triggerMode: existingConnection.triggerMode,
      direct: connection.direct ?? true,
    };
  }

  return {
    triggerMode: connection.triggerMode ?? existingConnection.triggerMode,
    direct: connection.direct ?? existingConnection.direct,
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

export function normalizeConnectionUpdateResponsePayload(
  payload: ConnectionUpdatedPayload,
): ConnectionPayloadItem[] {
  if (payload.connections?.length) return payload.connections;
  if (payload.connection) return [payload.connection];
  return [];
}

export function normalizeCreatedConnectionEvent(
  connection: Connection,
  sourceProvider?: PodProvider,
): Connection {
  const normalizedConnection = normalizeConnection(
    connection as RawConnection,
    sourceProvider,
  );

  return normalizedConnection;
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
  const normalizedMode = normalizeUpdatedConnectionMode(
    connection,
    existingConnection,
  );

  return {
    ...existingConnection,
    id: connection.id,
    sourcePodId: connection.sourcePodId ?? existingConnection.sourcePodId,
    sourceAnchor: connection.sourceAnchor,
    targetPodId: connection.targetPodId,
    targetAnchor: connection.targetAnchor,
    triggerMode: normalizedMode.triggerMode,
    direct: normalizedMode.direct,
    summaryModel: normalizedSummary.summaryModel,
    summaryProvider: normalizedSummary.summaryProvider,
    summaryThinkingLevel:
      connection.summaryThinkingLevel !== undefined
        ? connection.summaryThinkingLevel
        : existingConnection.summaryThinkingLevel,
    label: normalizeOptionalLabel(connection.label),
    description: connection.description,
  };
}
