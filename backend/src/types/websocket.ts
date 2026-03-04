import type { ServerWebSocket } from 'bun';

export interface WebSocketMessage {
	type: string;
	requestId: string;
	payload: unknown;
	ackId?: string;
}

export interface WebSocketResponse {
	type: string;
	requestId: string;
	success: boolean;
	payload?: unknown;
	error?: string;
	code?: string;
	ackId?: string;
}

export interface ClientConnection {
	id: string;
	webSocket: ServerWebSocket<{ connectionId: string }>;
	canvasId: string | null;
	lastHeartbeat: number;
	missedHeartbeats: number;
}
