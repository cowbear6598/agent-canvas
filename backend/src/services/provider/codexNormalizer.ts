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

/**
 * Codex CLI 會用頂層 error envelope 回報內部重連進度；這不是 turn 終態錯誤。
 * 目前 wire format 沒有獨立欄位可判斷，只能依 CLI 的固定訊息前綴辨識。
 */
const CODEX_RECONNECT_PROGRESS_RE =
  /^Reconnecting\.\.\.\s+\d+\/\d+(?:\s|$)/;
const CODEX_TRANSPORT_FALLBACK_RE =
  /^Falling back from WebSockets to HTTPS transport\.(?:\s|$)/;
const CODEX_TERMINAL_TRANSPORT_DISCONNECT_RE =
  /^stream disconnected before completion:\s*websocket closed by server before response\.completed(?:\s|$)/;
const CODEX_MODEL_CAPACITY_RE =
  /\b(?:selected|requested) model is at capacity\b/i;

function isCodexReconnectProgressMessage(message: string): boolean {
  return CODEX_RECONNECT_PROGRESS_RE.test(message.trim());
}

function isCodexTransportFallbackMessage(message: string): boolean {
  return CODEX_TRANSPORT_FALLBACK_RE.test(message.trim());
}

function isCodexTerminalTransportDisconnectMessage(message: string): boolean {
  return CODEX_TERMINAL_TRANSPORT_DISCONNECT_RE.test(message.trim());
}

function isCodexModelCapacityMessage(message: string): boolean {
  return CODEX_MODEL_CAPACITY_RE.test(message.trim());
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
function buildCodexSystemError(
  params:
    | {
        content: string;
        fatal: false;
        code: string;
        rawContent?: string;
        recovery?: ProviderErrorRecovery;
      }
    | {
        content: string;
        fatal: true;
        code: string;
        rawContent?: string;
        recovery: ProviderErrorRecovery;
      },
): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("codex", params);
}

function buildCodexTransportFallbackError(
  rawContent: string,
): Extract<NormalizedEvent, { type: "error" }> {
  return buildCodexSystemError({
    content: rawContent,
    fatal: false,
    code: "STREAM_TRANSPORT_FALLBACK",
    rawContent,
    recovery: "recoverable",
  });
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

function normalizeItemStarted(
  event: CodexItemStartedEvent,
): NormalizedEvent | null {
  if (event.item.type === "command_execution") {
    const command = event.item as CodexCommandExecutionItem;
    return {
      type: "tool_call_start",
      toolUseId: command.id,
      toolName: "shell",
      input: { command: command.command },
    };
  }

  if (event.item.type !== "mcp_tool_call") return null;

  const item = event.item as CodexMcpToolCallItem;
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

function normalizeCompletedItemError(
  item: CodexItemError,
): NormalizedEvent | null {
  const rawContent = item.message ?? item.error ?? item.text ?? "";
  if (!rawContent) return null;

  if (isCodexTransportFallbackMessage(rawContent)) {
    return buildCodexTransportFallbackError(rawContent);
  }

  return buildCodexSystemError({
    content: rawContent,
    fatal: false,
    code: "ITEM_ERROR",
    rawContent,
  });
}

function normalizeItemCompleted(
  event: CodexItemCompletedEvent,
): NormalizedEvent | null {
  switch (event.item.type) {
    case "agent_message": {
      const message = event.item as CodexAgentMessageItem;
      return message.text ? { type: "text", content: message.text } : null;
    }
    case "reasoning": {
      const reasoning = event.item as CodexReasoningItem;
      return reasoning.text
        ? { type: "thinking", content: reasoning.text }
        : null;
    }
    case "command_execution": {
      const command = event.item as CodexCommandExecutionItem;
      return {
        type: "tool_call_result",
        toolUseId: command.id,
        toolName: "shell",
        output: command.aggregated_output ?? "",
      };
    }
    case "mcp_tool_call": {
      const item = event.item as CodexMcpToolCallItem;
      const input = buildMcpToolInput(item);
      return {
        type: "tool_call_result",
        toolUseId: item.id,
        toolName: canonicalizeGoalRuntimeToolName(
          buildMcpToolName(item),
          input,
          item.result ?? null,
        ),
        output: buildMcpToolOutput(item),
      };
    }
    case "error":
      return normalizeCompletedItemError(event.item as CodexItemError);
    default:
      return null;
  }
}

function normalizeStreamError(event: CodexStreamErrorEvent): NormalizedEvent {
  const rawContent = event.message ?? "Codex 串流發生錯誤";

  if (isCodexReconnectProgressMessage(rawContent)) {
    return buildCodexSystemError({
      content: rawContent,
      fatal: false,
      code: "STREAM_RECONNECTING",
      rawContent,
      recovery: "recoverable",
    });
  }

  if (isCodexTransportFallbackMessage(rawContent)) {
    return buildCodexTransportFallbackError(rawContent);
  }

  if (isCodexTerminalTransportDisconnectMessage(rawContent)) {
    return buildCodexSystemError({
      content: rawContent,
      fatal: true,
      code: "STREAM_DISCONNECTED",
      rawContent,
      recovery: "recoverable",
    });
  }

  if (isCodexModelCapacityMessage(rawContent)) {
    return buildCodexSystemError({
      content: "Codex 選用的模型目前滿載，這次請求未完成。",
      fatal: true,
      code: "MODEL_CAPACITY_EXHAUSTED",
      rawContent,
      recovery: "recoverable",
    });
  }

  return buildCodexSystemError({
    content: rawContent,
    fatal: true,
    code: "STREAM_ERROR",
    rawContent,
    recovery: "recoverable",
  });
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
    case "thread.started":
      return {
        type: "session_started",
        sessionId: (event as CodexThreadStartedEvent).thread_id,
      };
    case "item.started":
      return normalizeItemStarted(event as CodexItemStartedEvent);
    case "item.completed":
      return normalizeItemCompleted(event as CodexItemCompletedEvent);
    case "turn.completed":
      return { type: "turn_complete" };
    case "error":
      return normalizeStreamError(event as CodexStreamErrorEvent);
    default:
      // 未知頂層事件（turn.started、item.updated 等）→ 忽略
      return null;
  }
}
