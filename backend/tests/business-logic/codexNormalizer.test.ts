/**
 * CodexNormalizer 單元測試
 *
 * 測試 normalize(line) 的各種輸入 → NormalizedEvent 映射。
 */

import { describe, it, expect } from "vitest";
import { normalize } from "../../src/services/provider/codexNormalizer.js";

// ── Helper：把物件序列化成一行 JSON 字串 ──────────────────────────────
function toLine(obj: object): string {
  return JSON.stringify(obj);
}

describe("CodexNormalizer - normalize()", () => {
  // ── Case 1：thread.started → session_started ───────────────────────
  it("thread.started envelope 應映射為 session_started，含 sessionId", () => {
    const line = toLine({ type: "thread.started", thread_id: "thread-abc123" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_started");
    expect(
      (result as Extract<typeof result, { type: "session_started" }>)
        ?.sessionId,
    ).toBe("thread-abc123");
  });

  // ── Case 2：item.completed + agent_message → text ──────────────────
  it("item.completed 且 item_type=agent_message 應映射為 text", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "item-001",
        type: "agent_message",
        text: "Hello, World!",
      },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("text");
    expect((result as Extract<typeof result, { type: "text" }>)?.content).toBe(
      "Hello, World!",
    );
  });

  // ── Case 3：item.completed + reasoning → thinking ──────────────────
  it("item.completed 且 item_type=reasoning 應映射為 thinking", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "item-002",
        type: "reasoning",
        text: "讓我想想這個問題...",
      },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("thinking");
    expect(
      (result as Extract<typeof result, { type: "thinking" }>)?.content,
    ).toBe("讓我想想這個問題...");
  });

  // ── Case 4：item.started + command_execution → tool_call_start ──────
  it("item.started 且 item_type=command_execution 應映射為 tool_call_start", () => {
    const line = toLine({
      type: "item.started",
      item: {
        id: "cmd-001",
        type: "command_execution",
        command: "ls -la",
      },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call_start");
    const e = result as Extract<typeof result, { type: "tool_call_start" }>;
    expect(e?.toolUseId).toBe("cmd-001");
    expect(e?.toolName).toBe("shell");
    expect(e?.input).toEqual({ command: "ls -la" });
  });

  // ── Case 5：item.completed + command_execution → tool_call_result ───
  it("item.completed 且 item_type=command_execution 應映射為 tool_call_result", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "cmd-002",
        type: "command_execution",
        command: "cat README.md",
        aggregated_output: "# My Project\n",
        exit_code: 0,
        status: "success",
      },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e?.toolUseId).toBe("cmd-002");
    expect(e?.toolName).toBe("shell");
    expect(e?.output).toBe("# My Project\n");
  });

  it("item.started 且 item_type=mcp_tool_call 應映射為 Goal MCP 的 tool_call_start", () => {
    const line = toLine({
      type: "item.started",
      item: {
        id: "mcp-001",
        type: "mcp_tool_call",
        server: "agent_canvas_goal",
        tool: "complete_goal_todo",
        arguments: { todoId: "todo-1" },
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("tool_call_start");
    const e = result as Extract<typeof result, { type: "tool_call_start" }>;
    expect(e.toolUseId).toBe("mcp-001");
    expect(e.toolName).toBe("mcp__agent_canvas_goal__complete_goal_todo");
    expect(e.input).toEqual({ todoId: "todo-1" });
  });

  it("item.completed 且 item_type=mcp_tool_call 應映射為 Goal MCP 的 tool_call_result", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "mcp-002",
        type: "mcp_tool_call",
        server: "agent_canvas_goal",
        tool: "block_goal_progress",
        result: {
          content: [{ type: "text", text: '{"status":"blocked"}' }],
        },
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e.toolUseId).toBe("mcp-002");
    expect(e.toolName).toBe("mcp__agent_canvas_goal__block_goal_progress");
    expect(e.output).toBe('{"status":"blocked"}');
  });

  it("item.completed 的 result.structured_content 顯式為 null 時，應 fallback 到 content[].text 而非輸出字串 'null'", () => {
    // codex Rust 端 structured_content: Option<JsonValue> 未標 skip_serializing_if，
    // 故 None 會 serialize 成顯式 null；不該被當成有結構化輸出。
    const line = toLine({
      type: "item.completed",
      item: {
        id: "mcp-002e",
        type: "mcp_tool_call",
        server: "everything-sse",
        tool: "get_sum",
        arguments: { a: 19, b: 23 },
        result: {
          content: [{ type: "text", text: "42" }],
          structured_content: null,
        },
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e.output).toBe("42");
  });

  it("item.completed 的 result 只有 structured_content 時也能解析為 get_goal_status", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "mcp-002c",
        type: "mcp_tool_call",
        server: "agent_canvas_goal",
        tool: "get_goal_status",
        arguments: {},
        result: {
          content: [],
          structured_content: {
            status: "running",
            activeTodoId: "todo-1",
            activeTodoText: "Inspect workspace",
            nextTodoId: "todo-1",
            nextTodoText: "Inspect workspace",
            completedTodoIds: [],
            blockedReason: null,
            handoffSummary: null,
            completedCount: 0,
            totalCount: 3,
          },
        },
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e.toolName).toBe("mcp__agent_canvas_goal__get_goal_status");
    expect(e.output).toBe(
      JSON.stringify({
        status: "running",
        activeTodoId: "todo-1",
        activeTodoText: "Inspect workspace",
        nextTodoId: "todo-1",
        nextTodoText: "Inspect workspace",
        completedTodoIds: [],
        blockedReason: null,
        handoffSummary: null,
        completedCount: 0,
        totalCount: 3,
      }),
    );
  });

  it("item.completed 的 mcp_tool_call 失敗時，output 應為 error.message", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "mcp-002d",
        type: "mcp_tool_call",
        server: "everything-sse",
        tool: "get_sum",
        arguments: { a: 1, b: 2 },
        result: null,
        error: { message: "connection refused" },
        status: "failed",
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e.toolName).toBe("mcp__everything-sse__get_sum");
    expect(e.output).toBe("connection refused");
  });

  // ── Case 6：turn.completed → turn_complete ────────────────────────
  it("turn.completed 應映射為 turn_complete", () => {
    const line = toLine({ type: "turn.completed" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("turn_complete");
  });

  // ── Case 7：error envelope → error (fatal=true，AI 終態錯誤) ────────
  it("error envelope 應映射為 error，fatal=true（AI 終態錯誤代表本輪結束）", () => {
    const line = toLine({ type: "error", message: "Something went wrong" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e?.message).toBe("Something went wrong");
    expect(e?.fatal).toBe(true);
    expect(e?.recovery).toBe("unrecoverable");
    expect(e?.systemMessage).toMatchObject({
      role: "system",
      content: "Something went wrong",
      metadata: {
        provider: "codex",
        code: "STREAM_ERROR",
        severity: "fatal",
        rawContent: "Something went wrong",
        recovery: "unrecoverable",
      },
    });
  });

  it("error envelope 即使含 transport 關鍵字也應維持 unrecoverable", () => {
    const line = toLine({
      type: "error",
      message: "WebSocket connection closed while resuming stream",
    });

    const result = normalize(line);

    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e.fatal).toBe(true);
    expect(e.recovery).toBe("unrecoverable");
    expect(e.systemMessage?.metadata.recovery).toBe("unrecoverable");
  });

  it("Codex CLI 重連進度應映射為 non-fatal recoverable error", () => {
    const line = toLine({
      type: "error",
      message:
        "Reconnecting... 2/5 (stream disconnected before completion: websocket closed by server before response.completed)",
    });

    const result = normalize(line);

    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e.fatal).toBe(false);
    expect(e.recovery).toBe("recoverable");
    expect(e.code).toBe("STREAM_RECONNECTING");
    expect(e.systemMessage?.metadata).toMatchObject({
      code: "STREAM_RECONNECTING",
      severity: "error",
      recovery: "recoverable",
    });
  });

  it("Codex CLI 切換到 HTTPS transport 應映射為 non-fatal progress error", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "transport-fallback",
        type: "error",
        message:
          "Falling back from WebSockets to HTTPS transport. stream disconnected before completion: websocket closed by server before response.completed",
      },
    });

    const result = normalize(line);

    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e.fatal).toBe(false);
    expect(e.recovery).toBe("recoverable");
    expect(e.code).toBe("STREAM_TRANSPORT_FALLBACK");
  });

  it("Codex CLI transport 最終斷線應映射為 fatal recoverable error", () => {
    const line = toLine({
      type: "error",
      message:
        "stream disconnected before completion: websocket closed by server before response.completed",
    });

    const result = normalize(line);

    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e.fatal).toBe(true);
    expect(e.recovery).toBe("recoverable");
    expect(e.code).toBe("STREAM_DISCONNECTED");
    expect(e.systemMessage?.metadata).toMatchObject({
      code: "STREAM_DISCONNECTED",
      severity: "fatal",
      recovery: "recoverable",
    });
  });

  it("item.completed 且 item_type=error 應映射為 non-fatal system error", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "err-001",
        type: "error",
        message: "Command failed",
      },
    });
    const result = normalize(line);

    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e?.fatal).toBe(false);
    expect(e?.recovery).toBe("recoverable");
    expect(e?.systemMessage).toMatchObject({
      metadata: {
        provider: "codex",
        code: "ITEM_ERROR",
        severity: "error",
        recovery: "recoverable",
      },
    });
  });

  // ── Case 8：不認得的 envelope type → null ────────────────────────
  it("不認得的 envelope type（turn.started）應回傳 null", () => {
    const line = toLine({ type: "turn.started", data: {} });
    expect(normalize(line)).toBeNull();
  });

  it("不認得的 envelope type（item.updated）應回傳 null", () => {
    const line = toLine({
      type: "item.updated",
      item: { id: "x", type: "agent_message" },
    });
    expect(normalize(line)).toBeNull();
  });

  // ── Case 9：非 JSON 行 → null ─────────────────────────────────────
  it("純文字行（非 JSON）應回傳 null", () => {
    expect(normalize("Starting codex CLI...")).toBeNull();
    expect(normalize("DEBUG: some debug message")).toBeNull();
  });

  // ── Case 10：空行 → null ──────────────────────────────────────────
  it("空行應回傳 null", () => {
    expect(normalize("")).toBeNull();
    expect(normalize("   ")).toBeNull();
    expect(normalize("\n")).toBeNull();
  });

  // ── 邊界條件：item.completed + agent_message 但 text 為空字串 ────────
  it("item.completed agent_message text 為空字串應回傳 null", () => {
    const line = toLine({
      type: "item.completed",
      item: { id: "item-003", type: "agent_message", text: "" },
    });
    expect(normalize(line)).toBeNull();
  });

  // ── 邊界條件：item.completed + command_execution aggregated_output 為 undefined → output 為空字串 ──
  it("item.completed command_execution 無 aggregated_output 時 output 應為空字串", () => {
    const line = toLine({
      type: "item.completed",
      item: {
        id: "cmd-003",
        type: "command_execution",
        command: "echo hi",
      },
    });
    const result = normalize(line);
    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e?.output).toBe("");
  });

  // ── 邊界條件：item.started 非 command_execution 型別 → null ──────────
  it("item.started 且 item_type=agent_message 應回傳 null（目前未映射）", () => {
    const line = toLine({
      type: "item.started",
      item: { id: "item-999", type: "agent_message" },
    });
    expect(normalize(line)).toBeNull();
  });
});
