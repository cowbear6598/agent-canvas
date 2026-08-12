import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

interface BridgeScope {
  capabilityToken: string;
  endpointUrl: string;
}

const ALLOWED_OPERATIONS = new Set([
  "search_workflows",
  "start_workflow",
  "get_run",
  "stop_run",
]);

function loadScope(): BridgeScope {
  const capabilityToken = process.env.AGENT_CANVAS_MCP_CAPABILITY;
  const endpointUrl = process.env.AGENT_CANVAS_MCP_ENDPOINT;
  if (!capabilityToken || !endpointUrl) {
    throw new Error("Agent Canvas MCP bridge 缺少必要環境變數");
  }
  return { capabilityToken, endpointUrl };
}

function result(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
}

export function listAgentCanvasTools(): { tools: Array<Record<string, unknown>> } {
  return {
    tools: [
      {
        name: "search_workflows",
        description: "搜尋目前 Canvas 中可啟動的 Workflow 源頭 Pod與獨立 Pod。",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "選填的名稱關鍵字" } },
        },
      },
      {
        name: "start_workflow",
        description: "非同步啟動目前 Canvas 的 Workflow 源頭；立即回傳 runId，不等待輸出。",
        inputSchema: {
          type: "object",
          properties: {
            podId: { type: "string" },
            message: { type: "string", minLength: 1 },
          },
          required: ["podId", "message"],
        },
      },
      {
        name: "get_run",
        description: "查詢目前 Canvas 中指定 Run 的狀態。",
        inputSchema: {
          type: "object",
          properties: { runId: { type: "string" } },
          required: ["runId"],
        },
      },
      {
        name: "stop_run",
        description: "停止並刪除目前 Canvas 中仍在執行的 Run。",
        inputSchema: {
          type: "object",
          properties: { runId: { type: "string" } },
          required: ["runId"],
        },
      },
    ],
  };
}

async function callBackend(
  scope: BridgeScope,
  operation: string,
  input: unknown,
): Promise<CallToolResult> {
  try {
    const response = await fetch(scope.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityToken: scope.capabilityToken,
        operation,
        input,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!response.ok) {
      return result(
        typeof body?.error === "string" ? body.error : `後端回傳 HTTP ${response.status}`,
        true,
      );
    }
    return result(JSON.stringify(body));
  } catch (error) {
    return result(
      `Agent Canvas backend 無法連線：${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
    );
  }
}

export async function runAgentCanvasMcpBridge(): Promise<void> {
  const scope = loadScope();
  const server = new Server(
    { name: "agent-canvas-mcp", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => listAgentCanvasTools());
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!ALLOWED_OPERATIONS.has(request.params.name)) {
      return result("未知的工具", true);
    }
    return callBackend(scope, request.params.name, request.params.arguments ?? {});
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
