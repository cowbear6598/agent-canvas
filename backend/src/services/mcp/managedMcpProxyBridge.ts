/**
 * 單一 managed MCP 的 stdio↔remote proxy bridge。
 *
 * 用途：Claude SDK 只支援 stdio transport 的 MCP server，但 managed MCP
 * registry 可能含有 http / sse target。此 bridge 對 agent 端開 stdio，
 * 對下游 target 用其原生 transport（http / sse）建立連線，將 tools/list
 * 與 tools/call 原樣 passthrough（不改 tool 名）。
 *
 * 由 cli.ts 在收到 --mcp-proxy-bridge flag 時呼叫 runManagedMcpProxyBridge()
 * 進入；參數透過環境變數傳遞（AGENT_CANVAS_MCP_PROXY_NAME / _TRANSPORT / _URL）。
 *
 * 設計差異 vs 已廢棄的 managedMcpSurfaceBridge：
 *   - 只代理「單一 target」而非 N 個（每個 target 自己一個 bridge process）
 *   - 不寫 state file / errors.json — 失敗只寫 stderr
 *   - 不改 tool 名（不加 `<targetName>__` 前綴）
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type ProxyTransport = "http" | "sse";

function readEnv(): {
  targetName: string;
  transport: ProxyTransport;
  url: string;
} {
  const targetName = process.env.AGENT_CANVAS_MCP_PROXY_NAME ?? "";
  const transportRaw = process.env.AGENT_CANVAS_MCP_PROXY_TRANSPORT ?? "";
  const url = process.env.AGENT_CANVAS_MCP_PROXY_URL ?? "";

  if (!targetName || !url) {
    throw new Error(
      "managed MCP proxy bridge 缺少必要環境變數：AGENT_CANVAS_MCP_PROXY_NAME / AGENT_CANVAS_MCP_PROXY_URL",
    );
  }
  if (transportRaw !== "http" && transportRaw !== "sse") {
    throw new Error(
      `managed MCP proxy bridge 不支援的 transport：${transportRaw || "(空)"}（只接受 http 或 sse）`,
    );
  }

  return { targetName, transport: transportRaw, url };
}

async function connectUpstream(
  transport: ProxyTransport,
  url: URL,
  targetName: string,
): Promise<Client> {
  const client = new Client(
    {
      name: `agent-canvas-managed-mcp-proxy-${targetName}`,
      version: "1.0.0",
    },
    { capabilities: {} },
  );
  if (transport === "sse") {
    await client.connect(new SSEClientTransport(url));
  } else {
    await client.connect(new StreamableHTTPClientTransport(url));
  }
  return client;
}

async function runBridgeMain(): Promise<void> {
  const { targetName, transport, url: urlString } = readEnv();
  const url = new URL(urlString);

  const upstreamClient = await connectUpstream(transport, url, targetName);

  const server = new Server(
    {
      name: `agent-canvas-managed-mcp-proxy-${targetName}`,
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
    upstreamClient.listTools(),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    upstreamClient.callTool(
      {
        name: request.params.name,
        arguments: request.params.arguments,
      },
      CallToolResultSchema,
    ),
  );

  const stdio = new StdioServerTransport();

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([server.close(), upstreamClient.close()]);
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  await server.connect(stdio);
}

export async function runManagedMcpProxyBridge(): Promise<void> {
  try {
    await runBridgeMain();
  } catch (error) {
    console.error(
      `[managed-mcp-proxy] bridge failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
