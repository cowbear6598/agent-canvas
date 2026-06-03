import { describe, it, expect, beforeEach } from "vitest";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import { connectionManager } from "../../src/services/connectionManager.js";
import { socketService } from "../../src/services/socketService.js";

const heartbeatPayload = { timestamp: 1 };

function createMockWs() {
  return {
    send: vi.fn(),
    readyState: 1,
    data: {
      sessionId: null,
      transportSecurity: {
        isTls: false,
        showInsecureTransportWarning: false,
        isLanHost: true,
      },
    },
  } as unknown as Parameters<typeof connectionManager.add>[0];
}

function addConnection(ws: ReturnType<typeof createMockWs>): string {
  return connectionManager.add(ws);
}

function removeAllConnections(): void {
  for (const conn of connectionManager.getAll()) {
    connectionManager.remove(conn.id);
  }
}

describe("SocketService", () => {
  describe("emitToAllExcept", () => {
    let wsA: ReturnType<typeof createMockWs>;
    let wsB: ReturnType<typeof createMockWs>;
    let wsC: ReturnType<typeof createMockWs>;
    let idA: string;
    let idB: string;

    beforeEach(() => {
      removeAllConnections();

      wsA = createMockWs();
      wsB = createMockWs();
      wsC = createMockWs();

      idA = addConnection(wsA);
      idB = addConnection(wsB);
      addConnection(wsC);
    });

    it("應向除指定 connectionId 外的所有連線發送訊息", () => {
      socketService.emitToAllExcept(
        idA,
        WebSocketResponseEvents.HEARTBEAT_PING,
        heartbeatPayload,
      );

      expect(wsA.send).not.toHaveBeenCalled();
      expect(wsB.send).toHaveBeenCalledTimes(1);
      expect(wsC.send).toHaveBeenCalledTimes(1);
    });

    it("指定的 connectionId 不應收到訊息", () => {
      socketService.emitToAllExcept(
        idB,
        WebSocketResponseEvents.HEARTBEAT_PING,
        heartbeatPayload,
      );

      expect(wsB.send).not.toHaveBeenCalled();
      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsC.send).toHaveBeenCalledTimes(1);
    });

    it("excludeConnectionId 為空字串時，所有連線都應收到（等同 emitToAll）", () => {
      socketService.emitToAllExcept(
        "",
        WebSocketResponseEvents.HEARTBEAT_PING,
        heartbeatPayload,
      );

      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsB.send).toHaveBeenCalledTimes(1);
      expect(wsC.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("emitToAll", () => {
    let wsA: ReturnType<typeof createMockWs>;
    let wsB: ReturnType<typeof createMockWs>;

    beforeEach(() => {
      removeAllConnections();

      wsA = createMockWs();
      wsB = createMockWs();

      addConnection(wsA);
      addConnection(wsB);
    });

    it("應向所有連線發送訊息", () => {
      socketService.emitToAll(
        WebSocketResponseEvents.HEARTBEAT_PING,
        heartbeatPayload,
      );

      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsB.send).toHaveBeenCalledTimes(1);
    });

    it("傳送的訊息內容包含正確的事件類型", () => {
      socketService.emitToAll(
        WebSocketResponseEvents.HEARTBEAT_PING,
        heartbeatPayload,
      );

      const callArg = (wsA.send as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      const parsed = JSON.parse(callArg);
      expect(parsed.type).toBe(WebSocketResponseEvents.HEARTBEAT_PING);
    });

    it("沒有連線時不拋出例外", () => {
      removeAllConnections();
      expect(() =>
        socketService.emitToAll(
          WebSocketResponseEvents.HEARTBEAT_PING,
          heartbeatPayload,
        ),
      ).not.toThrow();
    });

    it("未註冊事件應拒絕發送", () => {
      expect(() => socketService.emitToAll("test:event", {})).toThrow(
        "未註冊的 WebSocket server event",
      );
    });
  });
});
