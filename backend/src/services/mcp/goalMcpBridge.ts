import {
  GOAL_MCP_TOOL_NAMES,
  buildGoalRuntimeActiveTodoResult,
  blockGoalRuntime,
  buildGoalRuntimeToolResult,
  completeGoalTodo,
  readGoalRuntimeSnapshot,
  writeGoalRuntimeSnapshot,
} from "../goalRuntime.js";

/**
 * Goal Runtime stdio MCP bridge。
 *
 * 由 cli.ts 在收到 --goal-bridge flag 時呼叫 runGoalMcpBridge() 進入。
 * 不能在 module top-level 直接執行（避免 cli.ts import 時搶 stdin）。
 */

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const protocolVersion = "2025-06-18";

function getStatePath(): string {
  return process.env.AGENT_CANVAS_GOAL_STATE_PATH ?? "";
}

function writeMessage(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id: JsonRpcId, result: Record<string, unknown>): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function loadSnapshot(): ReturnType<typeof readGoalRuntimeSnapshot> {
  const statePath = getStatePath();
  if (!statePath) return null;
  return readGoalRuntimeSnapshot(statePath);
}

function toolTextResult<T extends object>(payload: T): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
  };
}

function handleGetGoalStatus(id: JsonRpcId): void {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    writeResult(
      id,
      toolTextResult({
        status: "completed",
        activeTodoId: null,
        activeTodoText: null,
        nextTodoId: null,
        nextTodoText: null,
        completedTodoIds: [],
        blockedReason: null,
        handoffSummary: null,
        completedCount: 0,
        totalCount: 0,
      }),
    );
    return;
  }

  writeResult(id, toolTextResult(buildGoalRuntimeToolResult(snapshot)));
}

function handleGetActiveGoalTodo(id: JsonRpcId): void {
  writeResult(id, toolTextResult(buildGoalRuntimeActiveTodoResult(loadSnapshot())));
}

function handleCompleteGoalTodo(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
): void {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    writeResult(id, {
      ...toolTextResult({
        error: "Goal Runtime 不存在",
      }),
      isError: true,
    });
    return;
  }

  const todoId = typeof params?.todoId === "string" ? params.todoId : undefined;
  const handoffSummary =
    typeof params?.handoffSummary === "string" ? params.handoffSummary : null;

  const nextState = completeGoalTodo(
    snapshot.goal,
    snapshot.state,
    todoId,
    handoffSummary,
  );
  const nextSnapshot = {
    ...snapshot,
    state: nextState,
  };
  writeGoalRuntimeSnapshot(getStatePath(), nextSnapshot);
  writeResult(id, toolTextResult(buildGoalRuntimeToolResult(nextSnapshot)));
}

function handleBlockGoalProgress(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
): void {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    writeResult(id, {
      ...toolTextResult({
        error: "Goal Runtime 不存在",
      }),
      isError: true,
    });
    return;
  }

  const blockedReason =
    typeof params?.blockedReason === "string"
      ? params.blockedReason.trim()
      : "";
  if (!blockedReason) {
    writeResult(id, {
      ...toolTextResult({
        error: "blockedReason 為必填",
      }),
      isError: true,
    });
    return;
  }

  const handoffSummary =
    typeof params?.handoffSummary === "string" ? params.handoffSummary : null;

  const nextSnapshot = {
    ...snapshot,
    state: blockGoalRuntime(snapshot.state, blockedReason, handoffSummary),
  };
  writeGoalRuntimeSnapshot(getStatePath(), nextSnapshot);
  writeResult(id, toolTextResult(buildGoalRuntimeToolResult(nextSnapshot)));
}

function handleToolsCall(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
): void {
  const name = typeof params?.name === "string" ? params.name : "";
  const argumentsPayload =
    params?.arguments &&
    typeof params.arguments === "object" &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : undefined;

  if (name === GOAL_MCP_TOOL_NAMES.GET_ACTIVE_TODO) {
    handleGetActiveGoalTodo(id);
    return;
  }
  if (name === GOAL_MCP_TOOL_NAMES.GET_STATUS) {
    handleGetGoalStatus(id);
    return;
  }
  if (name === GOAL_MCP_TOOL_NAMES.COMPLETE_TODO) {
    handleCompleteGoalTodo(id, argumentsPayload);
    return;
  }
  if (name === GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS) {
    handleBlockGoalProgress(id, argumentsPayload);
    return;
  }

  writeError(id, -32601, `Unknown tool: ${name}`);
}

function handleRequest(request: JsonRpcRequest): void {
  const id = request.id ?? null;
  const method = request.method ?? "";

  if (method === "initialize") {
    const requestedVersion =
      typeof request.params?.protocolVersion === "string"
        ? request.params.protocolVersion
        : protocolVersion;

    writeResult(id, {
      protocolVersion: requestedVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "agent-canvas-goal-runtime",
        version: "1.0.0",
      },
      instructions:
        "Use get_active_goal_todo when you only need to know the current todo. Use get_goal_status only when you need full progress/debug state. Use complete_goal_todo after finishing the active todo, and block_goal_progress when the Pod is blocked.",
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    writeResult(id, {});
    return;
  }

  if (method === "tools/list") {
    writeResult(id, {
      tools: [
        {
          name: GOAL_MCP_TOOL_NAMES.GET_ACTIVE_TODO,
          description:
            "Read only the current active todo id and text. Prefer this when deciding what to work on next.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: GOAL_MCP_TOOL_NAMES.GET_STATUS,
          description:
            "Read the full Goal Runtime state for progress/debug checks.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: GOAL_MCP_TOOL_NAMES.COMPLETE_TODO,
          description:
            "Mark the active todo as completed and return the next todo or final completion state.",
          inputSchema: {
            type: "object",
            properties: {
              todoId: {
                type: "string",
                description:
                  "Optional explicit todo id. Omit to complete the current active todo.",
              },
              handoffSummary: {
                type: "string",
                description:
                  "Optional summary for the next todo or downstream handoff.",
              },
            },
          },
        },
        {
          name: GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS,
          description:
            "Report that the current Goal Runtime is blocked and record the blocking reason.",
          inputSchema: {
            type: "object",
            properties: {
              blockedReason: {
                type: "string",
                description: "Required explanation of why progress is blocked.",
              },
              handoffSummary: {
                type: "string",
                description:
                  "Optional summary of what is done so far and what the next human or agent should know.",
              },
            },
            required: ["blockedReason"],
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    handleToolsCall(id, request.params);
    return;
  }

  if (id !== null) {
    writeError(id, -32601, `Unsupported method: ${method}`);
  }
}

export function runGoalMcpBridge(): void {
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        handleRequest(JSON.parse(trimmed) as JsonRpcRequest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeError(null, -32700, message);
      }
    }
  });

  process.stdin.on("end", () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    try {
      handleRequest(JSON.parse(trimmed) as JsonRpcRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeError(null, -32700, message);
    }
  });
}
