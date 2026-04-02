import type { Server, ServerWebSocket } from "bun";
import { config } from "./config/index.js";
import { socketService } from "./services/socketService.js";
import { canvasStore } from "./services/canvasStore.js";
import { startupService } from "./services/startupService.js";
import { registerAllHandlers } from "./handlers/index.js";
import { connectionManager } from "./services/connectionManager.js";
import { eventRouter } from "./services/eventRouter.js";
import { broadcastCursorLeft } from "./handlers/cursorHandlers.js";
import { tryDeserialize } from "./utils/messageSerializer.js";
import { logger } from "./utils/logger.js";
import { WebSocketResponseEvents } from "./schemas/index.js";
import {
  isStaticFilesAvailable,
  serveStaticFile,
} from "./utils/staticFileServer.js";
import { handleApiRequest } from "./api/apiRouter.js";
import { handleIntegrationWebhook } from "./services/integration/integrationWebhookRouter.js";
import { integrationRegistry } from "./services/integration/index.js";
import { scheduleService } from "./services/scheduleService.js";
import { getResultErrorString } from "./types/result.js";
import { claudeService } from "./services/claude/claudeService.js";
import { podStore } from "./services/podStore.js";
import { runStore } from "./services/runStore.js";
import { runExecutionService } from "./services/workflow/runExecutionService.js";

function handleWebSocketUpgrade(
  req: Request,
  server: Server<{ connectionId: string }>,
): Response | undefined {
  const success = server.upgrade(req, { data: { connectionId: "" } });
  if (success) return undefined;
  return new Response("WebSocket 升級失敗", { status: 400 });
}

async function startServer(): Promise<void> {
  const result = await startupService.initialize();

  if (!result.success) {
    logger.error(
      "Startup",
      "Error",
      "伺服器啟動失敗",
      getResultErrorString(result.error),
    );
    process.exit(1);
  }

  socketService.initialize();
  registerAllHandlers();

  const PORT = config.port;

  const enableStaticFiles =
    config.nodeEnv === "production" && (await isStaticFilesAvailable());
  if (enableStaticFiles) {
    logger.log("Startup", "Complete", "已啟用前端靜態檔案服務");
  }

  Bun.serve<{ connectionId: string }>({
    port: PORT,
    hostname: "0.0.0.0",
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

      const origin = req.headers.get("origin");
      if (origin && !config.corsOrigin(origin)) {
        return new Response("Forbidden", { status: 403 });
      }

      const apiResponse = await handleApiRequest(req);
      if (apiResponse !== null) {
        return apiResponse;
      }

      const upgradeHeader = req.headers.get("upgrade");
      if (upgradeHeader?.toLowerCase() === "websocket") {
        return handleWebSocketUpgrade(req, server);
      }

      if (enableStaticFiles) {
        return serveStaticFile(req);
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(webSocket: ServerWebSocket<{ connectionId: string }>) {
        const connectionId = connectionManager.add(webSocket);
        webSocket.data = { connectionId };

        socketService.emitConnectionReady(connectionId, {
          socketId: connectionId,
        });

        logger.log("Connection", "Create", `新連線：${connectionId}`);
      },
      message(
        webSocket: ServerWebSocket<{ connectionId: string }>,
        message: string | Buffer,
      ) {
        const connectionId = webSocket.data.connectionId;

        const parseResult = tryDeserialize(message);
        if (!parseResult.success) {
          logger.error(
            "WebSocket",
            "Error",
            `訊息解析失敗: ${parseResult.error}`,
          );
          socketService.emitToConnection(connectionId, "error", {
            requestId: "",
            success: false,
            error: "無效的訊息格式",
            code: "INVALID_MESSAGE",
          });
          return;
        }

        const parsedMessage = parseResult.data;

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
          logger.error("WebSocket", "Error", `訊息路由失敗: ${error}`, error);
          socketService.emitToConnection(connectionId, "error", {
            requestId: parsedMessage.requestId,
            success: false,
            error: "訊息處理失敗，請稍後再試",
            code: "ROUTING_ERROR",
          });
        });
      },
      close(webSocket: ServerWebSocket<{ connectionId: string }>) {
        const connectionId = webSocket.data.connectionId;

        // 廣播游標離開事件（必須在 cleanupSocket 前執行，否則 room 資訊已被清除）
        broadcastCursorLeft(connectionId);

        socketService.cleanupSocket(connectionId);
        canvasStore.removeSocket(connectionId);

        logger.log("Connection", "Delete", `連線關閉：${connectionId}`);
      },
    },
  });

  logger.log("Startup", "Complete", `伺服器運行於 port ${PORT}`);
  console.log("=============================");
}

startServer();

const shutdown = async (signal: string): Promise<void> => {
  logger.log("Shutdown", "Init", `收到 ${signal}，正在優雅關閉`);

  // 步驟 1：中止所有活躍的 Claude 查詢
  const abortedCount = claudeService.abortAllQueries();
  if (abortedCount > 0) {
    logger.log(
      "Shutdown",
      "Complete",
      `已中止 ${abortedCount} 個活躍的 Claude 查詢`,
    );
  }

  // 步驟 2：重設所有 busy 狀態的 Pod 為 idle（僅更新 DB，不廣播）
  const resetCount = podStore.resetAllBusyPods();
  if (resetCount > 0) {
    logger.log(
      "Shutdown",
      "Complete",
      `已重設 ${resetCount} 個 busy Pod 為 idle`,
    );
  }

  // 步驟 3：刪除所有 running 狀態的 Run（含 worktree 清理）
  const runningRuns = runStore.getRunningRuns();
  if (runningRuns.length > 0) {
    logger.log(
      "Shutdown",
      "Complete",
      `正在清理 ${runningRuns.length} 個執行中的 Run`,
    );
    await Promise.all(
      runningRuns.map((run) =>
        runExecutionService.deleteRun(run.id).catch((error) => {
          logger.error(
            "Shutdown",
            "Error",
            `清理 Run ${run.id} 時發生錯誤: ${error}`,
          );
        }),
      ),
    );
  }

  for (const provider of integrationRegistry.list()) {
    provider.destroyAll();
  }
  scheduleService.stop();
  socketService.stopHeartbeat();

  logger.log("Shutdown", "Complete", "伺服器已成功關閉");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// 全域錯誤處理：防止 SDK 內部的未捕獲錯誤 crash 整個應用程式
process.on("uncaughtException", (error) => {
  console.error("[全域錯誤處理] 未捕獲的例外:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[全域錯誤處理] 未處理的 Promise rejection:", reason);
});
