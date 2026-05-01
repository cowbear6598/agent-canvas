/**
 * CodexNormalizer
 *
 * 解析 Codex CLI `--json` 模式輸出的 item envelope 事件，
 * 映射為專案統一的 NormalizedEvent discriminated union。
 *
 * Codex CLI 輸出格式（item envelope）：
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"item.started","item":{"id":"...","type":"command_execution","command":"...",...}}
 *   {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
 *   {"type":"item.completed","item":{"id":"...","type":"reasoning","text":"..."}}
 *   {"type":"turn.completed",...}
 *   {"type":"error","message":"..."}
 */

import type { NormalizedEvent } from "./types.js";

// ── Codex JSON 事件原始型別 ────────────────────────────────────────

interface CodexThreadStartedEvent {
  type: "thread.started";
  thread_id: string;
}

interface CodexItemStartedEvent {
  type: "item.started";
  item: CodexItemPayload;
}

interface CodexItemCompletedEvent {
  type: "item.completed";
  item: CodexItemPayload;
}

interface CodexTurnCompletedEvent {
  type: "turn.completed";
}

interface CodexStreamErrorEvent {
  type: "error";
  message: string;
}

interface CodexItemError {
  id: string;
  type: "error";
  message?: string;
  text?: string;
  error?: string;
}

type CodexEvent =
  | CodexThreadStartedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent
  | CodexTurnCompletedEvent
  | CodexStreamErrorEvent
  | { type: string; [key: string]: unknown };

// ── Item Payload 型別 ──────────────────────────────────────────────

type CodexItemPayload =
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexItemError
  | { id: string; type: string; [key: string]: unknown };

interface CodexAgentMessageItem {
  id: string;
  type: "agent_message";
  text: string;
}

interface CodexReasoningItem {
  id: string;
  type: "reasoning";
  text: string;
}

interface CodexCommandExecutionItem {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

function buildCodexSystemError(params: {
  content: string;
  fatal: boolean;
  code: string;
  rawContent?: string;
}): Extract<NormalizedEvent, { type: "error" }> {
  const { content, fatal, code, rawContent } = params;

  return {
    type: "error",
    message: content,
    fatal,
    code,
    systemMessage: {
      role: "system",
      content,
      metadata: {
        provider: "codex",
        code,
        severity: fatal ? "fatal" : "error",
        rawContent: rawContent ?? content,
      },
    },
  };
}

// ── 主要解析函式 ──────────────────────────────────────────────────

/**
 * 解析一行 Codex JSON 輸出，映射為 NormalizedEvent。
 *
 * 映射規則：
 * - `thread.started`                              → `session_started`（取 thread_id）
 * - `item.completed` + item_type=`agent_message`  → `text`（取 message 文字）
 * - `item.completed` + item_type=`reasoning`      → `thinking`（取推理文字）
 * - `item.started`   + item_type=`command_execution` → `tool_call_start`
 * - `item.completed` + item_type=`command_execution` → `tool_call_result`
 * - `turn.completed`                              → `turn_complete`
 * - `error`                                       → `error`（fatal=true）
 * - 其他                                           → null（忽略）
 *
 * @param line - stdout 的一行字串
 * @returns 對應的 NormalizedEvent，或 null（略過此行）
 */
export function normalize(line: string): NormalizedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: CodexEvent;
  try {
    event = JSON.parse(trimmed) as CodexEvent;
  } catch {
    // 非 JSON 行（例如啟動訊息、偵錯輸出）→ 忽略
    return null;
  }

  switch (event.type) {
    case "thread.started": {
      const e = event as CodexThreadStartedEvent;
      return {
        type: "session_started",
        sessionId: e.thread_id,
      };
    }

    case "item.started": {
      const e = event as CodexItemStartedEvent;
      if (e.item.type === "command_execution") {
        const cmd = e.item as CodexCommandExecutionItem;
        return {
          type: "tool_call_start",
          toolUseId: cmd.id,
          toolName: "shell",
          input: { command: cmd.command },
        };
      }
      // 其他 item.started 類型目前不映射
      return null;
    }

    case "item.completed": {
      const e = event as CodexItemCompletedEvent;

      if (e.item.type === "agent_message") {
        const msg = e.item as CodexAgentMessageItem;
        if (!msg.text) return null;
        return {
          type: "text",
          content: msg.text,
        };
      }

      if (e.item.type === "reasoning") {
        const r = e.item as CodexReasoningItem;
        if (!r.text) return null;
        return {
          type: "thinking",
          content: r.text,
        };
      }

      if (e.item.type === "command_execution") {
        const cmd = e.item as CodexCommandExecutionItem;
        return {
          type: "tool_call_result",
          toolUseId: cmd.id,
          toolName: "shell",
          output: cmd.aggregated_output ?? "",
        };
      }

      if (e.item.type === "error") {
        const itemError = e.item as CodexItemError;
        const rawContent =
          itemError.message ?? itemError.error ?? itemError.text ?? "";
        if (!rawContent) return null;
        return buildCodexSystemError({
          content: rawContent,
          fatal: false,
          code: "ITEM_ERROR",
          rawContent,
        });
      }

      // 其他 item.completed 類型（file_change、mcp_tool_call 等）目前不映射
      return null;
    }

    case "turn.completed": {
      return { type: "turn_complete" };
    }

    case "error": {
      const e = event as CodexStreamErrorEvent;
      const rawContent = e.message ?? "Codex 串流發生不可恢復的錯誤";
      return buildCodexSystemError({
        content: rawContent,
        fatal: true,
        code: "STREAM_ERROR",
        rawContent,
      });
    }

    default:
      // 未知頂層事件（turn.started、item.updated 等）→ 忽略
      return null;
  }
}
