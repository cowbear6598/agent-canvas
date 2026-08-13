import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type { BackupTriggerPayload } from "@/types/websocket/requests";
import type { BackupTriggerResultPayload } from "@/types/websocket/responses";

export async function triggerBackup(
  gitRemoteUrl: string,
): Promise<BackupTriggerResultPayload> {
  return createWebSocketRequest<
    BackupTriggerPayload,
    BackupTriggerResultPayload
  >({
    requestEvent: WebSocketRequestEvents.BACKUP_TRIGGER,
    responseEvent: WebSocketResponseEvents.BACKUP_TRIGGER_RESULT,
    payload: { gitRemoteUrl },
    timeout: 30_000,
  });
}
