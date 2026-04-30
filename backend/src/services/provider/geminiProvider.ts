/**
 * GeminiProvider
 *
 * 透過 `gemini` subprocess 執行 Google Gemini CLI，
 * 將其 stream-json 輸出轉換為 NormalizedEvent 串流。
 *
 * 實作 AgentProvider 介面，支援基本聊天（chat=true）。
 * 使用 OAuth flow 登入，不透過 API key 環境變數。
 *
 * CLI 指令組合：
 *   - 新對話：`gemini --model <model> --output-format stream-json --approval-mode yolo --skip-trust --prompt <text>`
 *   - 恢復對話：`gemini --model <model> --output-format stream-json --approval-mode yolo --skip-trust --resume <sessionId> --prompt <text>`
 *   - prompt 直接透過 --prompt flag 傳入（不用 stdin）
 *
 * Session 策略：
 *   - CLI 不支援預先指定 session ID（--session-id 不存在）
 *   - 恢復對話用 --resume <sessionId>（init event 取得的 UUID），比 latest 穩定不受其他 session 影響
 *   - Pod.sessionId 作為「曾建立過 session」的 marker，值來自 init event 的 session_id
 *   - 後續呼叫以 Pod.sessionId（UUID）直接傳入 --resume，多 Pod 共用 cwd 不互踩
 */

import {
  GEMINI_AVAILABLE_MODELS,
  GEMINI_AVAILABLE_MODEL_VALUES,
  GEMINI_CAPABILITIES,
} from "./capabilities.js";
import { normalize } from "./geminiNormalizer.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import { buildGeminiEnv, collectStderr } from "../gemini/geminiHelpers.js";
import { isEnoentError } from "./utils.js";
import { scanInstalledPlugins } from "../pluginScanner.js";

// ─── 共用 TextDecoder 實例（效能優化）────────────────────────────────────────
/**
 * 模組層級共用 TextDecoder，避免在每個 stdout chunk 中反覆建立實例。
 * stream: true 模式可正確處理 multi-byte 字元（如 UTF-8）在 chunk 邊界被拆斷的情況。
 */
const TEXT_DECODER = new TextDecoder("utf-8");

/**
 * Gemini provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface GeminiOptions {
  /** 使用的模型名稱 */
  model: string;
  /** resume 模式固定為 "cli"（Gemini 透過 --resume sessionId 恢復對話） */
  resumeMode: "cli";
  /** 已啟用且通過白名單後的 extension name 陣列 */
  plugins: string[];
}

/**
 * 合法 model 名稱格式（防止 CLI 旗標注入）。
 * 只允許英數字、點、底線、連字號，不允許空格或 -- 前綴等旗標字元。
 */
const MODEL_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * 合法 session ID 格式（嚴格 UUID v4，防止 CLI 旗標注入）。
 * 格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx（十六進位小寫或大寫）
 */
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── stderr 敏感資料遮蔽 ─────────────────────────────────────────────────────

/**
 * 在記錄 stderr 前先遮蔽敏感關鍵字，並截斷超長內容。
 *
 * - 對含敏感關鍵字的行整行替換為 `[REDACTED]`（case-insensitive）
 * - 超過 4096 chars 截斷並追加 `...[truncated]`
 *
 * @param text 原始 stderr 文字
 * @returns 遮蔽與截斷後的安全文字
 */
export function redactStderr(text: string): string {
  // 敏感關鍵字正則（case-insensitive）
  const SENSITIVE_RE =
    /token|api[_-]?key|apikey|secret|password|bearer|authorization|credential/i;

  // 按行遮蔽敏感內容
  const redacted = text
    .split("\n")
    .map((line) => (SENSITIVE_RE.test(line) ? "[REDACTED]" : line))
    .join("\n");

  // 超過 4096 chars 截斷
  const MAX_STDERR_LOG_CHARS = 4096;
  if (redacted.length > MAX_STDERR_LOG_CHARS) {
    return redacted.slice(0, MAX_STDERR_LOG_CHARS) + "...[truncated]";
  }

  return redacted;
}

/** process.env 在 process 生命週期內不會改變，模組載入時快取一次 */
// 白名單環境變數，已排除 process.env 中其他敏感資料
const GEMINI_ENV = buildGeminiEnv();

/**
 * 將 ContentBlock[] 轉換為 gemini 可接受的純文字 prompt。
 * Gemini stream-json 不接受 inline image base64，因此 image block 直接略過並 logger.warn。
 */
function normalizeMessageToPromptText(
  message: string | import("../../types/message.js").ContentBlock[],
): string {
  if (typeof message === "string") return message;

  const parts: string[] = [];

  for (const block of message) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      // Gemini stream-json 不接受 inline image base64，略過並警告
      logger.warn(
        "Chat",
        "Warn",
        "[GeminiProvider] Gemini 不支援 inline image base64，已略過圖片附件",
      );
    }
  }

  return parts.join("\n");
}

/**
 * 將 plugins 陣列轉換為 `-e` flag 參數。
 * - 空陣列 → `["-e", "none"]`（停用所有 extension）
 * - 非空陣列 → 每個 name 展開為 `["-e", name]`
 */
function buildExtensionArgs(plugins: string[]): string[] {
  if (plugins.length === 0) return ["-e", "none"];
  return plugins.flatMap((name) => ["-e", name]);
}

// 安全警示：promptText 為未消毒的使用者輸入，必須保持陣列傳參給 Bun.spawn，禁止改為字串拼接（防止 CLI 旗標注入）
/**
 * 組合新對話的 CLI 參數。
 * prompt 直接透過 --prompt flag 傳入，不用 stdin。
 */
function buildNewSessionArgs(
  model: string,
  promptText: string,
  plugins: string[],
): string[] {
  return [
    "--model",
    model,
    "--output-format",
    "stream-json",
    // yolo 模式自動核准所有工具操作；安全防線由 macOS Seatbelt sandbox（-s flag）提供
    "--approval-mode",
    "yolo",
    "--skip-trust",
    "-s",
    ...buildExtensionArgs(plugins),
    "--prompt",
    promptText,
  ];
}

// 安全警示：promptText 為未消毒的使用者輸入，必須保持陣列傳參給 Bun.spawn，禁止改為字串拼接（防止 CLI 旗標注入）
/**
 * 組合恢復對話的 CLI 參數。
 * 使用 --resume <sessionId>（init event 取得的 UUID），比 latest 更穩定，多 Pod 不互踩。
 * prompt 直接透過 --prompt flag 傳入，不用 stdin。
 *
 * @param model 模型名稱（已通過 MODEL_RE 驗證）
 * @param sessionId 欲恢復的 session UUID（已通過 SESSION_ID_RE 驗證）
 * @param promptText prompt 文字（直接放入 --prompt flag）
 */
function buildResumeArgs(
  model: string,
  sessionId: string,
  promptText: string,
  plugins: string[],
): string[] {
  return [
    "--model",
    model,
    "--output-format",
    "stream-json",
    // yolo 模式自動核准所有工具操作；安全防線由 macOS Seatbelt sandbox（-s flag）提供
    "--approval-mode",
    "yolo",
    "--skip-trust",
    "-s",
    ...buildExtensionArgs(plugins),
    "--resume",
    sessionId,
    "--prompt",
    promptText,
  ];
}

/**
 * 組合 Gemini CLI 參數。
 * 根據 resumeSessionId 是否存在及格式決定走新對話或 resume。
 *
 * - resumeSessionId 為 truthy 且通過 SESSION_ID_RE → buildResumeArgs（--resume <sessionId>）
 * - resumeSessionId 為 truthy 但格式不合法 → logger.warn 後 fallback 走新對話（防止 CLI 旗標注入）
 * - resumeSessionId 為 null / 空字串 → buildNewSessionArgs
 *
 * @param resumeSessionId Pod.sessionId 的現有值（init event 取得的 UUID）；null 表示首次對話
 * @param model 模型名稱（已通過 MODEL_RE 驗證）
 * @param promptText prompt 文字（直接放入 --prompt flag）
 * @returns CLI 參數陣列（不含 "gemini" 本身）
 */
function buildGeminiArgs(
  resumeSessionId: string | null,
  model: string,
  promptText: string,
  plugins: string[],
): string[] {
  if (resumeSessionId) {
    if (SESSION_ID_RE.test(resumeSessionId)) {
      return buildResumeArgs(model, resumeSessionId, promptText, plugins);
    }

    // resumeSessionId 格式不合法：整段替換為固定遮罩，不保留任何原字元，防止 CLI 旗標注入與值洩漏
    logger.warn(
      "Chat",
      "Warn",
      "[GeminiProvider] resumeSessionId 格式不合法，fallback 走新對話（sessionId: [INVALID_SESSION_ID_MASKED]）",
    );
  }

  return buildNewSessionArgs(model, promptText, plugins);
}

/**
 * 啟動 gemini subprocess。
 * 不在此處做 ENOENT 包裝——改由 setupSubprocess 使用 isEnoentError 統一處理。
 *
 * @param args CLI 參數（不含 "gemini"）
 * @param cwd 工作目錄路徑
 * @returns Bun.Subprocess
 */
function spawnGeminiProcess(
  args: string[],
  cwd: string,
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn(["gemini", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: GEMINI_ENV,
  });
}

/** exit code 分類結果 */
type ExitCodeCategory = "ok" | "login_required" | "generic_error";

// ─── Google OAuth 認證相關 exit code 常數 ─────────────────────────────────────

/**
 * gemini CLI 以這些 exit code 表示「尚未完成 Google oauth 登入」。
 * - 41：oauth 認證未建立（未登入）
 * - 52：oauth 設定失敗（config 損毀或憑證過期）
 */
const OAUTH_LOGIN_REQUIRED_EXIT_CODES = new Set([41, 52]);

/**
 * 提示使用者完成 Google oauth 登入的錯誤訊息。
 * 抽成常數方便 grep oauth 直接定位，也確保 test 驗證的文字唯一來源。
 */
const OAUTH_LOGIN_REQUIRED_MESSAGE =
  "Gemini 尚未登入，請在終端執行 `gemini` 完成 Google OAuth 登入";

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 將 exit code 分類為語意類別（純函式，無副作用）。
 *
 * - 0 → "ok"
 * - OAUTH_LOGIN_REQUIRED_EXIT_CODES（41 或 52）→ "login_required"（需 Google OAuth 登入）
 * - 其他非零 → "generic_error"
 */
function classifyExitCode(exitCode: number): ExitCodeCategory {
  if (exitCode === 0) return "ok";
  if (OAUTH_LOGIN_REQUIRED_EXIT_CODES.has(exitCode)) return "login_required";
  return "generic_error";
}

/**
 * 將 exit code 相關 log 細節集中在此函式輸出。
 * hasTurnComplete=true 時用 warn；hasTurnComplete=false 時用 error。
 */
function logExitCodeDetails(
  exitCode: number,
  hasTurnComplete: boolean,
  stderrText: string,
  podId: string,
): void {
  if (hasTurnComplete) {
    // 已完成一個 turn 但以非零 exit code 結束：記錄 warn（保留正常輸出）
    logger.warn(
      "Chat",
      "Warn",
      `[GeminiProvider] gemini 已完成一個 turn 但以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}），可能為正常退出行為`,
    );
    if (stderrText) {
      logger.warn(
        "Chat",
        "Warn",
        `[GeminiProvider] stderr: ${redactStderr(stderrText)}`,
      );
    }
  } else {
    // 未完成 turn 且非零 exit code → error 寫細節
    logger.error(
      "Chat",
      "Error",
      `[GeminiProvider] gemini 子程序以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}）${stderrText ? "，stderr 詳見下行" : "，無 stderr 輸出"}`,
    );
    if (stderrText) {
      logger.error(
        "Chat",
        "Error",
        `[GeminiProvider] stderr: ${redactStderr(stderrText)}`,
      );
    }
  }
}

/**
 * 依 exit code 決定是否 yield error event 或 warn log。
 *
 * - exitCode 0 或 abortSignal.aborted → return（不做任何事）
 * - hasTurnComplete=true 且 exitCode 非 0 → logger.warn（含 podId、exitCode、stderr），不 yield
 * - hasTurnComplete=false 且 exitCode 非 0：
 *   - exitCode 為 41 或 52 → yield 登入提示 error，fatal=false
 *   - 其他 exit code → yield 通用 error，fatal=false
 *   - 不論哪種都先 logger.error 寫入 podId、exitCode、stderr 細節
 */
async function* handleExitCode(
  exitCode: number,
  abortSignal: AbortSignal,
  hasTurnComplete: boolean,
  stderrText: string,
  podId: string,
): AsyncGenerator<NormalizedEvent> {
  const category = classifyExitCode(exitCode);
  if (category === "ok" || abortSignal.aborted) return;

  // log 細節集中在 logExitCodeDetails
  logExitCodeDetails(exitCode, hasTurnComplete, stderrText, podId);

  if (hasTurnComplete) return;

  if (category === "login_required") {
    yield {
      type: "error",
      message: OAUTH_LOGIN_REQUIRED_MESSAGE,
      fatal: false,
    };
  } else {
    yield {
      type: "error",
      message: "執行發生錯誤，請查閱伺服器日誌",
      fatal: false,
    };
  }
}

/**
 * 逐行解析 stdout ReadableStream，yield 解析成功的 NormalizedEvent。
 * 透過 out 參數回傳 hasTurnComplete（generator 無法直接回傳值給 yield* 呼叫端）。
 */
async function* processStdoutLines(
  stdout: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
  out: { hasTurnComplete: boolean },
): AsyncGenerator<NormalizedEvent> {
  let buffer = "";

  for await (const chunk of stdout) {
    if (abortSignal.aborted) break;

    buffer += TEXT_DECODER.decode(chunk, { stream: true });

    const lines = buffer.split("\n");
    // 最後一段可能不完整，保留在 buffer
    // split("\n") 至少回傳一個元素，pop() 永遠不會是 undefined
    buffer = lines.pop()!;

    for (const line of lines) {
      const event = normalize(line);
      if (event !== null) {
        if (event.type === "turn_complete") {
          out.hasTurnComplete = true;
        }
        yield event;
      }
    }
  }

  // 處理 stdout 結束時剩餘的 buffer 內容
  if (buffer.trim()) {
    const event = normalize(buffer);
    if (event !== null) {
      if (event.type === "turn_complete") {
        out.hasTurnComplete = true;
      }
      yield event;
    }
  }
}

/**
 * 逐行讀取 gemini subprocess 的 stdout，yield NormalizedEvent；
 * 並行啟動 stderr 收集（避免 stderr buffer 滿導致 subprocess 卡住），
 * 結束後依 exit code 決定是否 yield error event。
 *
 * prompt 已透過 --prompt flag 寫入 argv，不需要 stdin 互動。
 *
 * @param proc Bun.Subprocess
 * @param abortSignal abort 控制
 * @param podId 僅用於 log 顯示
 */
async function* streamGeminiOutput(
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  abortSignal: AbortSignal,
  podId: string,
): AsyncGenerator<NormalizedEvent> {
  // ── 並行啟動 stderr 收集（在 stdout 之前啟動避免 buffer 滿卡住） ──
  const stderrPromise = collectStderr(proc, abortSignal, "[GeminiProvider]");

  // ── 逐行讀取 stdout ─────────────────────────────────────────────
  const turnState = { hasTurnComplete: false };
  yield* processStdoutLines(
    proc.stdout as ReadableStream<Uint8Array>,
    abortSignal,
    turnState,
  );

  // ── 等待 stderr 收集完成 ────────────────────────────────────────
  const stderrText = await stderrPromise;

  // ── exit code 檢查 ──────────────────────────────────────────────
  const exitCode = await proc.exited;

  yield* handleExitCode(
    exitCode,
    abortSignal,
    turnState.hasTurnComplete,
    stderrText,
    podId,
  );
}

/** setupSubprocess 成功結果 */
type SubprocessSuccess = {
  ok: true;
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  /** 必須在 try-finally 中呼叫，確保 abort listener 被移除 */
  cleanup: () => void;
};

/** setupSubprocess 失敗結果，含使用者可見的 error event */
type SubprocessFailure = {
  ok: false;
  errorEvent: NormalizedEvent & { type: "error" };
};

/**
 * 為已 spawn 的 subprocess 設置 abort signal 處理。
 * 負責監聽 abort 事件並在觸發時呼叫 proc.kill()。
 * 回傳 cleanup 函式（移除 listener），由呼叫端在 try-finally 中呼叫。
 *
 * @param proc 已啟動的 subprocess
 * @param abortSignal abort 控制信號
 * @returns cleanup 函式，必須在 try-finally 中呼叫以移除 listener
 */
function attachAbortHandler(
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  abortSignal: AbortSignal,
): () => void {
  const onAbort = (): void => {
    try {
      proc.kill();
    } catch (err: unknown) {
      // ESRCH：subprocess 已結束，屬正常情況直接忽略
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ESRCH"
      ) {
        return;
      }
      logger.warn(
        "Chat",
        "Warn",
        `[GeminiProvider] kill subprocess 時發生非預期錯誤：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  abortSignal.addEventListener("abort", onAbort, { once: true });

  // spawn 前已 abort：listener 不會自動觸發，需主動呼叫 onAbort
  if (abortSignal.aborted) {
    onAbort();
  }

  return (): void => {
    abortSignal.removeEventListener("abort", onAbort);
  };
}

/**
 * Spawn gemini subprocess 並設置 abort signal 處理。
 * 以 discriminated union 回傳結果，讓 chat() 以單一 if 分支處理失敗，不混 try-catch。
 * 成功時回傳 { ok: true, proc, cleanup }；失敗時回傳 { ok: false, errorEvent }。
 */
function setupSubprocess(
  args: string[],
  cwd: string,
  abortSignal: AbortSignal,
): SubprocessSuccess | SubprocessFailure {
  // ── Spawn subprocess ───────────────────────────────────────────
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = spawnGeminiProcess(args, cwd);
  } catch (err: unknown) {
    if (isEnoentError(err)) {
      return {
        ok: false,
        errorEvent: {
          type: "error",
          message:
            "Gemini CLI 尚未安裝，請執行 `npm install -g @google/gemini-cli`",
          fatal: true,
        },
      };
    }
    // 非 ENOENT 的啟動失敗：原始訊息寫進 logger，不暴露給前端
    logger.error(
      "Chat",
      "Error",
      "[GeminiProvider] 啟動 gemini 子程序失敗",
      err,
    );
    return {
      ok: false,
      errorEvent: {
        type: "error",
        message: "啟動 gemini 子程序失敗，請查 server log",
        fatal: true,
      },
    };
  }

  // ── abort signal 處理（委由 attachAbortHandler 統一管理）────────
  const cleanup = attachAbortHandler(proc, abortSignal);

  return { ok: true, proc, cleanup };
}

/**
 * 驗證 model 名稱格式（純函式）。
 * 回傳 true 表示合法；回傳 false 表示不合法，由呼叫端負責 yield error。
 */
function validateModel(model: string): boolean {
  return MODEL_RE.test(model);
}

// ─── Provider 預設選項常數 ────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-2.5-pro";

const DEFAULT_OPTIONS: GeminiOptions = {
  model: DEFAULT_MODEL,
  resumeMode: "cli",
  plugins: [],
};

// ─── Provider 匯出 ────────────────────────────────────────────────────────────

/**
 * Gemini Provider singleton。
 * 使用物件字面量形式（對標 codexProvider 結構，不引入 class 新 pattern）。
 */
export const geminiProvider: AgentProvider<GeminiOptions> = {
  metadata: {
    name: "gemini",
    capabilities: GEMINI_CAPABILITIES,
    defaultOptions: DEFAULT_OPTIONS,
    availableModels: GEMINI_AVAILABLE_MODELS,
    availableModelValues: GEMINI_AVAILABLE_MODEL_VALUES,
  },

  /**
   * 從 Pod 設定建構 Gemini 執行時選項。
   *
   * - 讀取 `pod.providerConfig?.model`：若為合法字串（通過 MODEL_RE 驗證）則使用之，
   *   否則回傳 metadata.defaultOptions.model。
   * - resumeMode 固定為 "cli"（Gemini 透過 --resume sessionId 恢復對話）。
   * - plugins：以 pod.pluginIds 與已安裝 Gemini extension 取交集後得出，
   *   不存在或不相容的 id 自動略過（silent 過濾 + warn），不 throw。
   * - runContext 本 Phase 不使用（但簽名必須收），以符合 AgentProvider 介面規範。
   */
  async buildOptions(
    pod: Pod,
    _runContext?: RunContext,
  ): Promise<GeminiOptions> {
    const rawModel = pod.providerConfig?.model;
    const model =
      typeof rawModel === "string" && MODEL_RE.test(rawModel)
        ? rawModel
        : DEFAULT_OPTIONS.model;

    // ── plugins 計算 ──────────────────────────────────────────────
    let plugins: string[] = [];
    if (pod.pluginIds.length > 0) {
      const scan = scanInstalledPlugins("gemini");
      const installedIds = new Set(scan.map((p) => p.id));
      const requested = Array.from(new Set(pod.pluginIds));
      plugins = requested.filter((id) => installedIds.has(id));
      const skipped = requested.length - plugins.length;
      if (skipped > 0) {
        logger.warn(
          "Chat",
          "Warn",
          `[GeminiProvider] 略過 ${skipped} 個不存在或不相容的 extension id（已遮罩）`,
        );
      }
    }

    return {
      model,
      resumeMode: "cli",
      plugins,
    };
  },

  /**
   * 發起聊天，回傳標準化事件的 AsyncIterable。
   *
   * 流程：
   * 1. validateModel（model 名稱格式驗證）
   * 2. normalizeMessageToPromptText + buildGeminiArgs（組合 prompt 與 CLI 參數）
   * 3. setupSubprocess（spawn gemini + abort signal 設置）
   * 4. streamGeminiOutput（逐行讀取 stdout + stderr 收集 + exit code 處理）
   */
  async *chat(
    ctx: ChatRequestContext<GeminiOptions>,
  ): AsyncGenerator<NormalizedEvent> {
    const { podId, abortSignal, options, message, resumeSessionId } = ctx;

    // ── options 型別收窄 ──────────────────────────────────────────
    // 正常路徑下 buildOptions() 保證 options 非空；防禦性收窄讓後續可直接存取 options.*
    if (options == null) {
      yield {
        type: "error",
        message: "內部錯誤：chat options 不可為空",
        fatal: true,
      };
      return;
    }

    // ── model 驗證 ────────────────────────────────────────────────
    const model = options.model;
    if (!validateModel(model)) {
      // 原始 model 值只記錄在 logger，不反射回前端（防止外部輸入洩漏）
      logger.warn(
        "Chat",
        "Warn",
        `[GeminiProvider] model 驗證失敗，不合法的 model 名稱：${model}`,
      );
      yield {
        type: "error",
        message: "不合法的 model 名稱",
        fatal: true,
      };
      return;
    }

    // ── 組合 prompt 與 CLI 參數 ───────────────────────────────────
    const promptText = normalizeMessageToPromptText(message);
    // 防止 image-only 輸入產生空字串靜默流入 CLI
    if (promptText === "") {
      yield {
        type: "error",
        message: "訊息內容不可為空（Gemini 不支援純圖片訊息）",
        fatal: true,
      };
      return;
    }
    const plugins = options.plugins;
    const geminiArgs = buildGeminiArgs(
      resumeSessionId,
      model,
      promptText,
      plugins,
    );

    // ── Spawn subprocess + abort signal 設置 ──────────────────────
    // workspacePath 由上層 executor 透過 resolvePodCwd 解析後傳入
    const subprocessResult = setupSubprocess(
      geminiArgs,
      ctx.workspacePath,
      abortSignal,
    );
    if (!subprocessResult.ok) {
      yield subprocessResult.errorEvent;
      return;
    }

    const { proc, cleanup } = subprocessResult;
    if (abortSignal.aborted) {
      cleanup();
      return;
    }

    // ── 串流輸出 ───────────────────────────────────────────────────
    try {
      yield* streamGeminiOutput(proc, abortSignal, podId);
    } finally {
      cleanup();
    }
  },
};
