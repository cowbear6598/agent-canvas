import type { Server, ServerWebSocket } from "bun";
import { overrideConfig, testConfig } from "./testConfig.js";
import type { ConnectionSocketData } from "../../src/types/websocket.js";

// 注意：不要在頂層 import 使用 config 的模組，這些模組需要在 overrideConfig() 之後動態 import

export interface TestServerInstance {
  server: Server<ConnectionSocketData>;
  baseUrl: string;
  wsUrl: string;
  port: number;
  canvasId: string;
  canvasDataDir: string;
}

const TEST_HOSTNAME = "127.0.0.1";
const TEST_PORT_BASE = 47000;
const TEST_PORT_BLOCK = 200;
const TEST_PORT_RETRY_COUNT = 200;
const workerId = Number(process.env.VITEST_POOL_ID ?? "0");
const initialTestPort =
  TEST_PORT_BASE + (workerId % 50) * TEST_PORT_BLOCK + (process.pid % 10) * 10;
const TEST_PORT_COUNTER_KEY = "__claudeCodeCanvasBackendTestServerNextPort";

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "EADDRINUSE"
  );
}

function getNextTestPort(): number {
  const testGlobal = globalThis as typeof globalThis & {
    __claudeCodeCanvasBackendTestServerNextPort?: number;
  };

  if (testGlobal[TEST_PORT_COUNTER_KEY] === undefined) {
    testGlobal[TEST_PORT_COUNTER_KEY] = initialTestPort;
  }

  const port =
    testGlobal[TEST_PORT_COUNTER_KEY] ??
    initialTestPort;
  testGlobal[TEST_PORT_COUNTER_KEY] = port + 1;
  return port;
}

function startServerWithRetry(
  createOptions: (port: number) => Parameters<typeof Bun.serve>[0],
): Server<ConnectionSocketData> {
  let lastError: unknown;

  for (let attempt = 0; attempt < TEST_PORT_RETRY_COUNT; attempt += 1) {
    const port = getNextTestPort();
    try {
      return Bun.serve<ConnectionSocketData>(createOptions(port));
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to allocate a backend test server port.");
}

/**
 * 建立測試用 Server
 * 使用動態 Port 避免衝突
 * 初始化 startupService 以載入資料
 */
export async function createTestServer(): Promise<TestServerInstance> {
  await overrideConfig();

  const { socketService } = await import("../../src/services/socketService.js");
  const { startupService } =
    await import("../../src/services/startupService.js");
  const { canvasStore } = await import("../../src/services/canvasStore.js");
  const { registerAllHandlers } = await import("../../src/handlers/index.js");
  const { connectionManager } =
    await import("../../src/services/connectionManager.js");
  const { cursorColorManager } =
    await import("../../src/services/cursorColorManager.js");
  const { eventRouter } = await import("../../src/services/eventRouter.js");
  const { deserialize } = await import("../../src/utils/messageSerializer.js");
  const { handleApiRequest } = await import("../../src/api/apiRouter.js");
  const { handleIntegrationWebhook } =
    await import("../../src/services/integration/integrationWebhookRouter.js");
  const { logger } = await import("../../src/utils/logger.js");
  const { WebSocketResponseEvents } =
    await import("../../src/schemas/index.js");
  const { handshakeAuthService } =
    await import("../../src/services/auth/handshakeAuthService.js");
  const { stopBackgroundTestTimers } = await import("./testResourceCleanup.js");

  const result = await startupService.initialize();
  if (!result.success) {
    throw new Error(`Failed to initialize test server: ${result.error}`);
  }
  // 測試 server 只需要初始化資料與 handler；背景排程會跨測試讀寫 DB，
  // 在其他測試重置/關閉 DB 時造成非預期的 SQLite I/O error。
  await stopBackgroundTestTimers();

  const canvases = canvasStore.list();
  const defaultCanvas = canvases[0];
  const canvasDataDir = canvasStore.getCanvasDataDir(defaultCanvas.id);

  if (!canvasDataDir) {
    throw new Error("Failed to get canvas data directory");
  }

  socketService.initialize();
  registerAllHandlers();

  const server = startServerWithRetry((port) => ({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // integration webhook 路由來自外部服務，不需要 CORS origin 驗證
      if (req.method === "POST") {
        const webhookResponse = await handleIntegrationWebhook(
          req,
          url.pathname,
        );
        if (webhookResponse) return webhookResponse;
      }

      // 檢查 CORS Origin
      const origin = req.headers.get("origin");
      if (origin && origin !== testConfig.corsOrigin) {
        return new Response("Forbidden", { status: 403 });
      }

      const apiResponse = await handleApiRequest(req);
      if (apiResponse !== null) {
        return apiResponse;
      }

      const remoteIp = server.requestIP(req)?.address ?? null;
      const success = server.upgrade(
        req,
        handshakeAuthService.resolveUpgrade(req, remoteIp),
      );
      if (success) return undefined;

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<ConnectionSocketData>) {
        const connectionId = connectionManager.add(ws);
        ws.data = { ...ws.data, connectionId };

        socketService.emitConnectionReady(connectionId, {
          socketId: connectionId,
        });

        logger.log("Connection", "Create", `New connection: ${connectionId}`);
      },
      message(
        ws: ServerWebSocket<ConnectionSocketData>,
        message: string | Buffer,
      ) {
        const connectionId = ws.data.connectionId;

        try {
          const parsedMessage = deserialize(message);

          if (parsedMessage.type === WebSocketResponseEvents.HEARTBEAT_PONG) {
            socketService.handleHeartbeatPong(connectionId);
            return;
          }

          if (
            parsedMessage.type === "ack" &&
            parsedMessage.ackId?.startsWith("heartbeat-")
          ) {
            socketService.handleHeartbeatPong(connectionId);
            return;
          }

          eventRouter.route(connectionId, parsedMessage).catch((error) => {
            logger.error(
              "WebSocket",
              "Error",
              `Failed to route message: ${error}`,
              error,
            );
            socketService.emitToConnection(connectionId, "error", {
              requestId: parsedMessage.requestId,
              success: false,
              error:
                error instanceof Error ? error.message : "處理訊息時發生錯誤",
              code: "ROUTING_ERROR",
            });
          });
        } catch (error) {
          logger.error(
            "WebSocket",
            "Error",
            `Failed to parse message: ${error}`,
            error,
          );
          socketService.emitToConnection(connectionId, "error", {
            requestId: "",
            success: false,
            error: "無效的訊息格式",
            code: "INVALID_MESSAGE",
          });
        }
      },
      close(ws: ServerWebSocket<ConnectionSocketData>) {
        const connectionId = ws.data.connectionId;

        // 必須在 cleanupSocket 前執行，否則 room 資訊已被清除
        const canvasId = connectionManager.getCanvasId(connectionId);
        if (canvasId) {
          socketService.emitToCanvasExcept(
            canvasId,
            connectionId,
            WebSocketResponseEvents.CURSOR_LEFT,
            { connectionId },
          );
          cursorColorManager.releaseColor(canvasId, connectionId);
        }

        socketService.cleanupSocket(connectionId);
        canvasStore.removeSocket(connectionId);

        logger.log(
          "Connection",
          "Delete",
          `Connection closed: ${connectionId}`,
        );
      },
    },
  }));

  const port = server.port;
  const baseUrl = `http://${TEST_HOSTNAME}:${port}`;
  const wsUrl = `ws://${TEST_HOSTNAME}:${port}`;

  return {
    server,
    baseUrl,
    wsUrl,
    port: server.port ?? 0,
    canvasId: defaultCanvas.id,
    canvasDataDir,
  };
}

/**
 * 關閉測試 Server
 * 處理優雅關閉
 */
export async function closeTestServer(
  server: TestServerInstance,
): Promise<void> {
  const { socketService } = await import("../../src/services/socketService.js");
  const { stopBackgroundTestTimers } = await import("./testResourceCleanup.js");

  await stopBackgroundTestTimers();
  socketService.stopHeartbeat();

  server.server.stop();
}
