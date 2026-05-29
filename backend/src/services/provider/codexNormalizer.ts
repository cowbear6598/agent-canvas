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

import { buildProviderSystemError } from "./types.js";
import type { NormalizedEvent, ProviderErrorRecovery } from "./types.js";
import { canonicalizeGoalRuntimeToolName } from "../goalRuntime.js";

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
  | CodexMcpToolCallItem
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

interface CodexMcpToolCallItemResult {
  content?: unknown[];
  structured_content?: unknown;
  _meta?: unknown;
}

interface CodexMcpToolCallItemError {
  message?: string;
}

/**
 * 對齊 codex-rs/exec/src/exec_events.rs::McpToolCallItem 的真實 wire shape：
 * - server / tool 是直接的字串欄位（早期我們誤以為是 server_name / tool_name）
 * - arguments 是任意 JSON
 * - result 是 { content: MCP content blocks[], structured_content?, _meta? } | null
 * - error 是 { message } | null（失敗時 result 為 null）
 */
interface CodexMcpToolCallItem {
  id: string;
  type: "mcp_tool_call";
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: CodexMcpToolCallItemResult | null;
  error?: CodexMcpToolCallItemError | null;
  status?: string;
}

/** Codex normalizer 專用的系統錯誤建立 helper（委派給共用 buildProviderSystemError） */
function buildCodexSystemError(params: {
  content: string;
  fatal: boolean;
  code: string;
  rawContent?: string;
  recovery?: ProviderErrorRecovery;
}): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("codex", params);
}

const RECOVERABLE_CODEX_STREAM_ERROR_PATTERNS = [
  /\bwebsocket\b/i,
  /\bweb socket\b/i,
  /\btransport\b/i,
  /\bresume\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bconnection (?:closed|reset|lost|dropped|aborted)\b/i,
  /\beconnreset\b/i,
  /\bbroken pipe\b/i,
  /\btemporarily unavailable\b/i,
  /\bstream interrupted\b/i,
] as const;

function classifyCodexStreamErrorRecovery(
  rawContent: string,
): ProviderErrorRecovery {
  return RECOVERABLE_CODEX_STREAM_ERROR_PATTERNS.some((pattern) =>
    pattern.test(rawContent),
  )
    ? "recoverable"
    : "unrecoverable";
}

function buildMcpToolName(item: CodexMcpToolCallItem): string {
  if (
    typeof item.server === "string" &&
    item.server.length > 0 &&
    typeof item.tool === "string" &&
    item.tool.length > 0
  ) {
    return `mcp__${item.server}__${item.tool}`;
  }

  // 防呆兜底：理論上 codex 必送 server + tool；若 schema 變動則退回 generic 名以利診斷
  return `mcp__${item.server ?? "mcp"}__${item.tool ?? "tool"}`;
}

function buildMcpToolInput(
  item: CodexMcpToolCallItem,
): Record<string, unknown> {
  if (
    item.arguments &&
    typeof item.arguments === "object" &&
    !Array.isArray(item.arguments)
  ) {
    return item.arguments as Record<string, unknown>;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function serializeMcpToolOutputValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  // structured_content 在 codex Rust 端是 Option<JsonValue> 且未標 skip_serializing_if，
  // 故 None 會 serialize 成顯式 null（不是省略）。只在「真的有 structured 值」時才用它，
  // 否則 fallback 走下面的 content[].text。
  if (
    value.structured_content !== undefined &&
    value.structured_content !== null
  ) {
    return JSON.stringify(value.structured_content);
  }

  const content = value.content;
  if (Array.isArray(content)) {
    const textBlocks = content
      .filter((block): block is Record<string, unknown> => isRecord(block))
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .filter((text) => text.length > 0);
    if (textBlocks.length > 0) {
      return textBlocks.join("\n");
    }
  }

  return JSON.stringify(value);
}

function buildMcpToolOutput(item: CodexMcpToolCallItem): string {
  // 失敗的 tool call：result 為 null，錯誤訊息在 error.message
  if (
    item.error &&
    typeof item.error === "object" &&
    typeof item.error.message === "string" &&
    item.error.message.length > 0
  ) {
    return item.error.message;
  }
  return serializeMcpToolOutputValue(item.result) ?? "";
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
 * - `error`                                       → `error`（fatal=true，AI 終態錯誤代表本輪結束，交由 transcript system message 呈現）
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
      if (e.item.type === "mcp_tool_call") {
        const item = e.item as CodexMcpToolCallItem;
        const input = buildMcpToolInput(item);
        return {
          type: "tool_call_start",
          toolUseId: item.id,
          toolName: canonicalizeGoalRuntimeToolName(
            buildMcpToolName(item),
            input,
            null,
          ),
          input,
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

      if (e.item.type === "mcp_tool_call") {
        const item = e.item as CodexMcpToolCallItem;
        const input = buildMcpToolInput(item);
        const output = buildMcpToolOutput(item);
        return {
          type: "tool_call_result",
          toolUseId: item.id,
          toolName: canonicalizeGoalRuntimeToolName(
            buildMcpToolName(item),
            input,
            item.result ?? null,
          ),
          output,
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

      // 其他 item.completed 類型（file_change 等）目前不映射
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
        recovery: classifyCodexStreamErrorRecovery(rawContent),
      });
    }

    default:
      // 未知頂層事件（turn.started、item.updated 等）→ 忽略
      return null;
  }
}
