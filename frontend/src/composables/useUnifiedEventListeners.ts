import { ref } from "vue";
import { websocketClient, WebSocketResponseEvents } from "@/services/websocket";
import {
  getPodEventListeners,
  getStandalonePodListeners,
} from "./eventHandlers/podEventHandlers";
import { getConnectionEventListeners } from "./eventHandlers/connectionEventHandlers";
import { getNoteEventListeners } from "./eventHandlers/noteEventHandlers";
import { getCanvasEventListeners } from "./eventHandlers/canvasEventHandlers";
import {
  getIntegrationEventListeners,
  handleIntegrationConnectionStatusChanged,
} from "./eventHandlers/integrationEventHandlers";
import {
  getRunEventListeners,
  getRunStandaloneListeners,
} from "./eventHandlers/runEventHandlers";
import { getBackupStandaloneListeners } from "./eventHandlers/backupEventHandlers";

const isListenerRegistered = ref(false);

export const listeners = [
  ...getPodEventListeners(),
  ...getConnectionEventListeners(),
  ...getNoteEventListeners(),
  ...getCanvasEventListeners(),
  ...getIntegrationEventListeners(),
  ...getRunEventListeners(),
];

// standalone 事件的 payload 不需經過 createUnifiedHandler 的 requestId / Toast 機制，因此維持獨立註冊。
// 測試以 listeners.length + standaloneListeners.length 驗證此分離設計，不應將其納入 listeners 陣列。
const standaloneListeners: Array<{
  event: string;
  handler: (payload: unknown) => void;
}> = [
  ...getStandalonePodListeners(),
  {
    event: WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
    handler: handleIntegrationConnectionStatusChanged as (
      payload: unknown,
    ) => void,
  },
  ...getRunStandaloneListeners(),
  ...getBackupStandaloneListeners(),
];

export function registerUnifiedListeners(): void {
  if (isListenerRegistered.value) return;
  isListenerRegistered.value = true;

  for (const { event, handler } of listeners) {
    websocketClient.on(event, handler);
  }

  for (const { event, handler } of standaloneListeners) {
    websocketClient.on(event, handler);
  }
}

export function unregisterUnifiedListeners(): void {
  if (!isListenerRegistered.value) return;
  isListenerRegistered.value = false;

  for (const { event, handler } of listeners) {
    websocketClient.off(event, handler);
  }

  for (const { event, handler } of standaloneListeners) {
    websocketClient.off(event, handler);
  }
}

export const useUnifiedEventListeners = (): {
  registerUnifiedListeners: () => void;
  unregisterUnifiedListeners: () => void;
} => {
  return {
    registerUnifiedListeners,
    unregisterUnifiedListeners,
  };
};
