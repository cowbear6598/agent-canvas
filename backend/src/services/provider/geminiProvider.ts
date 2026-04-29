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

/**
 * Gemini provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface GeminiOptions {
  /** 使用的模型名稱 */
  model: string;
  /** resume 模式固定為 "cli"（Gemini 透過 --resume sessionId 恢復對話） */
  resumeMode: "cli";
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

/** process.env 在 process 生命週期內不會改變，模組載入時快取一次 */
const GEMINI_ENV = buildGeminiEnv();

/**
 * 將 ContentBlock[] 轉換為 gemini 可接受的純文字 prompt。
 * Gemini stream-json 不接受 inline image base64，因此 image block 直接略過並 logger.warn。
 */
function buildPromptText(
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
 * 組合新對話的 CLI 參數。
 * prompt 直接透過 --prompt flag 傳入，不用 stdin。
 */
function buildNewSessionArgs(model: string, promptText: string): string[] {
  return [
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--skip-trust",
    "--prompt",
    promptText,
  ];
}

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
): string[] {
  return [
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--skip-trust",
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
): string[] {
  if (resumeSessionId) {
    if (SESSION_ID_RE.test(resumeSessionId)) {
      return buildResumeArgs(model, resumeSessionId, promptText);
    }

    // resumeSessionId 格式不合法：記錄警告並 fallback 走新對話，防止 CLI 旗標注入
    logger.warn(
      "Chat",
      "Warn",
      `[GeminiProvider] resumeSessionId 格式不合法，fallback 走新對話（sessionId: ${resumeSessionId}）`,
    );
  }

  return buildNewSessionArgs(model, promptText);
}

/**
 * 判斷 err 是否為 ENOENT（gemini CLI 尚未安裝或不在 PATH 中）。
 * 供 spawnGeminiProcess catch 與 chat() catch 共用，消除重複的 duck-typing 程式碼。
 */
function isEnoentError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ("code" in err
      ? (err as NodeJS.ErrnoException).code === "ENOENT"
      : err.message.includes("ENOENT"))
  );
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
    // prompt 已透過 --prompt flag 傳入 argv，stdin 不需要
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: GEMINI_ENV,
  });
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
  if (exitCode === 0 || abortSignal.aborted) return;

  if (hasTurnComplete) {
    // 已完成一個 turn 但以非零 exit code 結束：記錄 warn 但不 yield error（保留正常輸出）
    logger.warn(
      "Chat",
      "Warn",
      `[GeminiProvider] gemini 已完成一個 turn 但以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}），可能為正常退出行為`,
    );
    if (stderrText) {
      logger.warn("Chat", "Warn", `[GeminiProvider] stderr: ${stderrText}`);
    }
    return;
  }

  // 未完成 turn 且非零 exit code → logger.error 寫細節，再 yield 使用者友善訊息
  logger.error(
    "Chat",
    "Error",
    `[GeminiProvider] gemini 子程序以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}）${stderrText ? "，stderr 詳見下行" : "，無 stderr 輸出"}`,
  );
  if (stderrText) {
    logger.error("Chat", "Error", `[GeminiProvider] stderr: ${stderrText}`);
  }

  if (exitCode === 41 || exitCode === 52) {
    yield {
      type: "error",
      message: "Gemini 尚未登入，請在終端執行 `gemini` 完成 Google OAuth 登入",
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

    buffer += Buffer.from(chunk as Uint8Array).toString("utf-8");

    const lines = buffer.split("\n");
    // 最後一段可能不完整，保留在 buffer
    buffer = lines.pop() ?? "";

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

  // ── abort signal 處理 ──────────────────────────────────────────
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
      logger.error(
        "Chat",
        "Warn",
        "[GeminiProvider] kill subprocess 時發生非預期錯誤",
        err,
      );
    }
  };

  abortSignal.addEventListener("abort", onAbort, { once: true });

  // spawn 前已 abort：listener 不會自動觸發，需主動呼叫 onAbort
  if (abortSignal.aborted) {
    onAbort();
  }

  const cleanup = (): void => {
    abortSignal.removeEventListener("abort", onAbort);
  };

  return { ok: true, proc, cleanup };
}

/**
 * 準備執行所需的 CLI 參數與 prompt 文字（純函式）。
 * 驗證 model 格式，若不合法回傳 null（由 chat() 負責 yield error）。
 */
function prepareExecution(
  ctx: ChatRequestContext<GeminiOptions>,
  defaultModel: string,
): { geminiArgs: string[]; promptText: string } | null {
  const { message, resumeSessionId, options } = ctx;
  const model = options?.model ?? defaultModel;

  if (!MODEL_RE.test(model)) {
    return null;
  }

  const promptText = buildPromptText(message);
  const geminiArgs = buildGeminiArgs(resumeSessionId, model, promptText);

  return { geminiArgs, promptText };
}

// ─── Provider 預設選項常數 ────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-2.5-pro";

const DEFAULT_OPTIONS: GeminiOptions = {
  model: DEFAULT_MODEL,
  resumeMode: "cli",
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

    return {
      model,
      resumeMode: "cli",
    };
  },

  /**
   * 發起聊天，回傳標準化事件的 AsyncIterable。
   *
   * 流程：
   * 1. prepareExecution（model 驗證 + CLI 參數 + prompt 轉換）
   * 2. setupSubprocess（spawn gemini + abort signal 設置）
   * 3. streamGeminiOutput（逐行讀取 stdout + stderr 收集 + exit code 處理）
   */
  async *chat(
    ctx: ChatRequestContext<GeminiOptions>,
  ): AsyncGenerator<NormalizedEvent> {
    const { podId, abortSignal, options } = ctx;

    // ── 準備執行（model 驗證 + CLI 參數 + prompt 轉換） ─────────────
    const execution = prepareExecution(ctx, DEFAULT_OPTIONS.model);
    if (execution === null) {
      const model = options?.model ?? DEFAULT_OPTIONS.model;
      yield {
        type: "error",
        message: `不合法的 model 名稱：${model}`,
        fatal: true,
      };
      return;
    }

    const { geminiArgs } = execution;

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
