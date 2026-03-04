import { logger } from '../utils/logger.js';
import { WebSocketResponseEvents } from '../schemas';
import type { ConnectionReadyPayload } from '../types';
import type { WebSocketResponse } from '../types/websocket.js';
import { connectionManager } from './connectionManager.js';
import { roomManager } from './roomManager.js';
import { serialize } from '../utils/messageSerializer.js';

const CANVAS_ROOM_PREFIX = 'canvas:';

class SocketService {
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private heartbeatTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private initialized = false;

	private readonly HEARTBEAT_INTERVAL = 15000;
	private readonly HEARTBEAT_TIMEOUT = 10000;
	private readonly MAX_MISSED_HEARTBEATS = 2;

	initialize(): void {
		if (this.initialized) {
			logger.log('Startup', 'Complete', '[WebSocket] 已初始化');
			return;
		}

		this.initialized = true;
		logger.log('Startup', 'Complete', '[WebSocket] 服務已初始化');

		this.startHeartbeat();
	}

	emitToAll(event: string, payload: unknown): void {
		this.emitToAllExcept('', event, payload);
	}

	emitToAllExcept(excludeConnectionId: string, event: string, payload: unknown): void {
		const connections = connectionManager.getAll();
		for (const connection of connections) {
			if (connection.id === excludeConnectionId) continue;
			this.emitToConnection(connection.id, event, payload);
		}
	}

	emitToConnection(connectionId: string, event: string, payload: unknown): void {
		const connection = connectionManager.get(connectionId);
		if (!connection) {
			return;
		}

		const response: WebSocketResponse = {
			type: event,
			requestId: '',
			success: true,
			payload,
		};

		const serialized = serialize(response);
		try {
			connection.webSocket.send(serialized);
		} catch (error) {
			logger.log('Connection', 'Error', `訊息傳送失敗，連線 ${connectionId}: ${error}`);
		}
	}

	emitConnectionReady(connectionId: string, payload: ConnectionReadyPayload): void {
		this.emitToConnection(connectionId, WebSocketResponseEvents.CONNECTION_READY, payload);
	}

	joinCanvasRoom(connectionId: string, canvasId: string): void {
		this.leaveCanvasRoom(connectionId);

		const roomName = `${CANVAS_ROOM_PREFIX}${canvasId}`;
		roomManager.join(connectionId, roomName);
		connectionManager.setCanvasId(connectionId, canvasId);
	}

	leaveCanvasRoom(connectionId: string): void {
		const currentCanvasId = connectionManager.getCanvasId(connectionId);
		if (!currentCanvasId) {
			return;
		}

		const roomName = `${CANVAS_ROOM_PREFIX}${currentCanvasId}`;
		roomManager.leave(connectionId, roomName);
		connectionManager.setCanvasId(connectionId, '');
	}

	emitToCanvas(canvasId: string, event: string, payload: unknown): void {
		this.emitToCanvasExcept(canvasId, '', event, payload);
	}

	emitToCanvasExcept(canvasId: string, excludeConnectionId: string, event: string, payload: unknown): void {
		const roomName = `${CANVAS_ROOM_PREFIX}${canvasId}`;
		const members = roomManager.getMembers(roomName);

		for (const connectionId of members) {
			if (connectionId === excludeConnectionId) continue;
			this.emitToConnection(connectionId, event, payload);
		}
	}

	cleanupSocket(connectionId: string): void {
		roomManager.leaveAll(connectionId);
		connectionManager.remove(connectionId);
		this.clearHeartbeatTimeout(connectionId);
	}

	private clearHeartbeatTimeout(connectionId: string): void {
		const timeout = this.heartbeatTimeouts.get(connectionId);
		if (timeout) {
			clearTimeout(timeout);
			this.heartbeatTimeouts.delete(connectionId);
		}
	}

	private pingAllConnections(): void {
		const connections = connectionManager.getAll();
		for (const connection of connections) {
			this.sendHeartbeatPing(connection.id);
		}
	}

	private startHeartbeat(): void {
		if (this.heartbeatInterval) {
			return;
		}

		this.heartbeatInterval = setInterval(() => this.pingAllConnections(), this.HEARTBEAT_INTERVAL);

		logger.log('Startup', 'Complete', '[Heartbeat] 已啟動');
	}

	private sendHeartbeatPing(connectionId: string): void {
		const connection = connectionManager.get(connectionId);
		if (!connection) {
			return;
		}

		this.clearHeartbeatTimeout(connectionId);

		const timestamp = Date.now();
		const ackId = `heartbeat-${connectionId}-${timestamp}`;
		const response: WebSocketResponse = {
			type: WebSocketResponseEvents.HEARTBEAT_PING,
			requestId: '',
			success: true,
			payload: { timestamp },
			ackId,
		};

		const serialized = serialize(response);
		try {
			connection.webSocket.send(serialized);
		} catch (error) {
			logger.log('Connection', 'Error', `心跳傳送失敗，連線 ${connectionId}: ${error}`);
			return;
		}

		const timeout = setTimeout(() => this.handleHeartbeatTimeout(connectionId), this.HEARTBEAT_TIMEOUT);

		this.heartbeatTimeouts.set(connectionId, timeout);
	}

	private handleHeartbeatTimeout(connectionId: string): void {
		const connection = connectionManager.get(connectionId);
		if (!connection) {
			return;
		}

		connectionManager.incrementMissedHeartbeats(connectionId);

		const missed = connection.missedHeartbeats;
		logger.log('Connection', 'Error', `連線 ${connectionId} 心跳逾時 (${missed}/${this.MAX_MISSED_HEARTBEATS})`);

		if (missed >= this.MAX_MISSED_HEARTBEATS) {
			logger.log('Connection', 'Delete', `連線 ${connectionId} 因心跳逾時而斷線`);
			this.clearHeartbeatTimeout(connectionId);
			connection.webSocket.close(1000, 'Heartbeat timeout');
		}
	}

	handleHeartbeatPong(connectionId: string): void {
		connectionManager.updateHeartbeat(connectionId);
		this.clearHeartbeatTimeout(connectionId);
	}

	stopHeartbeat(): void {
		if (!this.heartbeatInterval) {
			return;
		}

		clearInterval(this.heartbeatInterval);
		this.heartbeatInterval = null;

		this.heartbeatTimeouts.forEach((timeout) => clearTimeout(timeout));
		this.heartbeatTimeouts.clear();

		logger.log('Startup', 'Complete', '[Heartbeat] 已停止');
	}
}

export const socketService = new SocketService();
