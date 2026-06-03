import { websocketClient, WebSocketResponseEvents } from "@/services/websocket";
import { getBackupStandaloneListeners } from "./backupEventHandlers";
import { getCanvasEventListeners } from "./canvasEventHandlers";
import { getConnectionEventListeners } from "./connectionEventHandlers";
import {
  getIntegrationEventListeners,
  handleIntegrationConnectionStatusChanged,
} from "./integrationEventHandlers";
import { getManagedMcpEventListeners } from "./managedMcpEventHandlers";
import { getNoteEventListeners } from "./noteEventHandlers";
import { getOpencodeStandaloneListeners } from "./opencodeEventHandlers";
import { getPodEventListeners } from "./podEventHandlers";
import {
  getRunEventListeners,
  getRunStandaloneListeners,
} from "./runEventHandlers";
import { getWorkflowEventListeners } from "./workflowEventHandlers";

export interface AppEventListener {
  event: string;
  handler: (payload: unknown) => void;
}

export interface AppEventListenerClient {
  on<T>(event: string, handler: (payload: T) => void): void;
  off<T>(event: string, handler: (payload: T) => void): void;
}

export const listeners: AppEventListener[] = [
  ...getPodEventListeners(),
  ...getConnectionEventListeners(),
  ...getWorkflowEventListeners(),
  ...getNoteEventListeners(),
  ...getCanvasEventListeners(),
  ...getIntegrationEventListeners(),
  ...getRunEventListeners(),
  ...getManagedMcpEventListeners(),
];

// 這些事件不走 createUnifiedHandler 的 requestId / toast 邏輯，因此維持獨立分組。
export const standaloneListeners: AppEventListener[] = [
  {
    event: WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
    handler: handleIntegrationConnectionStatusChanged as (
      payload: unknown,
    ) => void,
  },
  ...getRunStandaloneListeners(),
  ...getBackupStandaloneListeners(),
  ...getOpencodeStandaloneListeners(),
];

const allListeners: AppEventListener[] = [...listeners, ...standaloneListeners];

export function createAppEventWiring(options: {
  client?: AppEventListenerClient;
} = {}): {
  register: () => void;
  unregister: () => void;
} {
  const client = options.client ?? websocketClient;
  let isRegistered = false;

  const register = (): void => {
    if (isRegistered) return;

    allListeners.forEach(({ event, handler }) => {
      client.on(event, handler);
    });
    isRegistered = true;
  };

  const unregister = (): void => {
    if (!isRegistered) return;

    allListeners.forEach(({ event, handler }) => {
      client.off(event, handler);
    });
    isRegistered = false;
  };

  return {
    register,
    unregister,
  };
}
