import { v4 as uuidv4 } from 'uuid';
import {
  createTestServer,
  closeTestServer,
  createSocketClient,
  disconnectSocket,
  waitForEvent,
  type TestServerInstance,
} from '../setup';
import { WebSocketRequestEvents, WebSocketResponseEvents } from '../../src/schemas';
import type { TestWebSocketClient } from '../setup';

interface CursorMovedPayload {
  connectionId: string;
  x: number;
  y: number;
  color: string;
}

interface CursorLeftPayload {
  connectionId: string;
}

async function switchCanvas(client: TestWebSocketClient, canvasId: string): Promise<void> {
  const responsePromise = waitForEvent(client, WebSocketResponseEvents.CANVAS_SWITCHED);
  client.emit(WebSocketRequestEvents.CANVAS_SWITCH, { requestId: uuidv4(), canvasId });
  await responsePromise;
}

async function createCanvas(client: TestWebSocketClient, name: string): Promise<string> {
  const responsePromise = waitForEvent<{ canvas?: { id: string } }>(client, WebSocketResponseEvents.CANVAS_CREATED);
  client.emit(WebSocketRequestEvents.CANVAS_CREATE, { requestId: uuidv4(), name });
  const response = await responsePromise;
  return response.canvas!.id;
}

function waitForEventWithTimeout<T>(
  socket: TestWebSocketClient,
  eventName: string,
  ms: number = 500
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve(null);
    }, ms);

    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(data);
    };

    socket.on(eventName, handler);
  });
}

describe('游標共享', () => {
  let server: TestServerInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    if (server) await closeTestServer(server);
  });

  describe('游標移動廣播', () => {
    let clientA: TestWebSocketClient;
    let clientB: TestWebSocketClient;

    beforeAll(async () => {
      clientA = await createSocketClient(server.baseUrl, server.canvasId);
      clientB = await createSocketClient(server.baseUrl, server.canvasId);
    });

    afterAll(async () => {
      if (clientA?.connected) await disconnectSocket(clientA);
      if (clientB?.connected) await disconnectSocket(clientB);
    });

    it('發送者不會收到自己的 cursor:moved', async () => {
      const receivedPromise = waitForEventWithTimeout<CursorMovedPayload>(
        clientA,
        WebSocketResponseEvents.CURSOR_MOVED,
        300
      );

      clientA.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 100, y: 200 });

      const received = await receivedPromise;
      expect(received).toBeNull();
    });

    it('同 Canvas 的其他連線收到 cursor:moved', async () => {
      const receivedPromise = waitForEvent<CursorMovedPayload>(
        clientB,
        WebSocketResponseEvents.CURSOR_MOVED
      );

      clientA.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 100, y: 200 });

      const payload = await receivedPromise;
      expect(payload.connectionId).toBe(clientA.id);
      expect(payload.x).toBe(100);
      expect(payload.y).toBe(200);
      expect(payload.color).toBeDefined();
    });

    it('payload 包含 connectionId、x、y、color', async () => {
      // 等待超過速率限制間隔，避免前一個測試的節流影響
      await new Promise((r) => setTimeout(r, 60));

      const receivedPromise = waitForEvent<CursorMovedPayload>(
        clientB,
        WebSocketResponseEvents.CURSOR_MOVED
      );

      clientA.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 50, y: 75 });

      const payload = await receivedPromise;
      expect(payload.connectionId).toBeDefined();
      expect(typeof payload.x).toBe('number');
      expect(typeof payload.y).toBe('number');
      expect(typeof payload.color).toBe('string');
    });
  });

  describe('不同 Canvas 隔離', () => {
    let clientA: TestWebSocketClient;
    let clientC: TestWebSocketClient;

    beforeAll(async () => {
      clientA = await createSocketClient(server.baseUrl, server.canvasId);

      const canvasYId = await createCanvas(clientA, 'Canvas-Y');
      clientC = await createSocketClient(server.baseUrl, canvasYId);
    });

    afterAll(async () => {
      if (clientA?.connected) await disconnectSocket(clientA);
      if (clientC?.connected) await disconnectSocket(clientC);
    });

    it('不同 Canvas 的連線不會收到 cursor:moved', async () => {
      const receivedPromise = waitForEventWithTimeout<CursorMovedPayload>(
        clientC,
        WebSocketResponseEvents.CURSOR_MOVED,
        300
      );

      clientA.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 100, y: 200 });

      const received = await receivedPromise;
      expect(received).toBeNull();
    });
  });

  describe('斷線游標消失', () => {
    let clientA: TestWebSocketClient;
    let clientB: TestWebSocketClient;

    beforeAll(async () => {
      const canvasId = await createCanvas(
        await createSocketClient(server.baseUrl, server.canvasId),
        'Canvas-Disconnect'
      );
      clientA = await createSocketClient(server.baseUrl, canvasId);
      clientB = await createSocketClient(server.baseUrl, canvasId);
    });

    it('連線斷開後，同 Canvas 其他連線收到 cursor:left', async () => {
      const clientAId = clientA.id;
      const leftPromise = waitForEvent<CursorLeftPayload>(clientB, WebSocketResponseEvents.CURSOR_LEFT);

      await disconnectSocket(clientA);

      const payload = await leftPromise;
      expect(payload.connectionId).toBe(clientAId);
    });

    afterAll(async () => {
      if (clientB?.connected) await disconnectSocket(clientB);
    });
  });

  describe('Canvas 切換游標消失', () => {
    let clientA: TestWebSocketClient;
    let clientB: TestWebSocketClient;
    let canvasXId: string;

    beforeAll(async () => {
      const helper = await createSocketClient(server.baseUrl, server.canvasId);
      canvasXId = await createCanvas(helper, 'Canvas-Switch-X');
      await createCanvas(helper, 'Canvas-Switch-Y');
      await disconnectSocket(helper);

      clientA = await createSocketClient(server.baseUrl, canvasXId);
      clientB = await createSocketClient(server.baseUrl, canvasXId);
    });

    afterAll(async () => {
      if (clientA?.connected) await disconnectSocket(clientA);
      if (clientB?.connected) await disconnectSocket(clientB);
    });

    it('切換 Canvas 後，舊 Canvas 其他連線收到 cursor:left', async () => {
      const clientAId = clientA.id;
      const leftPromise = waitForEvent<CursorLeftPayload>(clientB, WebSocketResponseEvents.CURSOR_LEFT);

      const canvases = await new Promise<{ id: string; name: string }[]>((resolve) => {
        const handler = (data: { canvases?: { id: string; name: string }[] }) => {
          clientA.off(WebSocketResponseEvents.CANVAS_LIST_RESULT, handler);
          resolve(data.canvases || []);
        };
        clientA.on(WebSocketResponseEvents.CANVAS_LIST_RESULT, handler);
        clientA.emit(WebSocketRequestEvents.CANVAS_LIST, { requestId: uuidv4() });
      });

      const canvasY = canvases.find((c) => c.name === 'Canvas-Switch-Y');
      expect(canvasY).toBeDefined();

      await switchCanvas(clientA, canvasY!.id);

      const payload = await leftPromise;
      expect(payload.connectionId).toBe(clientAId);
    });

    it('新 Canvas 的連線不會收到舊 Canvas 的 cursor:left', async () => {
      const helper2 = await createSocketClient(server.baseUrl, server.canvasId);
      const canvasZId = await createCanvas(helper2, 'Canvas-Switch-Z');
      const canvasWId = await createCanvas(helper2, 'Canvas-Switch-W');
      await disconnectSocket(helper2);

      const clientD = await createSocketClient(server.baseUrl, canvasZId);
      const clientE = await createSocketClient(server.baseUrl, canvasWId);

      const receivedPromise = waitForEventWithTimeout<CursorLeftPayload>(
        clientE,
        WebSocketResponseEvents.CURSOR_LEFT,
        300
      );

      await switchCanvas(clientD, canvasWId);

      const received = await receivedPromise;
      expect(received).toBeNull();

      await disconnectSocket(clientD);
      await disconnectSocket(clientE);
    });
  });

  describe('顏色分配', () => {
    let clientA: TestWebSocketClient;
    let clientB: TestWebSocketClient;

    beforeAll(async () => {
      const helper = await createSocketClient(server.baseUrl, server.canvasId);
      const canvasId = await createCanvas(helper, 'Canvas-Colors');
      await disconnectSocket(helper);

      clientA = await createSocketClient(server.baseUrl, canvasId);
      clientB = await createSocketClient(server.baseUrl, canvasId);
    });

    afterAll(async () => {
      if (clientA?.connected) await disconnectSocket(clientA);
      if (clientB?.connected) await disconnectSocket(clientB);
    });

    it('同 Canvas 內不同連線分配不同顏色', async () => {
      const aReceivePromise = waitForEvent<CursorMovedPayload>(clientA, WebSocketResponseEvents.CURSOR_MOVED);
      const bReceivePromise = waitForEvent<CursorMovedPayload>(clientB, WebSocketResponseEvents.CURSOR_MOVED);

      clientB.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 10, y: 20 });
      const bReceivedByA = await aReceivePromise;

      clientA.emit(WebSocketRequestEvents.CURSOR_MOVE, { requestId: uuidv4(), x: 30, y: 40 });
      const aReceivedByB = await bReceivePromise;

      expect(bReceivedByA.color).not.toBe(aReceivedByB.color);
    });
  });

  describe('驗證失敗', () => {
    let client: TestWebSocketClient;

    beforeAll(async () => {
      client = await createSocketClient(server.baseUrl, server.canvasId);
    });

    afterAll(async () => {
      if (client?.connected) await disconnectSocket(client);
    });

    it('x 為字串時回傳錯誤', async () => {
      const errorPromise = waitForEvent<{ success: boolean; error?: string }>(
        client,
        'error'
      );

      client.emit(WebSocketRequestEvents.CURSOR_MOVE, {
        requestId: uuidv4(),
        x: 'invalid' as unknown as number,
        y: 100,
      });

      const response = await errorPromise;
      expect(response.success).toBe(false);
    });
  });
});
