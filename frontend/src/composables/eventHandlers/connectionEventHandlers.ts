import { WebSocketResponseEvents } from "@/services/websocket";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Connection } from "@/types";
import type { ConnectionPayloadItem } from "@/types/websocket";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import { t } from "@/i18n";
import type { BasePayload } from "./sharedHandlerUtils";

type RawConnectionFromEvent = Omit<Connection, "status">;

const handleConnectionCreated = createUnifiedHandler<
  BasePayload & { connection?: RawConnectionFromEvent; canvasId: string }
>(
  (payload) => {
    if (payload.connection) {
      useConnectionStore().addConnectionFromEvent(payload.connection);
    }
  },
  { toastMessage: () => t("composable.eventHandler.connectionCreated") },
);

const handleConnectionUpdated = createUnifiedHandler<
  BasePayload & {
    connection?: ConnectionPayloadItem;
    connections?: ConnectionPayloadItem[];
    canvasId: string;
  }
>((payload) => {
  const store = useConnectionStore();
  if (payload.connections?.length) {
    payload.connections.forEach((connection) => {
      store.updateConnectionFromEvent(connection);
    });
    return;
  }
  if (payload.connection) {
    store.updateConnectionFromEvent(payload.connection);
  }
});

const handleConnectionDeleted = createUnifiedHandler<
  BasePayload & { connectionId: string; canvasId: string }
>(
  (payload) => {
    useConnectionStore().removeConnectionFromEvent(payload.connectionId);
  },
  { toastMessage: () => t("composable.eventHandler.connectionDeleted") },
);

export function getConnectionEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.CONNECTION_CREATED,
      handler: handleConnectionCreated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CONNECTION_UPDATED,
      handler: handleConnectionUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CONNECTION_DELETED,
      handler: handleConnectionDeleted as (payload: unknown) => void,
    },
  ];
}
