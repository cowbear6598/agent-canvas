import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  ConfigGetPayload,
  ConfigUpdatePayload,
} from "@/types/websocket/requests";
import type {
  ConfigGetResultPayload,
  ConfigUpdatedPayload,
} from "@/types/websocket/responses";
import type { ModelType } from "@/types/pod";

export async function getConfig(): Promise<ConfigGetResultPayload> {
  return createWebSocketRequest<ConfigGetPayload, ConfigGetResultPayload>({
    requestEvent: WebSocketRequestEvents.CONFIG_GET,
    responseEvent: WebSocketResponseEvents.CONFIG_GET_RESULT,
    payload: {},
  });
}

export async function updateConfig(config: {
  summaryModel: ModelType;
  aiDecideModel: ModelType;
  timezoneOffset: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
}): Promise<ConfigUpdatedPayload> {
  return createWebSocketRequest<ConfigUpdatePayload, ConfigUpdatedPayload>({
    requestEvent: WebSocketRequestEvents.CONFIG_UPDATE,
    responseEvent: WebSocketResponseEvents.CONFIG_UPDATED,
    payload: {
      summaryModel: config.summaryModel,
      aiDecideModel: config.aiDecideModel,
      timezoneOffset: config.timezoneOffset,
      backupGitRemoteUrl: config.backupGitRemoteUrl,
      backupTime: config.backupTime,
      backupEnabled: config.backupEnabled,
    },
  });
}
