import type { NormalizedEvent } from "./types.js";
import { logger } from "../../utils/logger.js";
import {
  buildOpencodeSystemError,
  classifySessionError,
  extractErrorMessage,
} from "./opencodeErrorClassifier.js";
import type {
  OpencodeClientPort,
  OpencodeMessageItem,
  OpencodeV2PromptInput,
} from "./opencodeClientPort.js";

type OpencodeErrorEvent = Extract<NormalizedEvent, { type: "error" }>;
const OPENCODE_SESSION_MESSAGES_TIMEOUT_MS = 10_000;

export type OpencodeSessionStartResult =
  | {
      ok: true;
      sessionId: string;
      isNewSession: boolean;
      sessionStartedEvent?: Extract<NormalizedEvent, { type: "session_started" }>;
    }
  | { ok: false; event: OpencodeErrorEvent };

export type OpencodePromptRaceResult =
  | { kind: "prompt_failed"; event: OpencodeErrorEvent };

export interface OpencodeSessionLifecycleAdapter {
  createOrResume(resumeSessionId: string | null | undefined): Promise<OpencodeSessionStartResult>;
  prompt(sessionId: string, input: OpencodeV2PromptInput): Promise<{ data?: unknown; error?: unknown }>;
  abort(sessionId: string): void;
  messages(sessionId: string, limit: number): Promise<Array<OpencodeMessageItem> | undefined>;
  watchPromptFailure(
    promptRequest: Promise<{ data?: unknown; error?: unknown }>,
    abortSignal: AbortSignal,
  ): Promise<OpencodePromptRaceResult>;
}

function forceFatalOpencodeError(
  event: OpencodeErrorEvent,
): OpencodeErrorEvent {
  if (event.fatal) return event;

  return {
    ...event,
    fatal: true,
    recovery: event.recovery ?? "unrecoverable",
    systemMessage: event.systemMessage
      ? {
          ...event.systemMessage,
          metadata: {
            ...event.systemMessage.metadata,
            severity: "fatal",
            recovery:
              event.systemMessage.metadata.recovery ??
              event.recovery ??
              "unrecoverable",
          },
        }
      : undefined,
  };
}

function buildPromptFailureEvent(
  rawError: unknown,
  providerID: string,
): OpencodeErrorEvent {
  const rawMessage = extractErrorMessage(rawError);
  logger.error(
    "Chat",
    "Error",
    `[OpencodeProvider] session.prompt 失敗：${rawMessage}`,
  );
  const classified = classifySessionError(rawMessage, providerID);

  if (
    classified.code === "opencode_auth_missing" ||
    classified.code === "opencode_server_unreachable"
  ) {
    return forceFatalOpencodeError(classified);
  }

  return buildOpencodeSystemError({
    content: "opencode 訊息發送失敗，請稍後再試",
    fatal: true,
    code: "opencode_prompt_failed",
    recovery: "recoverable",
  });
}

function buildCreateSessionFailureEvent(
  rawError: unknown,
  providerID: string,
): OpencodeErrorEvent {
  const rawMessage = extractErrorMessage(rawError);
  logger.error(
    "Chat",
    "Error",
    `[OpencodeProvider] session.create 失敗：${rawMessage}`,
  );
  const classified = classifySessionError(rawMessage, providerID);

  if (
    classified.code === "opencode_auth_missing" ||
    classified.code === "opencode_server_unreachable"
  ) {
    return forceFatalOpencodeError(classified);
  }

  return buildOpencodeSystemError({
    content: "opencode session 建立失敗，請稍後再試",
    fatal: true,
    code: "opencode_session_failed",
    recovery: "recoverable",
  });
}

export function createOpencodeSessionLifecycleAdapter(options: {
  client: OpencodeClientPort;
  workspacePath: string;
  providerID: string;
}): OpencodeSessionLifecycleAdapter {
  const { client, workspacePath, providerID } = options;

  return {
    async createOrResume(
      resumeSessionId,
    ): Promise<OpencodeSessionStartResult> {
      if (resumeSessionId) {
        return { ok: true, sessionId: resumeSessionId, isNewSession: false };
      }

      let createResult: { data?: { id?: string } | null; error?: unknown };
      try {
        createResult = await client.session.create({
          directory: workspacePath,
        });
      } catch (err) {
        return {
          ok: false,
          event: buildCreateSessionFailureEvent(err, providerID),
        };
      }

      if (createResult.error != null) {
        return {
          ok: false,
          event: buildCreateSessionFailureEvent(createResult.error, providerID),
        };
      }

      const createdId = createResult?.data?.id;
      if (!createdId) {
        return {
          ok: false,
          event: buildOpencodeSystemError({
            content: "opencode session 建立失敗：未取得 session ID",
            fatal: true,
            code: "opencode_session_failed",
            recovery: "unrecoverable",
          }),
        };
      }

      return {
        ok: true,
        sessionId: createdId,
        isNewSession: true,
        sessionStartedEvent: { type: "session_started", sessionId: createdId },
      };
    },

    prompt(
      sessionId,
      input,
    ): Promise<{ data?: unknown; error?: unknown }> {
      return client.session.prompt({
        sessionID: sessionId,
        directory: workspacePath,
        ...input,
      });
    },

    abort(sessionId): void {
      client.session
        .abort({ sessionID: sessionId, directory: workspacePath })
        .catch((err: unknown) => {
          logger.warn(
            "Chat",
            "Warn",
            `[OpencodeProvider] session.abort 失敗：${err instanceof Error ? err.message : String(err)}`,
          );
        });
    },

    async messages(
      sessionId,
      limit,
    ): Promise<Array<OpencodeMessageItem> | undefined> {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          client.session.messages({
            sessionID: sessionId,
            directory: workspacePath,
            limit,
          }),
          new Promise<never>((_, reject) =>
            (timeoutHandle = setTimeout(
              () => reject(new Error("opencode session.messages timeout")),
              OPENCODE_SESSION_MESSAGES_TIMEOUT_MS,
            )),
          ),
        ]);
        if (result.error != null) {
          const rawMessage = extractErrorMessage(result.error);
          const classified = classifySessionError(rawMessage, providerID);
          logger.warn(
            "Chat",
            "Warn",
            `[OpencodeProvider] session.messages 查詢失敗（code=${classified.code ?? "unknown"}），跳過 tool tag 補發：${rawMessage}`,
          );
          return undefined;
        }
        return result.data ?? undefined;
      } catch (err) {
        logger.warn(
          "Chat",
          "Warn",
          `[OpencodeProvider] session.messages 查詢失敗，跳過 tool tag 補發：${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    },

    watchPromptFailure(
      promptRequest,
      abortSignal,
    ): Promise<OpencodePromptRaceResult> {
      return new Promise<OpencodePromptRaceResult>((resolve) => {
        promptRequest
          .then((result) => {
            if (abortSignal.aborted) return;
            if (result.error == null) return;
            resolve({
              kind: "prompt_failed",
              event: buildPromptFailureEvent(result.error, providerID),
            });
          })
          .catch((err: unknown) => {
            if (abortSignal.aborted) return;
            resolve({
              kind: "prompt_failed",
              event: buildPromptFailureEvent(err, providerID),
            });
          });
      });
    },
  };
}
