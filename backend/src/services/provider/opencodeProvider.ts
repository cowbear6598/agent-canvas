/**
 * OpencodeProvider
 *
 * 透過 opencode SDK 串接 opencode 本地伺服器，
 * 將 SSE 事件串流轉換為標準化 NormalizedEvent。
 *
 * 實作 AgentProvider<OpencodeOptions> 介面。
 *
 * 流程：
 *   1. buildOptions：從 Pod 設定取出 providerID / modelID / mcpServerNames
 *   2. chat：建立或恢復 session → subscribe SSE → prompt → yield NormalizedEvent
 *   3. abort：透過 abortSignal 觸發 session.abort（F11 Pod 刪除場景）
 */

import { createOpencodeClient } from "@opencode-ai/sdk";
import { OPENCODE_CAPABILITIES } from "./capabilities.js";
import { buildProviderSystemError } from "./types.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderMetadata,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import { sanitizePodName } from "./podNameSanitizer.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import { getOpencodeServerState } from "./opencodeServer.js";

// ================================================================
// Port interfaces（供測試注入 mock）
// ================================================================

/**
 * opencode client 操作介面（供測試可以 mock）
 */
export interface OpencodeClientPort {
  session: {
    create(options: {
      query?: { directory?: string };
    }): Promise<{ data?: { id?: string } | null; error?: unknown }>;
    prompt(options: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        tools?: { [key: string]: boolean };
        parts: Array<{ type: "text"; text: string }>;
      };
    }): Promise<unknown>;
    abort(options: { path: { id: string } }): Promise<unknown>;
  };
  tool: {
    ids(options?: {
      query?: { directory?: string };
    }): Promise<{ data?: string[] | null; error?: unknown }>;
  };
  event: {
    subscribe(options?: {
      query?: { directory?: string };
    }): Promise<{ stream: AsyncGenerator<unknown> }>;
  };
}

/**
 * opencode server state 查詢介面（供測試可以 mock）
 */
export interface OpencodeServerStatePort {
  getState(): { baseUrl: string | null; status: string };
}

// ================================================================
// 型別定義
// ================================================================

/**
 * opencode provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface OpencodeOptions {
  /** opencode 的 provider ID（如 "anthropic"、"openai"） */
  providerID: string;
  /** opencode 的 model ID（如 "claude-sonnet-4-5"） */
  modelID: string;
  /** 已勾選的 MCP server name 陣列 */
  mcpServerNames: string[];
}

// ================================================================
// 注入點（測試可替換）
// ================================================================

/** 建立 client 的工廠函式（測試可替換） */
let _createClient: (options: { baseUrl: string }) => OpencodeClientPort = (
  options,
) =>
  createOpencodeClient({
    baseUrl: options.baseUrl,
  }) as unknown as OpencodeClientPort;

/** server state 查詢（測試可替換） */
let _getServerState: () => { baseUrl: string | null; status: string } = () =>
  getOpencodeServerState();

/**
 * 替換 client 工廠（僅測試使用）
 */
export function setOpencodeClientFactory(
  factory: (options: { baseUrl: string }) => OpencodeClientPort,
): void {
  _createClient = factory;
}

/**
 * 替換 server state 查詢（僅測試使用）
 */
export function setOpencodeServerStateFactory(
  factory: () => { baseUrl: string | null; status: string },
): void {
  _getServerState = factory;
}

/**
 * 重置 client 工廠為預設值（測試 teardown 使用）
 */
export function resetOpencodeClientFactory(): void {
  _createClient = (options) =>
    createOpencodeClient({
      baseUrl: options.baseUrl,
    }) as unknown as OpencodeClientPort;
}

/**
 * 重置 server state 查詢為預設值（測試 teardown 使用）
 */
export function resetOpencodeServerStateFactory(): void {
  _getServerState = () => getOpencodeServerState();
}

// ================================================================
// helper
// ================================================================

/** opencode provider 專用的系統錯誤建立 helper */
function buildOpencodeSystemError(params: {
  content: string;
  fatal: boolean;
  code: string;
  rawContent?: string;
}): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("opencode", params);
}

/**
 * 依 session.error 訊息分類錯誤碼與使用者訊息。
 *
 * - "No auth credentials found" / "API key" → opencode_auth_missing
 * - "connection refused" / "fetch failed" / "ECONNREFUSED" → opencode_server_unreachable
 * - 其他 → opencode_session_failed
 */
function classifySessionError(
  rawMessage: string,
  providerID: string,
): Extract<NormalizedEvent, { type: "error" }> {
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("no auth credentials found") ||
    lower.includes("api key")
  ) {
    return buildOpencodeSystemError({
      content: `請在 terminal 執行 \`opencode auth login ${providerID}\` 後再試一次`,
      fatal: false,
      code: "opencode_auth_missing",
      rawContent: rawMessage,
    });
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused")
  ) {
    return buildOpencodeSystemError({
      content: "opencode server 連線失敗，請重啟後端",
      fatal: true,
      code: "opencode_server_unreachable",
      rawContent: rawMessage,
    });
  }

  return buildOpencodeSystemError({
    content: `opencode session 發生錯誤：${rawMessage}`,
    fatal: false,
    code: "opencode_session_failed",
    rawContent: rawMessage,
  });
}

/**
 * 從 session.error event 的 error 物件取出字串訊息。
 */
function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "未知錯誤");
  const obj = error as Record<string, unknown>;

  // ProviderAuthError / ApiError / UnknownError / MessageAbortedError 都有 data.message
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.message === "string") return data.message;
  }

  // fallback
  if (typeof obj.message === "string") return obj.message;
  return JSON.stringify(error);
}

/**
 * 建立 tools 子集化物件：
 *   - 對 ctx.options.mcpServerNames 內出現的 server 對應 tool 設 true
 *   - 其餘 mcp__* 設 false
 *   - 非 mcp__ 開頭的內建 tool 不放入物件（保持 opencode 預設）
 *
 * tool list 失敗時 try-catch：logger.warn 後回傳 undefined（讓 prompt 不傳 tools）
 */
async function buildToolsSubset(
  client: OpencodeClientPort,
  mcpServerNames: string[],
): Promise<{ [key: string]: boolean } | undefined> {
  let toolIds: string[];
  try {
    const result = await client.tool.ids();
    if (!result.data) return undefined;
    toolIds = result.data;
  } catch (err) {
    logger.warn(
      "Chat",
      "Warn",
      `[OpencodeProvider] tool list 查詢失敗，改用 opencode 預設全開：${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const allowedServers = new Set(mcpServerNames);
  const tools: { [key: string]: boolean } = {};

  for (const toolId of toolIds) {
    if (!toolId.startsWith("mcp__")) continue;

    // mcp__<server>__<name> 格式：取第二段為 server name
    const parts = toolId.split("__");
    const serverName = parts[1] ?? "";
    tools[toolId] = allowedServers.has(serverName);
  }

  return tools;
}

// ================================================================
// Provider 實作
// ================================================================

/**
 * opencode Provider singleton。
 */
export const opencodeProvider: AgentProvider<OpencodeOptions> = {
  metadata: {
    name: "opencode",
    capabilities: OPENCODE_CAPABILITIES,
    defaultOptions: {
      providerID: "",
      modelID: "",
      mcpServerNames: [],
    },
    availableModels: [],
    availableModelValues: new Set<string>(),
  } satisfies ProviderMetadata<OpencodeOptions>,

  /**
   * 從 Pod 設定建構 opencode 執行時選項。
   *
   * - pod.providerConfig.model 格式為 "{providerID}/{modelID}"，以第一個 "/" 拆分
   * - mcpServerNames 從 pod.mcpServerNames 取得
   */
  async buildOptions(
    pod: Pod,
    _runContext?: RunContext,
  ): Promise<OpencodeOptions> {
    const rawModel =
      typeof pod.providerConfig?.model === "string"
        ? (pod.providerConfig.model as string)
        : "";

    // 以第一個 "/" 為界拆分 providerID / modelID
    const slashIndex = rawModel.indexOf("/");
    let providerID: string;
    let modelID: string;

    if (slashIndex === -1) {
      providerID = rawModel;
      modelID = "";
    } else {
      providerID = rawModel.slice(0, slashIndex);
      modelID = rawModel.slice(slashIndex + 1);
    }

    const mcpServerNames = [...pod.mcpServerNames];

    return { providerID, modelID, mcpServerNames };
  },

  /**
   * 發起聊天，回傳標準化事件的 AsyncIterable。
   *
   * 流程：
   * 1. 從 server state 取 baseUrl
   * 2. 建立 client
   * 3. resumeSessionId 為 null 時建立新 session，否則沿用
   * 4. 掛載 abort 處理
   * 5. 訂閱 SSE stream + 送出 prompt（並行）
   * 6. for-await 處理 31 種 event → yield NormalizedEvent
   */
  async *chat(
    ctx: ChatRequestContext<OpencodeOptions>,
  ): AsyncIterable<NormalizedEvent> {
    const {
      podName,
      message,
      workspacePath,
      resumeSessionId,
      abortSignal,
      options,
    } = ctx;

    // ── options 防禦性收窄 ──────────────────────────────────────────
    if (options == null) {
      yield buildOpencodeSystemError({
        content: "內部錯誤：chat options 不可為空",
        fatal: true,
        code: "opencode_missing_options",
      });
      return;
    }

    // ── 取得 baseUrl ────────────────────────────────────────────────
    const serverState = _getServerState();
    if (!serverState.baseUrl) {
      yield buildOpencodeSystemError({
        content: "opencode server 連線失敗，請重啟後端",
        fatal: true,
        code: "opencode_server_unreachable",
      });
      return;
    }

    const client = _createClient({ baseUrl: serverState.baseUrl });

    logger.log(
      "Chat",
      "Update",
      `[OpencodeProvider] ${sanitizePodName(podName)} 開始查詢（provider: ${options.providerID}，model: ${options.modelID}）`,
    );

    // ── 建立或沿用 session ──────────────────────────────────────────
    let sessionId: string;
    let alreadyYieldedSessionStarted = false;

    if (resumeSessionId === null) {
      let createResult: { data?: { id?: string } | null; error?: unknown };
      try {
        createResult = await client.session.create({
          query: { directory: workspacePath },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield classifySessionError(msg, options.providerID);
        return;
      }

      const createdId = createResult?.data?.id;
      if (!createdId) {
        yield buildOpencodeSystemError({
          content: "opencode session 建立失敗：未取得 session ID",
          fatal: true,
          code: "opencode_session_failed",
        });
        return;
      }

      sessionId = createdId;
      yield { type: "session_started", sessionId };
      alreadyYieldedSessionStarted = true;
    } else {
      sessionId = resumeSessionId;
    }

    // ── abort 處理 ──────────────────────────────────────────────────
    const doAbort = (): void => {
      client.session
        .abort({ path: { id: sessionId } })
        .catch((err: unknown) => {
          logger.warn(
            "Chat",
            "Warn",
            `[OpencodeProvider] session.abort 失敗：${err instanceof Error ? err.message : String(err)}`,
          );
        });
    };

    abortSignal.addEventListener("abort", doAbort, { once: true });

    // 已 abort：立刻呼叫 abort
    if (abortSignal.aborted) {
      doAbort();
    }

    try {
      // ── 訂閱 SSE stream ────────────────────────────────────────────
      let sseResult: { stream: AsyncGenerator<unknown> };
      try {
        sseResult = await client.event.subscribe();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield classifySessionError(msg, options.providerID);
        return;
      }

      // ── tools 子集化 ───────────────────────────────────────────────
      const toolsSubset = await buildToolsSubset(
        client,
        options.mcpServerNames,
      );

      // ── 送出 prompt（非同步，不等待回傳） ──────────────────────────
      const promptBody: {
        model?: { providerID: string; modelID: string };
        tools?: { [key: string]: boolean };
        parts: Array<{ type: "text"; text: string }>;
      } = {
        parts: [
          {
            type: "text",
            text: typeof message === "string" ? message : "",
          },
        ],
      };

      if (options.providerID || options.modelID) {
        promptBody.model = {
          providerID: options.providerID,
          modelID: options.modelID,
        };
      }

      if (toolsSubset !== undefined) {
        promptBody.tools = toolsSubset;
      }

      client.session
        .prompt({
          path: { id: sessionId },
          body: promptBody,
        })
        .catch((err: unknown) => {
          logger.warn(
            "Chat",
            "Warn",
            `[OpencodeProvider] session.prompt 發生錯誤：${err instanceof Error ? err.message : String(err)}`,
          );
        });

      // ── for-await SSE stream ───────────────────────────────────────
      for await (const rawEvent of sseResult.stream) {
        if (abortSignal.aborted) break;

        const event = rawEvent as {
          type?: string;
          properties?: Record<string, unknown>;
        };
        if (!event || !event.type) continue;

        const type = event.type;
        const props = event.properties ?? {};

        // session.created → session_started（避免重複 yield）
        if (type === "session.created") {
          if (!alreadyYieldedSessionStarted) {
            const info = props.info as { id?: string } | undefined;
            const createdSessionId = info?.id ?? sessionId;
            yield { type: "session_started", sessionId: createdSessionId };
            alreadyYieldedSessionStarted = true;
          }
          continue;
        }

        // message.part.updated → 依 part.type 分發
        if (type === "message.part.updated") {
          const part = props.part as
            | {
                type?: string;
                text?: string;
                callID?: string;
                tool?: string;
                state?: {
                  status?: string;
                  input?: Record<string, unknown>;
                  output?: string;
                };
              }
            | undefined;

          if (!part) continue;

          if (part.type === "text" && typeof part.text === "string") {
            yield { type: "text", content: part.text };
            continue;
          }

          if (part.type === "reasoning" && typeof part.text === "string") {
            yield { type: "thinking", content: part.text };
            continue;
          }

          if (part.type === "tool") {
            const state = part.state;
            const callID = part.callID ?? "";
            const toolName = part.tool ?? "";

            if (state?.status === "running" || state?.status === "pending") {
              yield {
                type: "tool_call_start",
                toolUseId: callID,
                toolName,
                input: (state.input as Record<string, unknown>) ?? {},
              };
              continue;
            }

            if (state?.status === "completed") {
              yield {
                type: "tool_call_result",
                toolUseId: callID,
                toolName,
                output: state.output ?? "",
              };
              continue;
            }
          }

          continue;
        }

        // session.idle → turn_complete，結束 loop
        if (type === "session.idle") {
          yield { type: "turn_complete" };
          break;
        }

        // session.error → 分類錯誤並結束
        if (type === "session.error") {
          const error = props.error;
          const rawMessage = extractErrorMessage(error);
          yield classifySessionError(rawMessage, options.providerID);
          break;
        }

        // 其他 event 忽略
      }
    } finally {
      abortSignal.removeEventListener("abort", doAbort);
    }
  },
};
