import type { ServerWebSocket } from 'bun';

export interface WebSocketMessage {
	type: string;
	requestId: string;
	payload: unknown;
	/** 用於 ack 回應訊息的確認 ID */
	ackId?: string;
}

export interface WebSocketResponse {
	type: string;
	requestId: string;
	success: boolean;
	payload?: unknown;
	error?: string;
	code?: string;
	/** 用於心跳等需要確認的訊息 */
	ackId?: string;
}

export interface ClientConnection {
	id: string;
	webSocket: ServerWebSocket<{ connectionId: string }>;
	canvasId: string | null;
	lastHeartbeat: number;
	missedHeartbeats: number;
}
