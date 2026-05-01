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
    expect(e?.systemMessage).toMatchObject({
      role: "system",
      content: "Something went wrong",
      metadata: {
        provider: "codex",
        code: "STREAM_ERROR",
        severity: "fatal",
        rawContent: "Something went wrong",
      },
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
    expect(e?.systemMessage).toMatchObject({
      metadata: {
        provider: "codex",
        code: "ITEM_ERROR",
        severity: "error",
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
