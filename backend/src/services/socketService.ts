import { logger } from "../utils/logger.js";
import {
  WebSocketResponseEvents,
  assertServerEventRegistered,
  parseServerEventPayload,
} from "../schemas";
import type { ConnectionReadyPayload } from "../types";
import type { WebSocketResponse } from "../types/websocket.js";
import { connectionManager } from "./connectionManager.js";
import { roomManager } from "./roomManager.js";
import { serialize } from "../utils/messageSerializer.js";

const CANVAS_ROOM_PREFIX = "canvas:";

// Bun 的 ServerWebSocket 沒有靜態 OPEN 屬性，手動定義 WebSocket 連線開啟狀態常數
const WS_READY_STATE_OPEN = 1;

class SocketService {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeouts: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private backpressuredConnectionIds = new Set<string>();
  private initialized = false;

  private readonly HEARTBEAT_INTERVAL = 15000;
  private readonly HEARTBEAT_TIMEOUT = 10000;
  private readonly MAX_MISSED_HEARTBEATS = 2;

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    this.startHeartbeat();
  }

  emitToAll(event: string, payload: unknown): void {
    this.emitToAllExcept("", event, payload);
  }

  emitToAllExcept(
    excludeConnectionId: string,
    event: string,
    payload: unknown,
  ): void {
    const serialized = this.serializeEvent(event, payload);
    const connections = connectionManager.getAll();
    for (const connection of connections) {
      if (connection.id === excludeConnectionId) continue;
      this.sendSerializedToConnection(connection.id, serialized);
    }
  }

  emitToConnection(
    connectionId: string,
    event: string,
    payload: unknown,
  ): void {
    this.sendSerializedToConnection(
      connectionId,
      this.serializeEvent(event, payload),
    );
  }

  private serializeEvent(event: string, payload: unknown): string {
    const response: WebSocketResponse = {
      type: event,
      requestId: "",
      success: true,
      payload: this.resolvePayload(event, payload),
    };
    return serialize(response);
  }

  private sendSerializedToConnection(
    connectionId: string,
    serialized: string,
  ): void {
    const connection = connectionManager.get(connectionId);
    if (
      !connection ||
      connection.webSocket.readyState !== WS_READY_STATE_OPEN
    ) {
      return;
    }
    const sendStatus = connection.webSocket.send(serialized);
    if (sendStatus === -1 && !this.backpressuredConnectionIds.has(connectionId)) {
      this.backpressuredConnectionIds.add(connectionId);
      logger.warn(
        "WebSocket",
        "Warn",
        `連線 ${connectionId} 發生傳送壅塞，等待 drain`,
      );
    }
  }

  emitConnectionReady(
    connectionId: string,
    payload: ConnectionReadyPayload,
  ): void {
    this.emitToConnection(
      connectionId,
      WebSocketResponseEvents.CONNECTION_READY,
      payload,
    );
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
    connectionManager.setCanvasId(connectionId, "");
  }

  emitToCanvas(
    canvasId: string,
    event: string,
    payload: unknown,
  ): void {
    this.emitToCanvasExcept(canvasId, "", event, payload);
  }

  emitToCanvasExcept(
    canvasId: string,
    excludeConnectionId: string,
    event: string,
    payload: unknown,
  ): void {
    const roomName = `${CANVAS_ROOM_PREFIX}${canvasId}`;
    const members = roomManager.getMembers(roomName);
    const serialized = this.serializeEvent(event, payload);

    for (const connectionId of members) {
      if (connectionId === excludeConnectionId) continue;
      this.sendSerializedToConnection(connectionId, serialized);
    }
  }

  cleanupSocket(connectionId: string): void {
    roomManager.leaveAll(connectionId);
    connectionManager.remove(connectionId);
    this.clearHeartbeatTimeout(connectionId);
    this.backpressuredConnectionIds.delete(connectionId);
  }

  handleDrain(connectionId: string): void {
    this.backpressuredConnectionIds.delete(connectionId);
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

    this.heartbeatInterval = setInterval(
      () => this.pingAllConnections(),
      this.HEARTBEAT_INTERVAL,
    );
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
      requestId: "",
      success: true,
      payload: { timestamp },
      ackId,
    };

    const serialized = serialize(response);
    if (connection.webSocket.readyState !== WS_READY_STATE_OPEN) {
      return;
    }
    connection.webSocket.send(serialized);

    const timeout = setTimeout(
      () => this.handleHeartbeatTimeout(connectionId),
      this.HEARTBEAT_TIMEOUT,
    );

    this.heartbeatTimeouts.set(connectionId, timeout);
  }

  private handleHeartbeatTimeout(connectionId: string): void {
    const connection = connectionManager.get(connectionId);
    if (!connection) {
      return;
    }

    connectionManager.incrementMissedHeartbeats(connectionId);

    const missed = connection.missedHeartbeats;
    logger.log(
      "Connection",
      "Error",
      `連線 ${connectionId} 心跳逾時 (${missed}/${this.MAX_MISSED_HEARTBEATS})`,
    );

    if (missed >= this.MAX_MISSED_HEARTBEATS) {
      this.clearHeartbeatTimeout(connectionId);
      connection.webSocket.close(1000, "Heartbeat timeout");
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
  }

  private resolvePayload(event: string, payload: unknown): unknown {
    if (event === "error") {
      return payload;
    }

    assertServerEventRegistered(event);
    return parseServerEventPayload(event, payload);
  }
}

export const socketService = new SocketService();
