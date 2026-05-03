/**
 * CodexService
 *
 * 提供一次性無狀態的 Codex 查詢能力，適用於 summary 等非 Pod 場景。
 * 不會建立 session、不會寫入 podStore。
 */

import path from "path";
import { normalize } from "../provider/codexNormalizer.js";
import { logger } from "../../utils/logger.js";
import type {
  DisposableChatOptions,
  DisposableChatResult,
} from "../shared/disposableChatTypes.js";
import { buildCodexEnv, collectStderr } from "./codexHelpers.js";

export type {
  DisposableChatOptions,
  DisposableChatResult,
} from "../shared/disposableChatTypes.js";

// ─── 並行限制器（Semaphore）─────────────────────────────────────────────────────

/**
 * 同時存在的 codex 子程序上限。
 * 可透過環境變數 CODEX_DISPOSABLE_CHAT_CONCURRENCY 覆寫（須為正整數），預設為 3。
 * fan-out 拓撲下多條 connection 並發時，防止大量 spawn 造成 OOM 或資源耗盡。
 */
const MAX_CONCURRENT_CODEX = ((): number => {
  const raw = process.env.CODEX_DISPOSABLE_CHAT_CONCURRENCY;
  if (!raw) return 3;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
})();

/** 目前正在執行中的 codex 子程序數量 */
let activeCodexCount = 0;

/** 等待取得 slot 的 resolver 佇列 */
const codexSemaphoreQueue: Array<() => void> = [];

/**
 * 取得一個並行 slot（若已達上限則等待）。
 * 呼叫方在 spawn 前 await acquireCodexSlot()，
 * 完成（或失敗）後呼叫 releaseCodexSlot() 釋放。
 */
function acquireCodexSlot(): Promise<void> {
  if (activeCodexCount < MAX_CONCURRENT_CODEX) {
    activeCodexCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    codexSemaphoreQueue.push(resolve);
  });
}

/**
 * 釋放一個並行 slot，並喚醒佇列中等待最久的請求。
 */
function releaseCodexSlot(): void {
  const next = codexSemaphoreQueue.shift();
  if (next) {
    // 直接喚醒下一個等待者，activeCodexCount 維持不變（讓下一個接手）
    next();
  } else {
    activeCodexCount--;
  }
}

// ─── 常數 ────────────────────────────────────────────────────────────────────

/**
 * Timeout abort 識別用 Symbol。
 * 用 Symbol 而非字串比對，確保訊息變動不影響邏輯。
 */
const CODEX_TIMEOUT_REASON = Symbol("codex-timeout");

/** timeout 合法範圍下限（30 秒）*/
const TIMEOUT_MIN_MS = 30 * 1000;
/** timeout 合法範圍上限（10 分鐘）*/
const TIMEOUT_MAX_MS = 10 * 60 * 1000;
/** timeout 預設值（5 分鐘）*/
const TIMEOUT_DEFAULT_MS = 5 * 60 * 1000;

/**
 * 從環境變數 CODEX_DISPOSABLE_CHAT_TIMEOUT_MS 讀取 timeout（毫秒）。
 * 超出合法範圍（30s~10min）時 fallback 到預設值。
 * 每次呼叫動態讀取，確保測試 mock 及 credential rotation 正確生效。
 */
function getDisposableChatTimeoutMs(): number {
  const raw = process.env.CODEX_DISPOSABLE_CHAT_TIMEOUT_MS;
  if (!raw) return TIMEOUT_DEFAULT_MS;

  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    parsed < TIMEOUT_MIN_MS ||
    parsed > TIMEOUT_MAX_MS
  ) {
    logger.warn(
      "Chat",
      "Warn",
      `[CodexService] CODEX_DISPOSABLE_CHAT_TIMEOUT_MS="${raw}" 超出合法範圍（${TIMEOUT_MIN_MS}–${TIMEOUT_MAX_MS}ms），使用預設值 ${TIMEOUT_DEFAULT_MS}ms`,
    );
    return TIMEOUT_DEFAULT_MS;
  }

  return parsed;
}

/**
 * 合法 model 名稱格式（防止 CLI 旗標注入）。
 */
const MODEL_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * 預設模型，與 CodexProvider.metadata.defaultOptions.model 對齊。
 */
const DEFAULT_MODEL = "gpt-5.4";

/**
 * 對 prompt 內容進行 sanitize，防止角色邊界偽造注入。
 * 將 `]\n\n[` 序列轉義為 `]\n\n\[`，避免使用者輸入被解讀為新的角色區塊。
 */
function sanitizeForCodexPrompt(text: string): string {
  // 轉義可能偽造 [System: ...] / [User: ...] 邊界的序列
  return text.replace(/\]\s*\n\s*\n\s*\[/g, "]\n\n\\[");
}

/**
 * 將 systemPrompt 與 userMessage 合併為單一 prompt 字串。
 * 格式：`[System: <systemPrompt>]\n\n[User: <userMessage>]`
 * 兩者皆先 sanitize，防止角色邊界偽造注入。
 */
function buildCombinedPrompt(
  systemPrompt: string,
  userMessage: string,
): string {
  const safeSystem = sanitizeForCodexPrompt(systemPrompt);
  const safeUser = sanitizeForCodexPrompt(userMessage);
  return `[System: ${safeSystem}]\n\n[User: ${safeUser}]`;
}

/**
 * 組合一次性查詢的 codex CLI 參數（固定為新對話模式，不支援 resume）。
 */
function buildDisposableArgs(model: string, workspacePath: string): string[] {
  return [
    "exec",
    "-",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    workspacePath,
    "--full-auto",
    "-c",
    "sandbox_workspace_write.network_access=true",
    "--model",
    model,
  ];
}

/**
 * 逐行讀取 stdout，累積 text 事件內容，遇到 turn_complete 時停止。
 * 回傳 { content, hasTurnComplete }。
 */
async function processStdoutToBuffer(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  abortSignal: AbortSignal,
): Promise<{ content: string; hasTurnComplete: boolean }> {
  let lineBuffer = "";
  let content = "";
  let hasTurnComplete = false;

  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    if (abortSignal.aborted) break;

    lineBuffer += Buffer.from(chunk as Uint8Array).toString("utf-8");

    const lines = lineBuffer.split("\n");
    // 最後一段可能不完整，保留在 buffer
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = normalize(line);
      if (event === null) continue;

      if (event.type === "text") {
        content += event.content;
      } else if (event.type === "turn_complete") {
        hasTurnComplete = true;
        // 收到 turn_complete 即可結束，不需要繼續讀取
        return { content, hasTurnComplete };
      } else if (event.type === "error") {
        // codex stream 層級的 error event，記 log 後繼續（由 exit code 決定最終結果）
        logger.warn(
          "Chat",
          "Warn",
          `[CodexService] codex stream 層級錯誤事件：${event.message}`,
        );
      }
    }
  }

  // 處理 stdout 結束時剩餘的 buffer 內容
  if (lineBuffer.trim()) {
    const event = normalize(lineBuffer);
    if (event !== null) {
      if (event.type === "text") {
        content += event.content;
      } else if (event.type === "turn_complete") {
        hasTurnComplete = true;
      }
    }
  }

  return { content, hasTurnComplete };
}

// ─── 內部 helpers（高層流程拆解）────────────────────────────────────────────────

/** abort bridge 的回傳值，供外層清理使用 */
interface AbortBridgeResult {
  internalController: AbortController;
  internalSignal: AbortSignal;
  onExternalAbort: () => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * 建立內部 AbortController，橋接外部 signal 與 timeout。
 * 回傳 internalSignal 以及清理用的 handler 與 timeoutId。
 */
function setupAbortBridge(abortSignal?: AbortSignal): AbortBridgeResult {
  const internalController = new AbortController();
  const internalSignal = internalController.signal;

  const onExternalAbort = (): void => {
    internalController.abort();
  };

  if (abortSignal) {
    abortSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    internalController.abort(CODEX_TIMEOUT_REASON);
  }, getDisposableChatTimeoutMs());

  return { internalController, internalSignal, onExternalAbort, timeoutId };
}

/**
 * 啟動 codex 子程序。
 * 失敗時回傳 DisposableChatResult 錯誤物件，成功時回傳子程序實例。
 */
function spawnCodexProcess(
  model: string,
  workspacePath: string,
): Bun.Subprocess<"pipe", "pipe", "pipe"> | DisposableChatResult {
  const codexArgs = buildDisposableArgs(model, workspacePath);
  try {
    // 每次 spawn 時動態建構 env，確保讀到當下的 process.env
    // （dotenv 延遲載入、單元測試 mock、credential rotation 皆能正確生效）
    return Bun.spawn(["codex", ...codexArgs], {
      cwd: workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: buildCodexEnv(),
    });
  } catch (err: unknown) {
    const isEnoent =
      err instanceof Error &&
      ("code" in err
        ? (err as NodeJS.ErrnoException).code === "ENOENT"
        : err.message.includes("ENOENT"));

    if (isEnoent) {
      return {
        content: "",
        success: false,
        error: "codex CLI 尚未安裝或不在 PATH 中，請執行 codex login",
      };
    }

    logger.error("Chat", "Error", "[CodexService] 啟動 codex 子程序失敗", err);
    return {
      content: "",
      success: false,
      error: "啟動 codex 子程序失敗，請查閱伺服器日誌",
    };
  }
}

/**
 * 依 exit code、hasTurnComplete 與 abort 狀態評估最終結果。
 * 回傳 DisposableChatResult 或 null（表示應繼續回傳 content）。
 */
function evaluateExitResult(
  exitCode: number,
  hasTurnComplete: boolean,
  content: string,
  stderrText: string,
  internalSignal: AbortSignal,
): DisposableChatResult {
  // abort 路徑：timeout 或外部取消
  if (internalSignal.aborted) {
    // 以 Symbol 識別是否為 timeout，避免字串比對在訊息變動時靜默失效
    const isTimeout = internalSignal.reason === CODEX_TIMEOUT_REASON;
    return {
      content: "",
      success: false,
      error: isTimeout ? "查詢逾時，已強制終止子程序" : "查詢已被取消",
    };
  }

  // 非零 exit code 且未完成 turn → 視為失敗
  if (exitCode !== 0 && !hasTurnComplete) {
    logger.error(
      "Chat",
      "Error",
      `[CodexService] codex 子程序以非零 exit code 結束（exit code: ${exitCode}）${stderrText ? "，stderr 詳見下行" : "，無 stderr 輸出"}`,
    );
    if (stderrText) {
      logger.error("Chat", "Error", `[CodexService] stderr: ${stderrText}`);
    }
    return {
      content: "",
      success: false,
      error: "執行發生錯誤，請查閱伺服器日誌",
    };
  }

  // 已完成 turn 但非零 exit code：記 warn，保留正常輸出
  if (exitCode !== 0 && hasTurnComplete) {
    logger.warn(
      "Chat",
      "Warn",
      `[CodexService] codex 已完成一個 turn 但以非零 exit code 結束（exit code: ${exitCode}），可能為正常退出行為`,
    );
  }

  return { content, success: true };
}

// ─── CodexService ─────────────────────────────────────────────────────────────

class CodexService {
  /**
   * 一次性無狀態的 Codex 查詢，適用於 summary 等非 Pod 場景。
   * 不會建立 session、不會寫入 podStore。
   *
   * @param options - 查詢選項（systemPrompt、userMessage、workspacePath、model）
   * @param abortSignal - 外部 abort 控制，取消時 kill 子程序
   * @returns Promise<DisposableChatResult>
   */
  async executeDisposableChat(
    options: DisposableChatOptions,
    abortSignal?: AbortSignal,
  ): Promise<DisposableChatResult> {
    const { systemPrompt, userMessage, workspacePath } = options;
    const model = options.model ?? DEFAULT_MODEL;

    // 驗證 workspacePath 必須為絕對路徑，防止路徑穿越攻擊
    if (!path.isAbsolute(workspacePath)) {
      return {
        content: "",
        success: false,
        error: "workspacePath 必須為絕對路徑",
      };
    }

    // 驗證 model 格式，防止 CLI 旗標注入
    if (!MODEL_RE.test(model)) {
      return {
        content: "",
        success: false,
        error: `不合法的 model 名稱：${model}`,
      };
    }

    if (abortSignal?.aborted) {
      return { content: "", success: false, error: "查詢已被取消" };
    }

    // 等待取得並行 slot，確保同時存在的 codex 子程序不超過 MAX_CONCURRENT_CODEX
    await acquireCodexSlot();

    const { internalSignal, onExternalAbort, timeoutId } =
      setupAbortBridge(abortSignal);

    let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;

    // abort signal：kill 子程序
    const onInternalAbort = (): void => {
      try {
        proc?.kill();
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code === "ESRCH"
        ) {
          // subprocess 已結束，正常情況忽略
          return;
        }
        logger.warn(
          "Chat",
          "Warn",
          `[CodexService] kill subprocess 時發生非預期錯誤：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    internalSignal.addEventListener("abort", onInternalAbort, { once: true });

    try {
      const spawnResult = spawnCodexProcess(model, workspacePath);
      // spawnCodexProcess 回傳 DisposableChatResult 表示啟動失敗
      if ("success" in spawnResult) {
        return spawnResult;
      }
      proc = spawnResult;

      // 若 spawn 前已 abort，直接 kill 並回傳
      if (internalSignal.aborted) {
        proc.kill();
        return { content: "", success: false, error: "查詢已被取消" };
      }

      const promptText = buildCombinedPrompt(systemPrompt, userMessage);
      proc.stdin.write(promptText);
      await proc.stdin.end();

      // 並行啟動 stderr 收集（在 stdout 之前啟動，避免 buffer 滿卡住）
      const stderrPromise = collectStderr(
        proc,
        internalSignal,
        "[CodexService]",
      );

      // 逐行讀取 stdout，累積 text 事件，遇到 turn_complete 停止
      const { content, hasTurnComplete } = await processStdoutToBuffer(
        proc,
        internalSignal,
      );

      const stderrText = await stderrPromise;
      const exitCode = await proc.exited;

      return evaluateExitResult(
        exitCode,
        hasTurnComplete,
        content,
        stderrText,
        internalSignal,
      );
    } finally {
      // 不論成功或失敗，皆釋放並行 slot，確保佇列中等待的請求能繼續執行
      releaseCodexSlot();
      clearTimeout(timeoutId);
      internalSignal.removeEventListener("abort", onInternalAbort);
      if (abortSignal) {
        abortSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }
}

export const codexService = new CodexService();
