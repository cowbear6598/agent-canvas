import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { promises as fs } from "fs";

import {
  getManagedMcpSurfaceErrorsPath,
  readManagedMcpSurfaceState,
  type ManagedMcpSurfaceState,
  type ManagedMcpSurfaceTarget,
  type ManagedMcpSurfaceTargetError,
} from "./managedMcpSurfaceService.js";

interface SurfaceToolRoute {
  targetName: string;
  upstreamToolName: string;
  client: Client;
  tool: Tool;
}

function buildSurfaceToolName(targetName: string, toolName: string): string {
  return `${targetName}__${toolName}`;
}

function parseSurfaceStatePath(): string {
  return process.env.AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH ?? "";
}

async function connectTargetClient(
  target: ManagedMcpSurfaceTarget,
): Promise<Client> {
  const client = new Client({
    name: "agent-canvas-managed-mcp-surface-bridge",
    version: "1.0.0",
  });

  if (target.transport === "stdio") {
    const serverParams: StdioServerParameters = {
      command: target.command ?? "",
      args: target.args,
      env: target.env,
      cwd: target.cwd ?? undefined,
      stderr: "ignore",
    };
    await client.connect(new StdioClientTransport(serverParams));
    return client;
  }

  const url = new URL(target.url ?? "");
  if (target.transport === "sse") {
    await client.connect(new SSEClientTransport(url));
    return client;
  }

  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}

async function buildToolRoutes(
  state: ManagedMcpSurfaceState,
  errors: ManagedMcpSurfaceTargetError[],
): Promise<Map<string, SurfaceToolRoute>> {
  const routes = new Map<string, SurfaceToolRoute>();

  await Promise.all(
    state.targets.map(async (target) => {
      try {
        const client = await connectTargetClient(target);
        const { tools } = await client.listTools();

        for (const tool of tools) {
          routes.set(buildSurfaceToolName(target.name, tool.name), {
            targetName: target.name,
            upstreamToolName: tool.name,
            client,
            tool,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[managed-mcp-surface] target "${target.name}" skipped: ${message}`,
        );
        errors.push({ name: target.name, message });
      }
    }),
  );

  return routes;
}

async function writeBridgeErrors(
  statePath: string,
  errors: ManagedMcpSurfaceTargetError[],
): Promise<void> {
  if (errors.length === 0) return;
  const errorsPath = getManagedMcpSurfaceErrorsPath(statePath);
  try {
    await fs.writeFile(errorsPath, JSON.stringify(errors, null, 2), "utf-8");
  } catch (err) {
    // 寫入失敗只記 stderr，不阻止 bridge 啟動。
    console.error(
      `[managed-mcp-surface] failed to write errors file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function toSurfaceTools(routes: Map<string, SurfaceToolRoute>): Tool[] {
  return [...routes.entries()].map(([surfaceToolName, route]) => ({
    ...route.tool,
    name: surfaceToolName,
  }));
}

async function closeClients(
  routes: Map<string, SurfaceToolRoute>,
): Promise<void> {
  const uniqueClients = new Set<Client>();
  for (const route of routes.values()) {
    uniqueClients.add(route.client);
  }
  await Promise.all([...uniqueClients].map((client) => client.close()));
}

async function main(): Promise<void> {
  const statePath = parseSurfaceStatePath();
  if (!statePath) {
    throw new Error("AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH is required");
  }

  const state = await readManagedMcpSurfaceState(statePath);
  if (!state) {
    throw new Error(`managed MCP surface state not found: ${statePath}`);
  }

  const bridgeErrors: ManagedMcpSurfaceTargetError[] = [];
  const routes = await buildToolRoutes(state, bridgeErrors);
  // 在啟動 stdio server 前先把 per-target 失敗寫到 errors.json，
  // 由 surface cleanup 階段把錯誤回寫 managedMcpStore.lastError。
  await writeBridgeErrors(statePath, bridgeErrors);
  const server = new Server(
    {
      name: "agent-canvas-managed-mcp-surface",
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
    tools: toSurfaceTools(routes),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const route = routes.get(toolName);
    if (!route) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolName}`,
          },
        ],
        isError: true,
      } satisfies CallToolResult;
    }

    return route.client.callTool(
      {
        name: route.upstreamToolName,
        arguments: request.params.arguments,
      },
      CallToolResultSchema,
    );
  });

  const transport = new StdioServerTransport();
  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([server.close(), closeClients(routes)]);
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("exit", () => {
    void cleanup();
  });

  await server.connect(transport);
}

void main().catch((error) => {
  console.error(
    `[managed-mcp-surface] bridge failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
