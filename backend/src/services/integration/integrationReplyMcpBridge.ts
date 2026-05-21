/**
 * Integration Reply MCP Bridge.
 *
 * Exposes one run-scoped reply tool for a Pod integration binding.
 * The parent process passes binding scope and reply context via env because
 * stdio MCP children cannot access the parent's in-memory replyContextStore.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { getResultErrorString } from "../../types/result.js";
import { integrationRegistry } from "./integrationRegistry.js";
import "./providers/index.js";

interface ReplyBridgeScope {
  provider: string;
  appId: string;
  resourceId: string;
  extra: Record<string, unknown>;
  replyContext: Record<string, unknown>;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty object.
  }
  return {};
}

function loadScopeFromEnv(): ReplyBridgeScope {
  const provider = process.env.AGENT_CANVAS_INTEGRATION_REPLY_PROVIDER ?? "";
  const appId = process.env.AGENT_CANVAS_INTEGRATION_REPLY_APP_ID ?? "";
  const resourceId =
    process.env.AGENT_CANVAS_INTEGRATION_REPLY_RESOURCE_ID ?? "";

  if (!provider || !appId || !resourceId) {
    throw new Error("Integration Reply MCP bridge 缺少必要環境變數");
  }

  return {
    provider,
    appId,
    resourceId,
    extra: parseJsonObject(process.env.AGENT_CANVAS_INTEGRATION_REPLY_EXTRA),
    replyContext: parseJsonObject(
      process.env.AGENT_CANVAS_INTEGRATION_REPLY_CONTEXT,
    ),
  };
}

function successResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function runIntegrationReplyMcpBridge(): Promise<void> {
  const scope = loadScopeFromEnv();
  const provider = integrationRegistry.get(scope.provider);
  if (!provider?.sendMessage) {
    throw new Error(`Integration provider 不支援回覆：${scope.provider}`);
  }

  const toolName = `${scope.provider}_reply`;
  const server = new Server(
    {
      name: `agent-canvas-${scope.provider}-reply-mcp`,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: toolName,
        description: `回覆 ${provider.displayName} 訊息。當需要在 ${provider.displayName} 中回覆用戶時使用此工具。`,
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              minLength: 1,
              description: "要發送的訊息內容",
            },
          },
          required: ["text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name !== toolName) {
      return errorResult(`未知的工具：${name}`);
    }

    const text =
      args && typeof args === "object" && typeof args.text === "string"
        ? args.text.trim()
        : "";
    if (!text) {
      return errorResult("text 為必填");
    }

    const result = await provider.sendMessage!(
      scope.appId,
      scope.resourceId,
      text,
      {
        ...scope.extra,
        ...scope.replyContext,
      },
    );

    if (!result.success) {
      return errorResult(`錯誤: ${getResultErrorString(result.error)}`);
    }
    return successResult("success");
  });

  const stdio = new StdioServerTransport();
  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([server.close()]);
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  await server.connect(stdio);
}

