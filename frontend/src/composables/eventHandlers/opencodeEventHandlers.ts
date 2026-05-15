import { WebSocketResponseEvents } from "@/services/websocket";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";

/**
 * 處理後端推送的 opencode:aliases:updated 事件。
 * 收到時重新從後端拉取最新 alias 清單。
 */
export const handleOpencodeAliasesUpdated = (_payload: unknown): void => {
  useOpencodeAliasStore().loadFromBackend();
};

export function getOpencodeStandaloneListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.OPENCODE_ALIASES_UPDATED,
      handler: handleOpencodeAliasesUpdated,
    },
  ];
}
