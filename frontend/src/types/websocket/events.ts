import {
  WebSocketRequestEvents as SharedWebSocketRequestEvents,
  WebSocketResponseEvents as SharedWebSocketResponseEvents,
} from "@shared/websocket";

export const WebSocketRequestEvents = SharedWebSocketRequestEvents;
export type WebSocketRequestEvents =
  (typeof SharedWebSocketRequestEvents)[keyof typeof SharedWebSocketRequestEvents];

export const WebSocketResponseEvents = SharedWebSocketResponseEvents;
export type WebSocketResponseEvents =
  (typeof SharedWebSocketResponseEvents)[keyof typeof SharedWebSocketResponseEvents];
