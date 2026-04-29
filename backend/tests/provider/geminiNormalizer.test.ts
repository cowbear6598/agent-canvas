/**
 * GeminiNormalizer 單元測試
 *
 * 測試 normalize(line) 的各種輸入 → NormalizedEvent 映射。
 */

import { describe, it, expect } from "vitest";
import { normalize } from "../../src/services/provider/geminiNormalizer.js";

// ── Helper：把物件序列化成一行 JSON 字串 ──────────────────────────────
function toLine(obj: object): string {
  return JSON.stringify(obj);
}

describe("GeminiNormalizer - normalize()", () => {
  // ── N1：init → session_started ─────────────────────────────────────
  it("N1: init event 應映射為 session_started，含 sessionId", () => {
    const line = toLine({ type: "init", session_id: "sess-abc123" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_started");
    expect(
      (result as Extract<typeof result, { type: "session_started" }>)
        ?.sessionId,
    ).toBe("sess-abc123");
  });

  // ── N2：message delta=true role=assistant → text ───────────────────
  it("N2: message (delta=true, role=assistant, 有 content) 應映射為 text", () => {
    const line = toLine({
      type: "message",
      role: "assistant",
      delta: true,
      content: "Hello, World!",
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("text");
    expect((result as Extract<typeof result, { type: "text" }>)?.content).toBe(
      "Hello, World!",
    );
  });

  // ── N3：message role=user → null ──────────────────────────────────
  it("N3: message (role=user) 應回傳 null（忽略使用者 echo）", () => {
    const line = toLine({
      type: "message",
      role: "user",
      delta: true,
      content: "使用者訊息",
    });
    expect(normalize(line)).toBeNull();
  });

  // ── N4：message role=assistant delta=false 沒 content → null ────────
  it("N4: message (role=assistant, delta=false) 且無 content 應回傳 null", () => {
    const line = toLine({
      type: "message",
      role: "assistant",
      delta: false,
    });
    expect(normalize(line)).toBeNull();
  });

  // ── N5：tool_use → tool_call_start ────────────────────────────────
  it("N5: tool_use 應映射為 tool_call_start，含 toolUseId / toolName / input", () => {
    const line = toLine({
      type: "tool_use",
      tool_id: "tool-001",
      tool_name: "read_file",
      parameters: { path: "/tmp/foo.txt" },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call_start");
    const e = result as Extract<typeof result, { type: "tool_call_start" }>;
    expect(e?.toolUseId).toBe("tool-001");
    expect(e?.toolName).toBe("read_file");
    expect(e?.input).toEqual({ path: "/tmp/foo.txt" });
  });

  // ── N6：tool_result 含 output → tool_call_result ──────────────────
  it("N6: tool_result 含 output 應映射為 tool_call_result，output 取 output 欄位", () => {
    const line = toLine({
      type: "tool_result",
      tool_id: "tool-002",
      tool_name: "read_file",
      output: "file content here",
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e?.toolUseId).toBe("tool-002");
    expect(e?.toolName).toBe("read_file");
    expect(e?.output).toBe("file content here");
  });

  // ── N7：tool_result 只有 error.message → output 取 error.message ──
  it("N7: tool_result 只有 error.message 應映射為 tool_call_result，output 取 error.message", () => {
    const line = toLine({
      type: "tool_result",
      tool_id: "tool-003",
      tool_name: "write_file",
      error: { message: "Permission denied" },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_call_result");
    const e = result as Extract<typeof result, { type: "tool_call_result" }>;
    expect(e?.toolUseId).toBe("tool-003");
    expect(e?.toolName).toBe("write_file");
    expect(e?.output).toBe("Permission denied");
  });

  // ── N8：error event → error（fatal=false）──────────────────────────
  it("N8: error event 應映射為 error，fatal=false", () => {
    const line = toLine({ type: "error", message: "Something went wrong" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e?.message).toBe("Something went wrong");
    expect(e?.fatal).toBe(false);
  });

  // ── N9：result status=success → turn_complete ──────────────────────
  it("N9: result (status=success) 應映射為 turn_complete", () => {
    const line = toLine({ type: "result", status: "success" });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("turn_complete");
  });

  // ── N10：result status=error → error（fatal=true）──────────────────
  it("N10: result (status=error) 應映射為 error，fatal=true，message 取 error.message", () => {
    const line = toLine({
      type: "result",
      status: "error",
      error: { message: "Gemini API 回應錯誤" },
    });
    const result = normalize(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("error");
    const e = result as Extract<typeof result, { type: "error" }>;
    expect(e?.message).toBe("Gemini API 回應錯誤");
    expect(e?.fatal).toBe(true);
  });

  // ── N11：空字串 / 純空白 → null ───────────────────────────────────
  it("N11: 空字串或純空白應回傳 null", () => {
    expect(normalize("")).toBeNull();
    expect(normalize("   ")).toBeNull();
    expect(normalize("\n")).toBeNull();
    expect(normalize("\t")).toBeNull();
  });

  // ── N12：非 JSON 行 → null（不拋例外）────────────────────────────
  it("N12: 非 JSON 行應回傳 null，不應拋出例外", () => {
    expect(() => normalize("Starting Gemini CLI...")).not.toThrow();
    expect(normalize("Starting Gemini CLI...")).toBeNull();
    expect(normalize("DEBUG: some debug info")).toBeNull();
    expect(normalize("not valid json at all")).toBeNull();
  });

  // ── N13：未知 type → null ─────────────────────────────────────────
  it("N13: 未知 type 應回傳 null（忽略不認識的事件）", () => {
    const line = toLine({ type: "unknown_event", data: { foo: "bar" } });
    expect(normalize(line)).toBeNull();
  });
});
