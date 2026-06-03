export {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type WebSocketRequestEvent,
  type WebSocketResponseEvent,
} from "@shared/websocket";

export type WebSocketRequestEvents = import("@shared/websocket").WebSocketRequestEvent;
export type WebSocketResponseEvents = import("@shared/websocket").WebSocketResponseEvent;
