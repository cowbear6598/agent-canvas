/**
 * OpencodeProvider（SDK v2 API + 1.14 binary 行為調適）
 *
 * 透過 opencode SDK v2 串接 opencode 本地伺服器，
 * 將 SSE 事件串流轉換為標準化 NormalizedEvent。
 *
 * 實作 AgentProvider<OpencodeOptions> 介面。
 *
 * 流程：
 *   1. buildOptions：從 Pod 設定取出 providerID / modelID / mcpServerNames
 *   2. chat：建立或恢復 session → subscribe SSE → prompt → yield NormalizedEvent
 *   3. abort：透過 abortSignal 觸發 session.abort（Pod 刪除場景）
 *
 * SDK v2 API 變更（相對 v1）：
 *   - session.create / prompt / abort / messages 使用平鋪參數形狀
 *     （sessionID、directory 頂層化，不再放在 path / query 子物件）
 *
 * 事件處理（opencode 1.14 binary 行為調適）：
 *   - 1.14 binary 在 streaming 階段只發 message.part.delta（field=text / reasoning），
 *     不發 session.next.*、也不在 streaming 中發 message.part.updated 帶 ToolPart；
 *     工具資訊只能透過 session.messages API 拉。
 *   - 為了讓工具能與文字 interleave 顯示（不是全擠到 turn 結尾），本檔利用
 *     message.part.delta 的 partID 變動作為 section 邊界：
 *       1. 同一 partID 連續 delta → 同一段文字 / reasoning
 *       2. partID 改變 → 兩個 text part 之間必有其他 part（多半是 tool）介入；
 *          觸發 session.messages 查詢，把該段「中間 part」中所有已完成的 ToolPart
 *          yield 出來（tool_call_start + tool_call_result），再繼續處理新 partID 的 delta
 *       3. session.idle → 補拉最後一段（最後 tool 之後沒有再跟著 text 的情境）
 *   - yieldedToolCallIDs Set 全程記錄已 yield 過的 tool callID，避免 partID 多次切換
 *     或 idle 補拉造成重複。
 *   - currentMessageIds Set 紀錄本 turn 的 assistant messageID，限制 session.messages
 *     只取本 turn 內的 message（過濾舊 turn 殘留）。
 *   - active session 過濾：workspace 廣播事件依 properties.sessionID 過濾，
 *     忽略屬於其他 session 的事件。
 *   - Goal Runtime bootstrap prompt 只在新 session 第一輪注入，
 *     resume session 時不注入（避免覆蓋 gate retry 的 nudge 指示）。
 */

import { createOpencodeServer } from "@opencode-ai/sdk";
import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2";
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
import {
  managedMcpSurfaceService,
  type PodMcpEntry,
} from "../mcp/managedMcpSurfaceService.js";
import { getOpencodeServerState } from "./opencodeServer.js";
import {
  buildOpencodeSystemError,
  classifySessionError,
  extractErrorMessage,
} from "./opencodeErrorClassifier.js";
import {
  serializeV2ToolSuccessContent,
  serializeV2ToolFailureError,
} from "./opencodeToolSerializer.js";
import {
  buildOpencodeTransientServerConfig,
  buildServerCacheKey,
} from "./opencodeMcpConfigBuilder.js";
import { buildOpencodePromptText } from "./opencodePromptHelpers.js";
import { formatPluginSkillCatalogPrompt } from "../plugin/pluginCatalogBuilder.js";

// 重新匯出測試與其他模組依賴的公開 API（拆檔後保持原本 import path 可用）
export {
  serializeV2ToolSuccessContent,
  serializeV2ToolFailureError,
} from "./opencodeToolSerializer.js";

// ================================================================
// Port interfaces（供測試注入 mock）
// ================================================================

/**
 * opencode v2 client 的 session.prompt 請求 body 形狀。
 */
export interface OpencodeV2PromptInput {
  model?: { providerID: string; modelID: string };
  tools?: { [key: string]: boolean };
  /** v2 支援透過 system 欄位注入 Goal Runtime bootstrap prompt */
  system?: string;
  parts: Array<{ type: "text"; text: string }>;
}

/**
 * session.messages 回傳的 message 項目形狀（v2 相容）。
 */
export interface OpencodeMessageItem {
  info: { id: string; role: string };
  parts: Array<{
    id: string;
    type: string;
    callID?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    };
  }>;
}

/**
 * opencode client 操作介面（供測試可以 mock）。
 *
 * 參數形狀對齊 SDK v2 OpencodeClient（Session2 class）：
 * - session.create：使用頂層 directory / workspace，不再放在 query 子物件
 * - session.prompt：以 sessionID（string）取代 path.id，body 欄位平鋪至頂層
 * - session.abort：以 sessionID 取代 path.id
 * - session.messages：以 sessionID 取代 path.id，query 參數平鋪至頂層
 * - event.subscribe：directory 平鋪至頂層（不再放在 query）
 * - tool.ids：directory 平鋪至頂層
 */
export interface OpencodeClientPort {
  session: {
    create(parameters?: {
      directory?: string;
    }): Promise<{ data?: { id?: string } | null; error?: unknown }>;
    prompt(parameters: {
      sessionID: string;
      directory?: string;
      model?: { providerID: string; modelID: string };
      tools?: { [key: string]: boolean };
      system?: string;
      parts: Array<{ type: "text"; text: string }>;
    }): Promise<unknown>;
    abort(parameters: {
      sessionID: string;
      directory?: string;
    }): Promise<unknown>;
    messages(parameters: {
      sessionID: string;
      directory?: string;
      limit?: number;
    }): Promise<{
      data?: Array<OpencodeMessageItem> | null;
      error?: unknown;
    }>;
  };
  tool: {
    ids(parameters?: {
      directory?: string;
    }): Promise<{ data?: string[] | null; error?: unknown }>;
  };
  event: {
    subscribe(parameters?: {
      directory?: string;
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
  /**
   * 要注入給 opencode transient server 的 managed MCP entries（含 Goal Runtime；run / chat 統一）。
   * 每筆轉成 opencode `config.mcp[name]` 形狀（stdio 用 type=local、http/sse 用 type=remote）。
   * 為空時不啟動 transient server，沿用全域 opencode server。
   */
  mcpEntries: PodMcpEntry[];
  /** Goal Runtime 是否在 mcpEntries 內，用於決定是否注入 bootstrap prompt */
  hasGoalRuntime: boolean;
  /**
   * Plugin Skill Catalog 文字段落（已預先 format）。
   * 空字串代表本 Pod 無啟用 plugin 或掃不出任何 SKILL.md。
   * Fresh session 首輪會與 Goal Runtime bootstrap 一起注入 user prompt。
   */
  pluginCatalogText: string;
}

// ================================================================
// 注入點（測試可替換）
// ================================================================

/**
 * 將 v2 SDK OpencodeClient 包裝成 OpencodeClientPort。
 *
 * v2 SDK 的 session.create / prompt / abort / messages 使用平鋪參數形狀，
 * 與舊版 v1 的 { path: { id }, query: {}, body: {} } 結構不同。
 * 此函式橋接兩者，讓主程式邏輯只需面對 OpencodeClientPort 介面。
 */
function buildOpencodeClientPort(baseUrl: string): OpencodeClientPort {
  const v2 = createOpencodeClientV2({ baseUrl });

  return {
    session: {
      async create(
        parameters,
      ): Promise<{ data?: { id?: string } | null; error?: unknown }> {
        const result = await v2.session.create(parameters);
        // v2 RequestResult 回傳 { data, error, request, response }
        // Session 物件直接有 .id 欄位
        const data = (result as { data?: { id?: string } | null }).data ?? null;
        const error = (result as { error?: unknown }).error;
        return { data, error };
      },
      async prompt(parameters): Promise<unknown> {
        const { sessionID, directory, model, tools, system, parts } =
          parameters;
        return v2.session.prompt({
          sessionID,
          directory,
          model,
          tools,
          system,
          parts,
        });
      },
      async abort(parameters): Promise<unknown> {
        return v2.session.abort(parameters);
      },
      async messages(parameters): Promise<{
        data?: Array<OpencodeMessageItem> | null;
        error?: unknown;
      }> {
        const result = await v2.session.messages(parameters);
        const rawData = (result as { data?: unknown }).data;
        const error = (result as { error?: unknown }).error;

        // v2 messages 回傳 Array<{ info: Message, parts: Part[] }>
        // 其中 Message = UserMessage | AssistantMessage，info.id 與 info.role 與介面相容
        const data = Array.isArray(rawData)
          ? (rawData as Array<OpencodeMessageItem>)
          : null;

        return { data, error };
      },
    },
    tool: {
      async ids(
        parameters,
      ): Promise<{ data?: string[] | null; error?: unknown }> {
        const result = await v2.tool.ids(parameters);
        const data = (result as { data?: string[] | null }).data ?? null;
        const error = (result as { error?: unknown }).error;
        return { data, error };
      },
    },
    event: {
      async subscribe(
        parameters,
      ): Promise<{ stream: AsyncGenerator<unknown> }> {
        return v2.event.subscribe(parameters);
      },
    },
  };
}

/** 建立 client 的工廠函式（測試可替換） */
let _createClient: (options: { baseUrl: string }) => OpencodeClientPort = (
  options,
) => buildOpencodeClientPort(options.baseUrl);

/** 建立 transient server 的工廠函式（測試可替換） */
let _createServer: typeof createOpencodeServer = (options) =>
  createOpencodeServer(options);

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
 * 替換 transient server 工廠（僅測試使用）
 */
export function setOpencodeServerFactory(
  factory: typeof createOpencodeServer,
): void {
  _createServer = factory;
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
  _createClient = (options): OpencodeClientPort =>
    buildOpencodeClientPort(options.baseUrl);
}

/**
 * 重置 transient server 工廠為預設值（測試 teardown 使用）
 */
export function resetOpencodeServerFactory(): void {
  _createServer = createOpencodeServer;
}

/**
 * 重置 server state 查詢為預設值（測試 teardown 使用）
 */
export function resetOpencodeServerStateFactory(): void {
  _getServerState = (): { baseUrl: string | null; status: string } =>
    getOpencodeServerState();
}

/**
 * session.next.tool.called 暫存：callID → { toolName, input }。
 * session.next.tool.success / failed 只帶 callID，缺 tool name；此 Map 在收到
 * tool.called 時暫存，讓 success / failed handler 能組出完整 NormalizedEvent。
 *
 * 1.14 binary 沒有發 session.next.* 事件，此 Map 在當前 binary 下不會被使用；
 * 保留是為了未來 binary 升級後支援 v2 streaming tool 事件。
 */
interface PendingToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * 拉 session.messages 並把本 turn 內、尚未 yield 過的已完成 ToolPart 轉成
 * tool_call_start + tool_call_result yield 出去。
 *
 * 由兩個地方呼叫：
 *   1. message.part.delta 偵測到 partID 切換時 → 中間插入該段 tool；
 *      讓 chat UI 能呈現 text → tool → text → tool 的真實順序，而不是
 *      所有 tool 全擠到 turn 結尾（opencode 1.14 binary 本身沒有 streaming
 *      tool 事件，這是唯一能即時拿到 tool 資訊的途徑）。
 *   2. session.idle → 補拉最後一段（最後一次 tool 之後沒有再跟著 text 的情況）。
 *
 * yieldedToolCallIDs 在此 turn 範圍內全程持有，重複 callID 不會再次 yield。
 * 只 yield status=completed / error 的 tool；尚未完成的 tool 留到下次再查。
 *
 * 失敗時 try/catch 記 warn，不中斷 turn 流程。
 */
async function* yieldPendingToolParts(
  client: OpencodeClientPort,
  sessionId: string,
  workspacePath: string,
  currentMessageIds: ReadonlySet<string>,
  yieldedToolCallIDs: Set<string>,
): AsyncGenerator<NormalizedEvent> {
  if (currentMessageIds.size === 0) return;

  let messages: Awaited<
    ReturnType<OpencodeClientPort["session"]["messages"]>
  >["data"];
  const messageLimit = Math.max(currentMessageIds.size, 50);
  try {
    const result = await Promise.race([
      client.session.messages({
        sessionID: sessionId,
        directory: workspacePath,
        limit: messageLimit,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("opencode session.messages timeout")),
          10_000,
        ),
      ),
    ]);
    messages = result.data ?? undefined;
  } catch (err) {
    logger.warn(
      "Chat",
      "Warn",
      `[OpencodeProvider] session.messages 查詢失敗，跳過 tool tag 補發：${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (!messages) return;

  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue;
    if (!currentMessageIds.has(msg.info.id)) continue;

    for (const part of msg.parts) {
      if (part.type !== "tool") continue;

      const callID = part.callID ?? "";
      if (!callID || yieldedToolCallIDs.has(callID)) continue;

      const toolName = part.tool ?? "";
      const state = part.state;
      const input = (state?.input as Record<string, unknown>) ?? {};

      if (state?.status === "completed") {
        yieldedToolCallIDs.add(callID);
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
        yieldedToolCallIDs.add(callID);
        yield { type: "tool_call_start", toolUseId: callID, toolName, input };
        yield {
          type: "tool_call_result",
          toolUseId: callID,
          toolName,
          output: `[Error] ${state.error ?? "tool failed"}`,
        };
        continue;
      }
      // running / pending 狀態先跳過，下次 partID 切換或 session.idle 再來補
    }
  }
}

// ================================================================
// Run-scoped transient server 快取
// ================================================================

/**
 * Run 期間每個 (runId, podId) 組合共用同一個 transient opencode server，
 * 避免 gate retry 每輪都付出 server 冷啟動成本。
 * Run 結束時由 cleanupOpencodeRunServers 統一關閉並清除。
 */
const runScopedOpencodeServerCache = new Map<
  string,
  { close(): void; url: string }
>();

/**
 * 取得或建立 Run 期間的 transient opencode server。
 * 同一 runId + podId 只建立一次；後續 chat 直接復用。
 */
async function getOrCreateRunScopedServer(
  runId: string,
  podId: string,
  entries: PodMcpEntry[],
): Promise<{ close(): void; url: string }> {
  const key = buildServerCacheKey(runId, podId);
  const cached = runScopedOpencodeServerCache.get(key);
  if (cached) return cached;

  const server = await _createServer({
    port: 0,
    timeout: 30000,
    config: buildOpencodeTransientServerConfig(entries),
  });

  runScopedOpencodeServerCache.set(key, server);
  return server;
}

/**
 * Run 結束時統一關閉所有屬於該 runId 的 transient server 並清除快取。
 * 由 runExecutionService 的生命週期 hook 呼叫。
 */
export function cleanupOpencodeRunServers(runId: string): void {
  const prefix = `${runId}:`;
  for (const [key, server] of runScopedOpencodeServerCache) {
    if (key.startsWith(prefix)) {
      try {
        server.close();
      } catch {
        // 忽略已關閉的 server
      }
      runScopedOpencodeServerCache.delete(key);
    }
  }
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
    defaultOptions: {
      providerID: "",
      modelID: "",
      mcpEntries: [],
      hasGoalRuntime: false,
      pluginCatalogText: "",
    },
    availableModels: [],
    availableModelValues: new Set<string>(),
  } satisfies ProviderMetadata<OpencodeOptions>,

  /**
   * 從 Pod 設定建構 opencode 執行時選項。
   *
   * - pod.providerConfig.model 格式為 "{providerID}/{modelID}"，以第一個 "/" 拆分
   * - MCP entries 由 managedMcpSurfaceService.buildPodMcpEntries 統一組
   *   （run 模式才會含 Goal Runtime）
   */
  async buildOptions(
    pod: Pod,
    runContext?: RunContext,
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

    const { entries, hasGoalRuntime, pluginCatalog } =
      await managedMcpSurfaceService.buildPodMcpEntries(
        pod,
        runContext ?? null,
      );

    return {
      providerID,
      modelID,
      mcpEntries: entries,
      hasGoalRuntime,
      pluginCatalogText: formatPluginSkillCatalogPrompt(pluginCatalog),
    };
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
      podId,
      podName,
      message,
      workspacePath,
      resumeSessionId,
      abortSignal,
      options,
      runContext,
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
    let transientServer: { close(): void; url: string } | null = null;
    let serverClosed = false;

    // idempotent close：避免多路徑重複呼叫 close()
    const closeTransientServer = (): void => {
      if (!serverClosed && transientServer) {
        serverClosed = true;
        transientServer.close();
        transientServer = null;
      }
    };

    // transientServer 建立之後到 method 結束全部包在同一個 try/finally，
    // 確保 session 建立失敗、session ID 為空、abort 提前觸發等所有路徑都會 close
    try {
      let baseUrl: string | null = null;
      const mcpEntries = options.mcpEntries ?? [];
      const goalRuntimeAvailable = Boolean(options.hasGoalRuntime);

      if (mcpEntries.length > 0) {
        try {
          if (runContext) {
            // Run 期間同一 (runId, podId) 復用同一個 transient server，
            // 避免 gate retry 每輪都付出 server 冷啟動成本。
            // 快取的 server 由 cleanupOpencodeRunServers 在 Run 結束時統一關閉，
            // 此處 transientServer 保持 null（不走 closeTransientServer 關閉）。
            const cached = await getOrCreateRunScopedServer(
              runContext.runId,
              podId,
              mcpEntries,
            );
            baseUrl = cached.url;
          } else {
            // 無 runContext（單次對話模式）：建立 request-scoped transient server，
            // 由外層 finally 的 closeTransientServer 負責關閉。
            transientServer = await _createServer({
              // 使用 ephemeral port，避免與既有全域 opencode server 的 4096 衝突
              port: 0,
              timeout: 30000,
              config: buildOpencodeTransientServerConfig(mcpEntries),
            });
            baseUrl = transientServer.url;
          }
        } catch (err) {
          yield buildOpencodeSystemError({
            content: "opencode server 連線失敗，請重啟後端",
            fatal: true,
            code: "opencode_server_unreachable",
            rawContent: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      } else {
        const serverState = _getServerState();
        if (!serverState.baseUrl) {
          yield buildOpencodeSystemError({
            content: "opencode server 連線失敗，請重啟後端",
            fatal: true,
            code: "opencode_server_unreachable",
          });
          return;
        }
        baseUrl = serverState.baseUrl;
      }

      if (!baseUrl) {
        yield buildOpencodeSystemError({
          content: "opencode server 連線失敗，請重啟後端",
          fatal: true,
          code: "opencode_server_unreachable",
        });
        return;
      }

      const client = _createClient({ baseUrl });

      logger.log(
        "Chat",
        "Update",
        `[OpencodeProvider] ${sanitizePodName(podName)} 開始查詢（provider: ${options.providerID}，model: ${options.modelID}）`,
      );

      // ── 建立或沿用 session ──────────────────────────────────────────
      // 用 truthy 判斷而非嚴格 === null：
      // 上層 normalExecutionStrategy.getSessionId 用 `?? undefined`，pod.sessionId 為空字串時
      // 不會 fallback，會把 "" 一路傳下來；若用 === null 會誤走 resume 流程並送出 sessionId=""
      // 給 opencode server，導致 prompt 被靜默丟棄、SSE 只回 heartbeat。
      let sessionId: string;
      let alreadyYieldedSessionStarted = false;

      if (!resumeSessionId) {
        // 新對話：建立新 session
        let createResult: { data?: { id?: string } | null; error?: unknown };
        try {
          // v2 SDK: directory 平鋪至頂層，不再放在 query 子物件
          createResult = await client.session.create({
            directory: workspacePath,
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
        // 續聊：沿用既有 session，不建立新 session、不再 yield session_started
        sessionId = resumeSessionId;
      }

      // ── abort 處理 ──────────────────────────────────────────────────
      const doAbort = (): void => {
        // abort 觸發時同時關閉 transient server，避免 abort 後 server 還留著
        closeTransientServer();
        // v2 SDK: 使用 sessionID（string）取代 path.id
        client.session
          .abort({ sessionID: sessionId, directory: workspacePath })
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

      // 本 turn 出現過的 assistant messageID 集合
      // 用於 session.messages 查詢時，限定只取本 turn 內的 message。
      const currentMessageIds = new Set<string>();

      // 本 turn 已 yield 過的 tool callID。
      // 由「v1 partID 切換 inline 補拉」「session.idle 補拉」以及「v2 session.next.tool.*」
      // 三個路徑共用，避免重複 yield 同一個 tool。
      const yieldedToolCallIDs = new Set<string>();

      // 上一次 message.part.delta 的 partID。
      // partID 變動代表前一個 text/reasoning part 已結束、之間可能有 tool 介入，
      // 觸發 session.messages 查詢補拉那段 tool。
      let currentPartID: string | undefined = undefined;

      // partID 切換 throttle：記錄最近一次成功觸發 yieldPendingToolParts 的時間戳（ms）。
      // 連續密集的 partID 切換若離上次查詢 < 200ms，跳過本次 inline 查詢；
      // session.idle 路徑不套此限制，確保 turn 結束前一定補拉，不會漏 tool。
      let lastPartIDQueryAt: number = 0;
      const PART_ID_QUERY_THROTTLE_MS = 200;

      // v2 session.next.tool.called 暫存（給後續 success/failed 配對 tool name）。
      // 1.14 binary 不發此事件，但保留以兼容未來 binary 升級。
      const pendingToolCalls = new Map<string, PendingToolCall>();

      try {
        // ── 訂閱 SSE stream ────────────────────────────────────────────
        // 帶上 directory 對應到該 Pod 的 workspace，
        // 否則 opencode 會 fallback 到 server 啟動時的 cwd（後端工程目錄）。
        // v2 SDK: directory 平鋪至頂層，不再放在 query 子物件。
        let sseResult: { stream: AsyncGenerator<unknown> };
        try {
          sseResult = await client.event.subscribe({
            directory: workspacePath,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          yield classifySessionError(msg, options.providerID);
          return;
        }

        // 有注入 transient server（mcpEntries 非空）時，其 tool list 只含我們注入的 entry 工具，
        // 不需要再過濾；entries 為空走全域 opencode server，沿用 opencode 預設 tool 可見性
        // （由使用者的 ~/.config/opencode/opencode.json 決定，不再做後端 allowlist）。
        const toolsSubset: { [key: string]: boolean } | undefined = undefined;

        // ── 送出 prompt（非同步，不等待回傳） ──────────────────────────
        // v2 SDK: session.prompt 使用平鋪參數形狀（sessionID + 各欄位）。
        // Goal Runtime bootstrap prompt 只在新 session（非 resume）第一輪注入，
        // resume session 時 resumeSessionId 為 truthy，buildOpencodePromptText 不會注入。
        const promptParams: {
          sessionID: string;
          directory: string;
          model?: { providerID: string; modelID: string };
          tools?: { [key: string]: boolean };
          parts: Array<{ type: "text"; text: string }>;
        } = {
          sessionID: sessionId,
          directory: workspacePath,
          parts: [
            {
              type: "text",
              text: buildOpencodePromptText(
                message,
                goalRuntimeAvailable,
                options.pluginCatalogText ?? "",
                resumeSessionId,
              ),
            },
          ],
        };

        if (options.providerID || options.modelID) {
          promptParams.model = {
            providerID: options.providerID,
            modelID: options.modelID,
          };
        }

        if (toolsSubset !== undefined) {
          promptParams.tools = toolsSubset;
        }

        client.session.prompt(promptParams).catch((err: unknown) => {
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

          // ── active session 過濾 ──────────────────────────────────────
          // opencode event stream 是 workspace 層級的廣播，同一 workspace 內
          // 所有 session 的事件都會推送過來。只處理屬於本次 sessionId 的事件，
          // 避免把其他 session（例如同 workspace 另一個 Pod）的事件寫入當前對話。
          //
          // session.created / session.error / session.idle 均有 properties.sessionID；
          // session.next.* 系列事件同樣帶 sessionID。
          // 無 sessionID 欄位的系統事件（如 server.connected）不做過濾，直接忽略即可。
          //
          // sessionId 在訂閱 SSE stream 之前已透過 session.create API 確定，
          // 因此可安全用於過濾所有帶 sessionID 的事件（含 session.created）。
          const eventSessionID = props.sessionID as string | undefined;
          if (eventSessionID !== undefined && eventSessionID !== sessionId) {
            continue;
          }

          // session.created → session_started（避免重複 yield）
          // v2 SDK: properties.sessionID 直接是字串，取代舊版的 properties.info.id
          if (type === "session.created") {
            if (!alreadyYieldedSessionStarted) {
              const createdSessionId =
                (props.sessionID as string | undefined) ?? sessionId;
              yield { type: "session_started", sessionId: createdSessionId };
              alreadyYieldedSessionStarted = true;
            }
            continue;
          }

          // message.part.delta → 文字 / thinking 增量（streaming 逐字推送）
          //
          // opencode 1.14 binary 在 streaming 階段只發這個事件；工具資訊不會
          // 即時透過 SSE 推送，要靠 session.messages API 拉。
          //
          // partID 切換：兩個連續 delta 的 partID 不同 → 中間必有其他 part
          // （通常是 tool）介入，觸發 session.messages 補拉，把該段已完成的
          // ToolPart 以 tool_call_start + tool_call_result yield 出來，讓
          // chat UI 顯示 text → tool → text → tool 的真實順序。
          if (type === "message.part.delta") {
            const messageID = props.messageID as string | undefined;
            if (messageID) currentMessageIds.add(messageID);

            const partID = props.partID as string | undefined;
            if (
              partID &&
              currentPartID !== undefined &&
              partID !== currentPartID
            ) {
              const now = Date.now();
              // partID 切換時若離上次 query 太近則跳過，
              // 因 session.idle 最終會補拉，不會漏 tool。
              if (now - lastPartIDQueryAt >= PART_ID_QUERY_THROTTLE_MS) {
                lastPartIDQueryAt = now;
                yield* yieldPendingToolParts(
                  client,
                  sessionId,
                  workspacePath,
                  currentMessageIds,
                  yieldedToolCallIDs,
                );
              }
            }
            if (partID) currentPartID = partID;

            const field = props.field as string | undefined;
            const delta = props.delta;
            if (typeof delta !== "string" || delta.length === 0) continue;

            if (field === "text") {
              yield { type: "text", content: delta };
              continue;
            }

            if (field === "reasoning") {
              yield { type: "thinking", content: delta };
              continue;
            }

            continue;
          }

          // ── session.next.* 事件（SDK 規格、未來 binary 升級後可採用） ─────
          // 目前 opencode 1.14 binary 不會發送這組事件，但保留 handler 以兼容
          // 未來版本；若未來 binary 直接 streaming 推送工具事件，這條路徑可即時
          // yield 而不必走 message.part.delta 的 partID 補拉。yieldedToolCallIDs
          // 跨兩條路徑共享，避免重複 yield 同一個 tool。

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
            const callID = props.callID as string | undefined;
            const toolName = props.tool as string | undefined;
            const input = (props.input as Record<string, unknown>) ?? {};

            if (callID && toolName) {
              pendingToolCalls.set(callID, { toolName, input });
              yieldedToolCallIDs.add(callID);
              yield {
                type: "tool_call_start",
                toolUseId: callID,
                toolName,
                input,
              };
            }
            continue;
          }

          if (type === "session.next.tool.success") {
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

            if (callID) {
              const pending = pendingToolCalls.get(callID);
              const toolName = pending?.toolName ?? "";
              pendingToolCalls.delete(callID);

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

              yield {
                type: "tool_call_result",
                toolUseId: callID,
                toolName,
                output,
              };
            }
            continue;
          }

          if (type === "session.next.tool.failed") {
            const callID = props.callID as string | undefined;
            const error = props.error;

            if (callID) {
              const pending = pendingToolCalls.get(callID);
              const toolName = pending?.toolName ?? "";
              pendingToolCalls.delete(callID);

              yield {
                type: "tool_call_result",
                toolUseId: callID,
                toolName,
                output: serializeV2ToolFailureError(error),
              };
            }
            continue;
          }

          // session.next.step.failed → 步驟失敗（模型層錯誤，非工具錯誤）
          // 與 session.error 不同：step.failed 是單一 step 的錯誤，session 可能繼續
          if (type === "session.next.step.failed") {
            const stepError = props.error as
              | { type?: string; message?: string }
              | undefined;
            const rawMessage = stepError?.message ?? "未知錯誤";
            yield classifySessionError(rawMessage, options.providerID);
            break;
          }

          // session.idle → turn 結束。先補拉最後一段 tool（最後一輪 tool 之後
          // 沒有再跟著 text 的情境，沒有後續 partID 切換可觸發），再 yield turn_complete。
          if (type === "session.idle") {
            yield* yieldPendingToolParts(
              client,
              sessionId,
              workspacePath,
              currentMessageIds,
              yieldedToolCallIDs,
            );
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

          // 其他事件忽略（session.status / session.diff / message.part.updated /
          // session.next.* 等本 binary 不用或未發送的事件）。
        }
      } finally {
        abortSignal.removeEventListener("abort", doAbort);
      }
    } finally {
      // 所有路徑（session 建立失敗、abort、正常結束）都在此統一 close transient server。
      // managed MCP 子程序由 opencode 的 transient server 自身管，transient 關閉時自然回收。
      closeTransientServer();
    }
  },
};
