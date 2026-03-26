import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  BackupTestConnectionPayload,
  BackupTriggerPayload,
} from "@/types/websocket/requests";
import type {
  BackupTestConnectionResultPayload,
  BackupTriggerResultPayload,
} from "@/types/websocket/responses";

export async function testBackupConnection(
  gitRemoteUrl: string,
): Promise<BackupTestConnectionResultPayload> {
  return createWebSocketRequest<
    BackupTestConnectionPayload,
    BackupTestConnectionResultPayload
  >({
    requestEvent: WebSocketRequestEvents.BACKUP_TEST_CONNECTION,
    responseEvent: WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
    payload: { gitRemoteUrl },
  });
}

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
