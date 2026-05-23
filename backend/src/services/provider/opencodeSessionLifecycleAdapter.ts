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
    systemMessage: event.systemMessage
      ? {
          ...event.systemMessage,
          metadata: {
            ...event.systemMessage.metadata,
            severity: "fatal",
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
  const classified = classifySessionError(rawMessage, providerID);

  if (
    classified.code === "opencode_auth_missing" ||
    classified.code === "opencode_server_unreachable"
  ) {
    return forceFatalOpencodeError(classified);
  }

  return buildOpencodeSystemError({
    content: `opencode prompt 發送失敗：${rawMessage}`,
    fatal: true,
    code: "opencode_prompt_failed",
    rawContent: rawMessage,
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
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, event: classifySessionError(msg, providerID) };
      }

      const createdId = createResult?.data?.id;
      if (!createdId) {
        return {
          ok: false,
          event: buildOpencodeSystemError({
            content: "opencode session 建立失敗：未取得 session ID",
            fatal: true,
            code: "opencode_session_failed",
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
      try {
        const result = await Promise.race([
          client.session.messages({
            sessionID: sessionId,
            directory: workspacePath,
            limit,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("opencode session.messages timeout")),
              10_000,
            ),
          ),
        ]);
        return result.data ?? undefined;
      } catch (err) {
        logger.warn(
          "Chat",
          "Warn",
          `[OpencodeProvider] session.messages 查詢失敗，跳過 tool tag 補發：${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
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
