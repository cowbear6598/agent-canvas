import type { ServerWebSocket } from 'bun';
import type { TransportSecurityInfo } from '../services/auth/transportSecurityService.js';

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

export interface ConnectionSocketData {
	connectionId: string;
	sessionId: string | null;
	transportSecurity: TransportSecurityInfo;
}

export interface ClientConnection {
	id: string;
	webSocket: ServerWebSocket<ConnectionSocketData>;
	canvasId: string | null;
	sessionId: string | null;
	transportSecurity: TransportSecurityInfo;
	lastHeartbeat: number;
	missedHeartbeats: number;
}
