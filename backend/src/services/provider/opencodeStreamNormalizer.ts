import type { NormalizedEvent } from "./types.js";
import { logger } from "../../utils/logger.js";
import {
  classifySessionError,
  extractErrorMessage,
  buildOpencodeSystemError,
} from "./opencodeErrorClassifier.js";
import {
  serializeV2ToolFailureError,
  serializeV2ToolSuccessContent,
} from "./opencodeToolSerializer.js";
import type { OpencodeMessageItem } from "./opencodeClientPort.js";

type OpencodeErrorEvent = Extract<NormalizedEvent, { type: "error" }>;
const TOOL_PART_BOUNDARY_QUERY_THROTTLE_MS = 200;
// 補拉 session.messages 時保留最小視窗，避免最近 tool part 被過小的 limit 截掉。
const TOOL_PART_MESSAGE_LIMIT_FLOOR = 50;

type StreamRaceResult =
  | { kind: "stream"; result: IteratorResult<unknown> }
  | { kind: "prompt_failed"; event: OpencodeErrorEvent }
  | { kind: "aborted" };

interface PendingToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

export interface OpencodeStreamNormalizerOptions {
  stream: AsyncGenerator<unknown>;
  sessionId: string;
  providerID: string;
  alreadyYieldedSessionStarted: boolean;
  promptFailureRace: Promise<{ kind: "prompt_failed"; event: OpencodeErrorEvent }>;
  abortRace: {
    promise: Promise<{ kind: "aborted" }>;
    dispose(): void;
  };
  messages(limit: number): Promise<Array<OpencodeMessageItem> | undefined>;
}

function buildPermissionAskedEvent(
  props: Record<string, unknown>,
): OpencodeErrorEvent {
  const permission =
    typeof props.permission === "string" ? props.permission : "unknown";
  const patterns = Array.isArray(props.patterns)
    ? props.patterns.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const patternText = patterns.length > 0 ? `（${patterns.join(", ")}）` : "";

  return buildOpencodeSystemError({
    content: `opencode 需要互動批准權限 ${permission}${patternText}，目前 Plugins 對話無法回覆此提示，已中止本輪對話`,
    fatal: true,
    code: "opencode_permission_blocked",
    rawContent: JSON.stringify({ permission, patterns }),
    recovery: "unrecoverable",
  });
}

function buildQuestionAskedEvent(
  props: Record<string, unknown>,
): OpencodeErrorEvent {
  const firstQuestion = Array.isArray(props.questions)
    ? (props.questions.find(
        (value): value is Record<string, unknown> =>
          !!value && typeof value === "object",
      ) ?? null)
    : null;
  const header =
    typeof firstQuestion?.header === "string" && firstQuestion.header.length > 0
      ? firstQuestion.header
      : null;
  const question =
    typeof firstQuestion?.question === "string" &&
    firstQuestion.question.length > 0
      ? firstQuestion.question
      : null;
  const promptText = header ?? question ?? "未提供問題內容";

  return buildOpencodeSystemError({
    content: `opencode 需要使用者回答問題「${promptText}」，目前 Plugins 對話無法回覆互動問題，已中止本輪對話`,
    fatal: true,
    code: "opencode_question_blocked",
    rawContent: JSON.stringify(props),
    recovery: "unrecoverable",
  });
}

function buildWorkspaceFailedEvent(
  props: Record<string, unknown>,
): OpencodeErrorEvent {
  const message =
    typeof props.message === "string" && props.message.length > 0
      ? props.message
      : "未知錯誤";

  logger.error(
    "Chat",
    "Error",
    `[OpencodeProvider] workspace.failed：${message}`,
  );

  return buildOpencodeSystemError({
    content: "opencode 工作區初始化失敗，請稍後再試",
    fatal: true,
    code: "opencode_workspace_failed",
    recovery: "unrecoverable",
  });
}

function buildSanitizedSessionFailureEvent(params: {
  rawMessage: string;
  providerID: string;
  source: "session.next.step.failed" | "session.error";
}): OpencodeErrorEvent {
  const { rawMessage, providerID, source } = params;
  logger.error("Chat", "Error", `[OpencodeProvider] ${source}：${rawMessage}`);

  const classified = classifySessionError(rawMessage, providerID);
  if (
    classified.code === "opencode_auth_missing" ||
    classified.code === "opencode_server_unreachable"
  ) {
    return classified;
  }

  return buildOpencodeSystemError({
    content: "opencode session 發生錯誤，請稍後再試",
    fatal: false,
    code: "opencode_session_failed",
    recovery: "recoverable",
  });
}

class OpencodeToolEventCollector {
  private readonly currentMessageIds = new Set<string>();
  private readonly yieldedToolCallIDs = new Set<string>();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private currentPartID: string | undefined = undefined;
  private lastPartIDQueryAt = 0;
  private readonly partIdQueryThrottleMs = TOOL_PART_BOUNDARY_QUERY_THROTTLE_MS;

  constructor(
    private readonly messages: (
      limit: number,
    ) => Promise<Array<OpencodeMessageItem> | undefined>,
  ) {}

  addMessageId(messageID: string | undefined): void {
    if (messageID) this.currentMessageIds.add(messageID);
  }

  async *collectOnPartBoundary(
    partID: string | undefined,
  ): AsyncGenerator<NormalizedEvent> {
    if (
      !partID ||
      this.currentPartID === undefined ||
      partID === this.currentPartID
    ) {
      if (partID) this.currentPartID = partID;
      return;
    }

    const now = Date.now();
    if (now - this.lastPartIDQueryAt >= this.partIdQueryThrottleMs) {
      this.lastPartIDQueryAt = now;
      yield* this.collectPendingToolParts();
    }
    this.currentPartID = partID;
  }

  async *collectPendingToolParts(): AsyncGenerator<NormalizedEvent> {
    if (this.currentMessageIds.size === 0) return;

    const messageLimit = Math.max(
      this.currentMessageIds.size,
      TOOL_PART_MESSAGE_LIMIT_FLOOR,
    );
    const sessionMessages = await this.messages(messageLimit);
    if (!sessionMessages) return;

    for (const msg of sessionMessages) {
      if (msg.info.role !== "assistant") continue;
      if (!this.currentMessageIds.has(msg.info.id)) continue;

      for (const part of msg.parts) {
        if (part.type !== "tool") continue;

        const callID = part.callID ?? "";
        if (!callID || this.yieldedToolCallIDs.has(callID)) continue;

        const toolName = part.tool ?? "";
        const state = part.state;
        const input = (state?.input as Record<string, unknown>) ?? {};

        if (state?.status === "completed") {
          this.yieldedToolCallIDs.add(callID);
          yield { type: "tool_call_start", toolUseId: callID, toolName, input };
          yield {
            type: "tool_call_result",
            toolUseId: callID,
            toolName,
            output: state.output ?? "",
          };
          continue;
        }

        if (state?.status === "error") {
          this.yieldedToolCallIDs.add(callID);
          yield { type: "tool_call_start", toolUseId: callID, toolName, input };
          yield {
            type: "tool_call_result",
            toolUseId: callID,
            toolName,
            output: `[Error] ${state.error ?? "tool failed"}`,
          };
        }
      }
    }
  }

  collectToolCalled(
    props: Record<string, unknown>,
  ): Extract<NormalizedEvent, { type: "tool_call_start" }> | null {
    const callID = props.callID as string | undefined;
    const toolName = props.tool as string | undefined;
    const input = (props.input as Record<string, unknown>) ?? {};

    if (!callID || !toolName) return null;

    this.pendingToolCalls.set(callID, { toolName, input });
    this.yieldedToolCallIDs.add(callID);
    return {
      type: "tool_call_start",
      toolUseId: callID,
      toolName,
      input,
    };
  }

  collectToolSuccess(
    props: Record<string, unknown>,
  ): Extract<NormalizedEvent, { type: "tool_call_result" }> | null {
    const callID = props.callID as string | undefined;
    const content = props.content as
      | ReadonlyArray<{
          type: string;
          text?: string;
          uri?: string;
          mime?: string;
          name?: string;
        }>
      | undefined;

    if (!callID) return null;

    const pending = this.pendingToolCalls.get(callID);
    const toolName = pending?.toolName ?? "";
    this.pendingToolCalls.delete(callID);

    const output = content
      ? serializeV2ToolSuccessContent(
          content as ReadonlyArray<
            | { type: "text"; text: string }
            | {
                type: "file";
                uri: string;
                mime: string;
                name?: string;
              }
          >,
        )
      : "";

    return { type: "tool_call_result", toolUseId: callID, toolName, output };
  }

  collectToolFailed(
    props: Record<string, unknown>,
  ): Extract<NormalizedEvent, { type: "tool_call_result" }> | null {
    const callID = props.callID as string | undefined;
    if (!callID) return null;

    const pending = this.pendingToolCalls.get(callID);
    const toolName = pending?.toolName ?? "";
    this.pendingToolCalls.delete(callID);

    return {
      type: "tool_call_result",
      toolUseId: callID,
      toolName,
      output: serializeV2ToolFailureError(props.error),
    };
  }
}

export async function* normalizeOpencodeStream(
  options: OpencodeStreamNormalizerOptions,
): AsyncIterable<NormalizedEvent> {
  const {
    stream,
    sessionId,
    providerID,
    promptFailureRace,
    abortRace,
    messages,
  } = options;
  let alreadyYieldedSessionStarted = options.alreadyYieldedSessionStarted;
  const collector = new OpencodeToolEventCollector(messages);
  const streamIterator = stream[Symbol.asyncIterator]();

  try {
    while (true) {
      const raceResult = await Promise.race([
        streamIterator.next().then(
          (result): StreamRaceResult => ({
            kind: "stream",
            result,
          }),
        ),
        promptFailureRace,
        abortRace.promise,
      ]);

      if (raceResult.kind === "aborted") break;
      if (raceResult.kind === "prompt_failed") {
        yield raceResult.event;
        break;
      }
      if (raceResult.result.done) break;

      const rawEvent = raceResult.result.value;
      const event = rawEvent as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      if (!event || !event.type) continue;

      const type = event.type;
      const props = event.properties ?? {};
      const eventSessionID = props.sessionID as string | undefined;
      if (eventSessionID !== undefined && eventSessionID !== sessionId) {
        continue;
      }

      if (type === "session.created") {
        if (!alreadyYieldedSessionStarted) {
          const createdSessionId =
            (props.sessionID as string | undefined) ?? sessionId;
          yield { type: "session_started", sessionId: createdSessionId };
          alreadyYieldedSessionStarted = true;
        }
        continue;
      }

      if (type === "message.part.delta") {
        collector.addMessageId(props.messageID as string | undefined);
        yield* collector.collectOnPartBoundary(
          props.partID as string | undefined,
        );

        const field = props.field as string | undefined;
        const delta = props.delta;
        if (typeof delta !== "string" || delta.length === 0) continue;

        if (field === "text") {
          yield { type: "text", content: delta };
          continue;
        }

        if (field === "reasoning") {
          yield { type: "thinking", content: delta };
        }
        continue;
      }

      if (type === "session.next.text.delta") {
        const delta = props.delta;
        if (typeof delta === "string" && delta.length > 0) {
          yield { type: "text", content: delta };
        }
        continue;
      }

      if (type === "session.next.reasoning.delta") {
        const delta = props.delta;
        if (typeof delta === "string" && delta.length > 0) {
          yield { type: "thinking", content: delta };
        }
        continue;
      }

      if (type === "session.next.tool.called") {
        const toolStartEvent = collector.collectToolCalled(props);
        if (toolStartEvent) yield toolStartEvent;
        continue;
      }

      if (type === "session.next.tool.success") {
        const toolResultEvent = collector.collectToolSuccess(props);
        if (toolResultEvent) yield toolResultEvent;
        continue;
      }

      if (type === "session.next.tool.failed") {
        const toolResultEvent = collector.collectToolFailed(props);
        if (toolResultEvent) yield toolResultEvent;
        continue;
      }

      if (type === "permission.asked") {
        yield buildPermissionAskedEvent(props);
        break;
      }

      if (type === "question.asked") {
        yield buildQuestionAskedEvent(props);
        break;
      }

      if (type === "workspace.failed") {
        yield buildWorkspaceFailedEvent(props);
        break;
      }

      if (type === "session.next.step.failed") {
        const stepError = props.error as
          | { type?: string; message?: string }
          | undefined;
        const rawMessage = stepError?.message ?? "未知錯誤";
        yield buildSanitizedSessionFailureEvent({
          rawMessage,
          providerID,
          source: "session.next.step.failed",
        });
        break;
      }

      if (type === "session.idle") {
        yield* collector.collectPendingToolParts();
        yield { type: "turn_complete" };
        break;
      }

      if (type === "session.error") {
        const error = props.error;
        const rawMessage = extractErrorMessage(error);
        yield buildSanitizedSessionFailureEvent({
          rawMessage,
          providerID,
          source: "session.error",
        });
        break;
      }
    }
  } finally {
    abortRace.dispose();
    if (typeof streamIterator.return === "function") {
      await streamIterator.return(undefined);
    }
  }
}
