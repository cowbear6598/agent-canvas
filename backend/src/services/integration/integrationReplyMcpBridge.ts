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
import { logger } from "../../utils/logger.js";
import { podStore } from "../podStore.js";
import { integrationAppStore } from "./integrationAppStore.js";
import {
  stableJsonStringify,
  verifyIntegrationReplyCapability,
} from "./integrationReplyCapability.js";
import { integrationRegistry } from "./integrationRegistry.js";
import type { IntegrationProvider } from "./types.js";
import "./providers/index.js";

export interface ReplyBridgeScope {
  provider: string;
  appId: string;
  resourceId: string;
  podId: string;
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
    throw new Error("JSON value is not an object");
  } catch (error) {
    logger.error(
      "Integration",
      "Error",
      "Integration Reply MCP bridge JSON 解析失敗",
      error,
    );
    throw new Error("Integration Reply MCP bridge JSON 解析失敗");
  }
}

function assertSameValue(
  field: string,
  envValue: string | undefined,
  tokenValue: string,
): void {
  if (envValue !== undefined && envValue !== tokenValue) {
    throw new Error(`Integration Reply MCP bridge scope 不一致：${field}`);
  }
}

function assertSameObject(
  field: string,
  envValue: Record<string, unknown>,
  tokenValue: Record<string, unknown>,
): void {
  if (stableJsonStringify(envValue) !== stableJsonStringify(tokenValue)) {
    throw new Error(`Integration Reply MCP bridge scope 不一致：${field}`);
  }
}

function validatePodBinding(scope: ReplyBridgeScope): void {
  const app = integrationAppStore.getById(scope.appId);
  if (!app || app.provider !== scope.provider) {
    throw new Error("Integration Reply MCP bridge app scope 驗證失敗");
  }

  const podRecord = podStore.getByIdGlobal(scope.podId);
  const binding = podRecord?.pod.integrationBindings?.find(
    (item) =>
      item.provider === scope.provider &&
      item.appId === scope.appId &&
      item.resourceId === scope.resourceId,
  );
  if (!binding) {
    throw new Error("Integration Reply MCP bridge pod binding 驗證失敗");
  }
}

function loadScopeFromEnv(): ReplyBridgeScope {
  const token = process.env.AGENT_CANVAS_INTEGRATION_REPLY_CAPABILITY;
  if (!token) {
    throw new Error("Integration Reply MCP bridge 缺少 capability token");
  }

  const provider = process.env.AGENT_CANVAS_INTEGRATION_REPLY_PROVIDER;
  const appId = process.env.AGENT_CANVAS_INTEGRATION_REPLY_APP_ID;
  const resourceId = process.env.AGENT_CANVAS_INTEGRATION_REPLY_RESOURCE_ID;
  const podId = process.env.AGENT_CANVAS_INTEGRATION_REPLY_POD_ID;
  const extra = parseJsonObject(process.env.AGENT_CANVAS_INTEGRATION_REPLY_EXTRA);
  const replyContext = parseJsonObject(
    process.env.AGENT_CANVAS_INTEGRATION_REPLY_CONTEXT,
  );

  if (!provider || !appId || !resourceId || !podId) {
    throw new Error("Integration Reply MCP bridge 缺少必要環境變數");
  }

  const verified = verifyIntegrationReplyCapability(token);
  assertSameValue("provider", provider, verified.provider);
  assertSameValue("appId", appId, verified.appId);
  assertSameValue("resourceId", resourceId, verified.resourceId);
  assertSameValue("podId", podId, verified.podId);
  assertSameObject("extra", extra, verified.extra);
  assertSameObject("replyContext", replyContext, verified.replyContext);

  const scope: ReplyBridgeScope = {
    provider: verified.provider,
    appId: verified.appId,
    resourceId: verified.resourceId,
    podId: verified.podId,
    extra: verified.extra,
    replyContext: verified.replyContext,
  };
  validatePodBinding(scope);
  return scope;
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

export function listIntegrationReplyTools(
  scope: ReplyBridgeScope,
  provider: IntegrationProvider,
): { tools: Array<Record<string, unknown>> } {
  const toolName = `${scope.provider}_reply`;
  return {
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
  };
}

export async function callIntegrationReplyTool(
  scope: ReplyBridgeScope,
  provider: IntegrationProvider,
  request: { name: string; arguments?: unknown },
): Promise<CallToolResult> {
  const toolName = `${scope.provider}_reply`;
  const { name, arguments: args } = request;
  if (name !== toolName) {
    return errorResult(`未知的工具：${name}`);
  }

  const text =
    args &&
    typeof args === "object" &&
    typeof (args as { text?: unknown }).text === "string"
      ? (args as { text: string }).text.trim()
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
}

export async function runIntegrationReplyMcpBridge(): Promise<void> {
  const scope = loadScopeFromEnv();
  const provider = integrationRegistry.get(scope.provider);
  if (!provider?.sendMessage) {
    throw new Error(`Integration provider 不支援回覆：${scope.provider}`);
  }

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

  server.setRequestHandler(ListToolsRequestSchema, async () =>
    listIntegrationReplyTools(scope, provider),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callIntegrationReplyTool(scope, provider, request.params),
  );

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
