import type { Connection, PodProvider } from "@/types";
import type {
  ConnectionPayloadItem,
  ConnectionUpdatedPayload,
} from "@/types/websocket";
import {
  mapConnectionUpdatedEventPayload,
  normalizeConnection,
  normalizeConnectionUpdateResponsePayload,
  normalizeCreatedConnectionEvent,
} from "@/stores/connectionPayloadMappers";

type SourceProviderResolver = (sourcePodId: string) => PodProvider | undefined;

export function normalizeUpdatedConnectionItem(
  connection: ConnectionPayloadItem,
  resolveSourceProvider: SourceProviderResolver,
): Connection {
  return normalizeConnection(
    connection,
    connection.sourcePodId
      ? resolveSourceProvider(connection.sourcePodId)
      : undefined,
  );
}

export function syncConnectionUpdateResponse(
  currentConnections: Connection[],
  payload: ConnectionUpdatedPayload,
  resolveSourceProvider: SourceProviderResolver,
): {
  connections: Connection[];
  updatedConnections: Connection[];
} {
  const connectionPayloads = normalizeConnectionUpdateResponsePayload(payload);
  let nextConnections = currentConnections;

  for (const connectionPayload of connectionPayloads) {
    nextConnections = updateConnectionEvent(
      nextConnections,
      connectionPayload,
      resolveSourceProvider,
    );
  }

  return {
    connections: nextConnections,
    updatedConnections: connectionPayloads.map((connection) =>
      normalizeUpdatedConnectionItem(connection, resolveSourceProvider),
    ),
  };
}

export function addConnectionEvent(
  currentConnections: Connection[],
  connection: Omit<Connection, "status">,
  resolveSourceProvider: SourceProviderResolver,
): Connection[] {
  const enrichedConnection = normalizeCreatedConnectionEvent(
    connection,
    connection.sourcePodId
      ? resolveSourceProvider(connection.sourcePodId)
      : undefined,
  );

  const exists = currentConnections.some(
    (existingConnection) => existingConnection.id === enrichedConnection.id,
  );
  if (exists) {
    return currentConnections;
  }

  return [...currentConnections, enrichedConnection];
}

export function updateConnectionEvent(
  currentConnections: Connection[],
  connection: ConnectionUpdatedPayload["connection"],
  resolveSourceProvider: SourceProviderResolver,
): Connection[] {
  if (!connection) return currentConnections;

  const index = currentConnections.findIndex(
    (existing) => existing.id === connection.id,
  );
  if (index === -1) return currentConnections;

  const existingConnection = currentConnections[index]!;
  const enrichedConnection = mapConnectionUpdatedEventPayload(
    connection,
    existingConnection,
    resolveSourceProvider,
  );

  return currentConnections.map((item, itemIndex) =>
    itemIndex === index ? enrichedConnection : item,
  );
}

export function removeConnectionEvent(
  currentConnections: Connection[],
  connectionId: string,
): Connection[] {
  return currentConnections.filter((connection) => connection.id !== connectionId);
}
