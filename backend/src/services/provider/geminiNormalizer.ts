/**
 * GeminiNormalizer
 *
 * 解析 Gemini CLI 串流輸出的 JSON 事件，
 * 映射為專案統一的 NormalizedEvent discriminated union。
 *
 * Gemini CLI 輸出格式（每行一個 JSON 物件）：
 *   {"type":"init","session_id":"..."}
 *   {"type":"message","role":"assistant","delta":true,"content":"..."}
 *   {"type":"tool_use","tool_id":"...","tool_name":"...","parameters":{...}}
 *   {"type":"tool_result","tool_id":"...","tool_name":"...","output":"..."}
 *   {"type":"tool_result","tool_id":"...","tool_name":"...","error":{"message":"..."}}
 *   {"type":"error","message":"..."}
 *   {"type":"result","status":"success"}
 *   {"type":"result","status":"error","error":{"message":"..."}}
 */

import type { NormalizedEvent } from "./types.js";

// ── Gemini JSON 事件原始型別 ────────────────────────────────────────

interface GeminiInitEvent {
  type: "init";
  session_id: string;
}

interface GeminiMessageEvent {
  type: "message";
  role: "assistant" | "user";
  /** 是否為差異（streaming delta）片段 */
  delta?: boolean;
  content?: string;
}

interface GeminiToolUseEvent {
  type: "tool_use";
  tool_id: string;
  tool_name: string;
  /** CLI 外部資料，未必傳入 */
  parameters?: Record<string, unknown>;
}

interface GeminiToolResultEvent {
  type: "tool_result";
  tool_id: string;
  /** CLI 外部資料，可能缺失 */
  tool_name?: string;
  /** 成功時的輸出，與 error 互斥但都可能缺失 */
  output?: string;
  /** 失敗時的錯誤物件 */
  error?: { message?: string };
}

interface GeminiErrorEvent {
  type: "error";
  message?: string;
}

interface GeminiResultEvent {
  type: "result";
  status: "success" | "error";
  error?: { message?: string };
}

type GeminiEvent =
  | GeminiInitEvent
  | GeminiMessageEvent
  | GeminiToolUseEvent
  | GeminiToolResultEvent
  | GeminiErrorEvent
  | GeminiResultEvent
  | { type: string; [key: string]: unknown };

// ── 主要解析函式 ──────────────────────────────────────────────────

/**
 * 解析一行 Gemini JSON 輸出，映射為 NormalizedEvent。
 *
 * 映射規則：
 * - `init`                                                   → `session_started`
 * - `message` + role=`assistant` + delta=true + 有 content   → `text`
 * - `message` + role=`user`                                  → null（略過）
 * - `message` 其他情況                                        → null（略過）
 * - `tool_use`                                               → `tool_call_start`
 * - `tool_result`                                            → `tool_call_result`
 * - `error`                                                  → `error`（fatal=false）
 * - `result` + status=`success`                              → `turn_complete`
 * - `result` + status=`error`                                → `error`（fatal=true）
 * - 其他                                                      → null（忽略）
 *
 * @param line - stdout 的一行字串
 * @returns 對應的 NormalizedEvent，或 null（略過此行）
 */
export function normalize(line: string): NormalizedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: GeminiEvent;
  try {
    event = JSON.parse(trimmed) as GeminiEvent;
  } catch {
    // 非 JSON 行（例如啟動訊息、偵錯輸出）→ 忽略
    return null;
  }

  switch (event.type) {
    case "init": {
      const e = event as GeminiInitEvent;
      return {
        type: "session_started",
        sessionId: e.session_id,
      };
    }

    case "message": {
      const e = event as GeminiMessageEvent;
      // role=user 的訊息不需要轉發給前端
      if (e.role === "user") return null;
      // 只處理 assistant delta 且有 content 的片段
      if (e.role === "assistant" && e.delta === true && e.content) {
        return {
          type: "text",
          content: e.content,
        };
      }
      // assistant 非 delta、無 content 等其他情況一律略過
      return null;
    }

    case "tool_use": {
      const e = event as GeminiToolUseEvent;
      return {
        type: "tool_call_start",
        toolUseId: e.tool_id,
        toolName: e.tool_name,
        // parameters 屬於 CLI 外部資料，未必傳入，缺值時補 {} 以符合型別契約
        input: e.parameters ?? {},
      };
    }

    case "tool_result": {
      const e = event as GeminiToolResultEvent;
      return {
        type: "tool_call_result",
        toolUseId: e.tool_id,
        // tool_name 屬於 CLI 外部資料，可能缺失，fallback 為 "tool"
        toolName: e.tool_name ?? "tool",
        // output / error 互斥但都可能缺失，依序 fallback
        output: e.output ?? e.error?.message ?? "",
      };
    }

    case "error": {
      const e = event as GeminiErrorEvent;
      return {
        type: "error",
        message: e.message ?? "Gemini 串流發生錯誤",
        fatal: false,
      };
    }

    case "result": {
      const e = event as GeminiResultEvent;
      if (e.status === "success") {
        return { type: "turn_complete" };
      }
      // status === "error"
      return {
        type: "error",
        message: e.error?.message ?? "Gemini 執行失敗",
        fatal: true,
      };
    }

    default:
      // 未知頂層事件 → 忽略
      return null;
  }
}
