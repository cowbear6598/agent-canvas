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

type UpdateConfigInput = Omit<ConfigUpdatePayload, "requestId"> & {
  timezoneOffset: number;
};

export async function getConfig(): Promise<ConfigGetResultPayload> {
  return createWebSocketRequest<ConfigGetPayload, ConfigGetResultPayload>({
    requestEvent: WebSocketRequestEvents.CONFIG_GET,
    responseEvent: WebSocketResponseEvents.CONFIG_GET_RESULT,
    payload: {},
  });
}

export async function updateConfig(
  config: UpdateConfigInput,
): Promise<ConfigUpdatedPayload> {
  return createWebSocketRequest<ConfigUpdatePayload, ConfigUpdatedPayload>({
    requestEvent: WebSocketRequestEvents.CONFIG_UPDATE,
    responseEvent: WebSocketResponseEvents.CONFIG_UPDATED,
    payload: config,
  });
}
