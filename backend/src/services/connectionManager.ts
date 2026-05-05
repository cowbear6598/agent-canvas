import { v4 as uuidv4 } from 'uuid';
import type { ServerWebSocket } from 'bun';
import type { ClientConnection, ConnectionSocketData } from '../types/websocket.js';
import type { TransportSecurityInfo } from './auth/transportSecurityService.js';

class ConnectionManager {
	private connections: Map<string, ClientConnection> = new Map();

	add(webSocket: ServerWebSocket<ConnectionSocketData>): string {
		const id = uuidv4();
		const connection: ClientConnection = {
			id,
			webSocket,
			canvasId: null,
			sessionId: webSocket.data.sessionId,
			transportSecurity: webSocket.data.transportSecurity,
			lastHeartbeat: Date.now(),
			missedHeartbeats: 0,
		};
		this.connections.set(id, connection);
		return id;
	}

	remove(id: string): void {
		this.connections.delete(id);
	}

	get(id: string): ClientConnection | undefined {
		return this.connections.get(id);
	}
	getAll(): ClientConnection[] {
		return Array.from(this.connections.values());
	}

	setCanvasId(id: string, canvasId: string): void {
		const connection = this.connections.get(id);
		if (connection) {
			connection.canvasId = canvasId;
		}
	}

	getCanvasId(id: string): string | null {
		const connection = this.connections.get(id);
		return connection?.canvasId ?? null;
	}

	getSessionId(id: string): string | null {
		const connection = this.connections.get(id);
		return connection?.sessionId ?? null;
	}

	setSessionId(id: string, sessionId: string | null): void {
		const connection = this.connections.get(id);
		if (connection) {
			connection.sessionId = sessionId;
		}
	}

	getTransportSecurity(id: string): TransportSecurityInfo | undefined {
		return this.connections.get(id)?.transportSecurity;
	}

	updateHeartbeat(id: string): void {
		const connection = this.connections.get(id);
		if (connection) {
			connection.lastHeartbeat = Date.now();
			connection.missedHeartbeats = 0;
		}
	}

	incrementMissedHeartbeats(id: string): void {
		const connection = this.connections.get(id);
		if (connection) {
			connection.missedHeartbeats++;
		}
	}
}

export const connectionManager = new ConnectionManager();
