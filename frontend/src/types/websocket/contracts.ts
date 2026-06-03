import type {
  PairedWebSocketRequestEvent,
  ResponseEventForRequest,
  WebSocketRequestEvent,
  WebSocketResponseEvent,
} from "@shared/websocket";

export type FrontendWebSocketRequestEvent = WebSocketRequestEvent;
export type FrontendWebSocketResponseEvent = WebSocketResponseEvent;
export type FrontendKnownWebSocketRequestEvent = PairedWebSocketRequestEvent;
export type FrontendResponseEventForRequest<
  TRequestEvent extends FrontendKnownWebSocketRequestEvent,
> = ResponseEventForRequest<TRequestEvent>;
