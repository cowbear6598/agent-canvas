import {
  type Options,
  type Query,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  isProgrammingError,
  getErrorMessage,
} from "../../utils/errorHelpers.js";
import { logger } from "../../utils/logger.js";
import { getClaudeCodePath } from "./claudePathResolver.js";

export type { StreamEvent, StreamCallback } from "./types.js";

// ─── 公開介面 ────────────────────────────────────────────────────────────────

export interface DisposableChatOptions {
  systemPrompt: string;
  userMessage: string;
  workspacePath: string;
  model?: string;
}

export interface DisposableChatResult {
  content: string;
  success: boolean;
  error?: string;
}

export interface McpChatOptions {
  prompt: string;
  systemPrompt?: string;
  mcpServers?: Options["mcpServers"];
  allowedTools?: string[];
  model?: string;
  cwd: string;
}

// ─── 內部型別 ─────────────────────────────────────────────────────────────────

type AssistantTextBlock = { type: "text"; text: string };
type AssistantContentBlock =
  | AssistantTextBlock
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

// ─── Private helpers（module-level）──────────────────────────────────────────

/** buildBaseOptions：兩個公開方法共用的基礎查詢選項 */
function buildBaseOptions(cwd: string): Partial<Options> {
  return {
    cwd,
    settingSources: ["project"],
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    pathToClaudeCodeExecutable: getClaudeCodePath(),
  };
}

function extractTextFromAssistantMessage(
  sdkMessage: SDKAssistantMessage,
): string {
  if (!sdkMessage.message) return "";
  return (sdkMessage.message.content as AssistantContentBlock[])
    .filter(
      (block): block is AssistantTextBlock =>
        block.type === "text" && Boolean(block.text),
    )
    .map((block) => block.text)
    .join("");
}

function processResultMessage(sdkMessage: SDKResultMessage): {
  success: boolean;
  content: string;
  error?: string;
} {
  if (sdkMessage.subtype === "success") {
    return { success: true, content: sdkMessage.result ?? "" };
  }
  const errorMsg =
    "errors" in sdkMessage && sdkMessage.errors
      ? sdkMessage.errors.join(", ")
      : "未知錯誤";
  return { success: false, content: "", error: errorMsg };
}

function processCollectStreamMessage(
  sdkMessage: SDKMessage,
  fullContent: string,
):
  | { done: false; content: string }
  | {
      done: true;
      result: { success: boolean; content: string; error?: string };
    } {
  if (sdkMessage.type === "assistant") {
    return {
      done: false,
      content:
        fullContent +
        extractTextFromAssistantMessage(sdkMessage as SDKAssistantMessage),
    };
  }
  if (sdkMessage.type !== "result") {
    return { done: false, content: fullContent };
  }
  const result = processResultMessage(sdkMessage as SDKResultMessage);
  if (!result.success) {
    return { done: true, result };
  }
  return {
    done: true,
    result: { success: true, content: result.content || fullContent },
  };
}

async function collectTextFromStream(
  stream: Query,
): Promise<{ success: boolean; content: string; error?: string }> {
  let fullContent = "";
  for await (const sdkMessage of stream) {
    const outcome = processCollectStreamMessage(sdkMessage, fullContent);
    if (outcome.done) {
      return outcome.result;
    }
    fullContent = outcome.content;
  }
  return { success: true, content: fullContent };
}

// ─── ClaudeService ────────────────────────────────────────────────────────────

export class ClaudeService {
  /**
   * 一次性無狀態的 Claude 查詢，適用於 AI decide / summary 等非 Pod 場景。
   * 不會建立 session、不會寫入 podStore。
   */
  public async executeDisposableChat(
    options: DisposableChatOptions,
  ): Promise<DisposableChatResult> {
    const { systemPrompt, userMessage, workspacePath, model } = options;

    try {
      const queryOptions: Options = {
        ...buildBaseOptions(workspacePath),
        allowedTools: [],
        systemPrompt,
      };

      if (model) {
        queryOptions.model = model;
      }

      const queryStream = query({
        prompt: userMessage,
        options: queryOptions,
      });

      const result = await collectTextFromStream(queryStream);
      return result.success
        ? { content: result.content, success: true }
        : { content: "", success: false, error: result.error ?? "" };
    } catch (error) {
      // 程式 bug（TypeError、ReferenceError 等）應向上拋出，讓開發者能發現問題
      // 只捕捉 Claude SDK 的外部錯誤（網路錯誤、API 錯誤、AbortError 等）
      if (isProgrammingError(error)) {
        throw error;
      }

      const errorMessage = getErrorMessage(error);
      logger.error(
        "Chat",
        "Error",
        `[ClaudeService] executeDisposableChat 失敗`,
        error,
      );

      return {
        content: "",
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 以 MCP Server 模式執行 Claude 查詢，回傳 Query（AsyncIterable）供呼叫端串流處理。
   * 主要用於 aiDecideService 的決策流程。
   */
  public executeMcpChat(options: McpChatOptions): Query {
    const baseOptions = buildBaseOptions(options.cwd);
    return query({
      prompt: options.prompt,
      options: {
        ...baseOptions,
        systemPrompt: options.systemPrompt,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
        model: options.model,
      },
    });
  }
}

export const claudeService = new ClaudeService();
