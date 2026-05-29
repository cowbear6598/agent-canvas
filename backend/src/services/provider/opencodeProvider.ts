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

import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";
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
import type { PodMcpEntry } from "../mcp/managedMcpSurfaceService.js";
import { getOpencodeServerState } from "./opencodeServer.js";
import { buildOpencodeSystemError } from "./opencodeErrorClassifier.js";
import {
  buildOpencodeTransientServerConfig,
  buildServerCacheKey,
} from "./opencodeMcpConfigBuilder.js";
import type {
  OpencodeClientPort,
  OpencodeMessageItem,
} from "./opencodeClientPort.js";
import { createOpencodeSessionLifecycleAdapter } from "./opencodeSessionLifecycleAdapter.js";
import { normalizeOpencodeStream } from "./opencodeStreamNormalizer.js";
import {
  buildOpencodeOptions,
  buildOpencodePromptInput,
  type OpencodeOptions,
} from "./opencodeOptionsBuilder.js";

// 重新匯出測試與其他模組依賴的公開 API（拆檔後保持原本 import path 可用）
export {
  serializeV2ToolSuccessContent,
  serializeV2ToolFailureError,
} from "./opencodeToolSerializer.js";
export type {
  OpencodeClientPort,
  OpencodeMessageItem,
  OpencodeV2PromptInput,
} from "./opencodeClientPort.js";
export type { OpencodeOptions } from "./opencodeOptionsBuilder.js";

// ================================================================
// Port interfaces（供測試注入 mock）
// ================================================================

/**
 * opencode server state 查詢介面（供測試可以 mock）
 */
export interface OpencodeServerStatePort {
  getState(): { baseUrl: string | null; status: string };
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
      async prompt(parameters): Promise<{ data?: unknown; error?: unknown }> {
        const { sessionID, directory, model, tools, system, variant, parts } =
          parameters;
        return v2.session.prompt({
          sessionID,
          directory,
          model,
          tools,
          system,
          variant,
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

function createAbortRace(abortSignal: AbortSignal): {
  promise: Promise<{ kind: "aborted" }>;
  dispose(): void;
} {
  if (abortSignal.aborted) {
    return {
      promise: Promise.resolve({ kind: "aborted" }),
      dispose: () => undefined,
    };
  }

  const handleAbort = (): void => undefined;
  let listener = handleAbort;

  return {
    promise: new Promise<{ kind: "aborted" }>((resolve) => {
      listener = (): void => {
        abortSignal.removeEventListener("abort", listener);
        resolve({ kind: "aborted" });
      };
      abortSignal.addEventListener("abort", listener, { once: true });
    }),
    dispose: () => abortSignal.removeEventListener("abort", listener),
  };
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
const OPENCODE_TRANSIENT_SERVER_TIMEOUT_MS = 30_000;

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
    timeout: OPENCODE_TRANSIENT_SERVER_TIMEOUT_MS,
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
    return buildOpencodeOptions(pod, runContext);
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
        recovery: "unrecoverable",
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
              timeout: OPENCODE_TRANSIENT_SERVER_TIMEOUT_MS,
              config: buildOpencodeTransientServerConfig(mcpEntries),
            });
            baseUrl = transientServer.url;
          }
        } catch (err) {
          logger.error(
            "Chat",
            "Error",
            `[OpencodeProvider] transient server 啟動失敗：${err instanceof Error ? err.message : String(err)}`,
          );
          yield buildOpencodeSystemError({
            content: "opencode server 連線失敗，請重啟後端",
            fatal: true,
            code: "opencode_server_unreachable",
            recovery: "unrecoverable",
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
            recovery: "unrecoverable",
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
          recovery: "unrecoverable",
        });
        return;
      }

      const client = _createClient({ baseUrl });
      const sessionLifecycle = createOpencodeSessionLifecycleAdapter({
        client,
        workspacePath,
        providerID: options.providerID,
      });

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
      let alreadyYieldedSessionStarted = false;
      const sessionStart =
        await sessionLifecycle.createOrResume(resumeSessionId);
      if (!sessionStart.ok) {
        yield sessionStart.event;
        return;
      }
      const { sessionId } = sessionStart;
      if (sessionStart.sessionStartedEvent) {
        yield sessionStart.sessionStartedEvent;
        alreadyYieldedSessionStarted = true;
      }

      // ── abort 處理 ──────────────────────────────────────────────────
      const doAbort = (): void => {
        // abort 觸發時同時關閉 transient server，避免 abort 後 server 還留著
        closeTransientServer();
        sessionLifecycle.abort(sessionId);
      };

      abortSignal.addEventListener("abort", doAbort, { once: true });

      // 已 abort：立刻呼叫 abort
      if (abortSignal.aborted) {
        doAbort();
      }

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
          logger.error(
            "Chat",
            "Error",
            `[OpencodeProvider] event.subscribe 失敗：${err instanceof Error ? err.message : String(err)}`,
          );
          yield buildOpencodeSystemError({
            content: "opencode 事件串流建立失敗，請稍後再試",
            fatal: true,
            code: "opencode_event_subscribe_failed",
            recovery: "unrecoverable",
          });
          return;
        }

        // ── 送出 prompt（非同步，不等待回傳） ──────────────────────────
        // v2 SDK: session.prompt 使用平鋪參數形狀（sessionID + 各欄位）。
        // Goal Runtime bootstrap prompt 只在新 session（非 resume）第一輪注入，
        // resume session 時 resumeSessionId 為 truthy，buildOpencodePromptText 不會注入。
        const promptParams = buildOpencodePromptInput({
          message,
          providerOptions: options,
          resumeSessionId,
        });

        const promptFailureRace = sessionLifecycle.watchPromptFailure(
          sessionLifecycle.prompt(sessionId, promptParams),
          abortSignal,
        );
        const abortRace = createAbortRace(abortSignal);
        yield* normalizeOpencodeStream({
          stream: sseResult.stream,
          sessionId,
          providerID: options.providerID,
          alreadyYieldedSessionStarted,
          promptFailureRace,
          abortRace,
          messages: (limit) => sessionLifecycle.messages(sessionId, limit),
        });
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
