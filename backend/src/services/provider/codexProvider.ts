/**
 * CodexProvider
 *
 * 透過 `codex exec` subprocess 執行 OpenAI Codex CLI，
 * 將其 JSON line 輸出轉換為 NormalizedEvent 串流。
 *
 * 實作 AgentProvider 介面，支援基本聊天（chat=true）。
 *
 * CLI 指令組合：
 *   - 新對話：`codex exec - --json --skip-git-repo-check --cd <repoPath> --full-auto -c sandbox_workspace_write.network_access=true --model <model>`
 *   - 恢復對話：`codex exec resume <id> - --json --cd <repoPath> --full-auto -c sandbox_workspace_write.network_access=true`
 *   - `-` 表示從 stdin 讀取 prompt
 *   - `--full-auto` 取代舊版 `--yolo`，保留 OS-level workspace 寫入限制
 *   - `--cd <repoPath>` 明確錨定 sandbox boundary，與 Bun.spawn cwd 雙保險
 *   - `-c sandbox_workspace_write.network_access=true` 允許 npm install / git push 等網路需求
 */

import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  CODEX_CAPABILITIES,
} from "./capabilities.js";
import { normalize } from "./codexNormalizer.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderMetadata,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";

/**
 * Codex provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface CodexOptions {
  /** 使用的模型名稱 */
  model: string;
  /** resume 模式固定為 "cli"（Codex 目前只支援 CLI resume 路徑） */
  resumeMode: "cli";
}

/** 合法 resumeSessionId 格式（防止 CLI 旗標注入） */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 合法 model 名稱格式（防止 CLI 旗標注入）。
 * 只允許英數字、點、底線、連字號，不允許空格或 -- 前綴等旗標字元。
 */
const MODEL_RE = /^[a-zA-Z0-9._-]+$/;

/** 合法 attachment MIME 類型副檔名白名單 */
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "png", "gif", "webp"]);

/** 合法 base64 字元集（防止換行符造成 prompt injection） */
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/**
 * stderr 收集上限（64KB）。
 * 超過後停止累積，避免長時間執行的 codex 輸出大量 debug log 時記憶體爆掉。
 */
const STDERR_MAX_BYTES = 64 * 1024;

/** 傳入 codex subprocess 的環境變數白名單：僅傳遞 codex 實際需要的 key，避免洩漏敏感資訊 */
const CODEX_ENV_WHITELIST = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "OPENAI_API_KEY",
  "TERM",
]);

/** CODEX 專屬環境變數額外允許清單 */
const CODEX_ENV_EXTRA_WHITELIST: ReadonlySet<string> = new Set([
  "CODEX_DISABLE_TELEMETRY",
  "CODEX_LOG_LEVEL",
]);

function buildCodexEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (CODEX_ENV_WHITELIST.has(key) || CODEX_ENV_EXTRA_WHITELIST.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** process.env 在 process 生命週期內不會改變，模組載入時快取一次 */
const CODEX_ENV = buildCodexEnv();

/**
 * 將 stderr 文字中的敏感資訊遮蔽。
 * 避免 OPENAI_API_KEY 或 Bearer token 等資訊寫進 server log。
 * 涵蓋常見 secret 模式：API key、Bearer token、Authorization header 等。
 */
function maskSensitiveText(text: string): string {
  return text
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization\s*:\s*\S+/gi, "Authorization: [REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]");
}

/**
 * 將 ContentBlock[] 轉換為 codex 可接受的純文字 prompt。
 * 圖片附件以 base64 data URI 內聯（禁止使用 --image，因為 --image + --json 會 hang）。
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
      // 驗證 MIME 類型整體格式（拒絕含換行或控制字元）
      const MIME_FORMAT_RE = /^image\/[a-z0-9.+-]+$/;
      if (!MIME_FORMAT_RE.test(block.mediaType)) {
        logger.warn(
          "Chat",
          "Warn",
          "[CodexProvider] 附件 MIME 類型格式不合法，已略過",
        );
        continue;
      }

      // 驗證 base64 格式，防止換行符等字元造成 prompt injection
      if (!BASE64_RE.test(block.base64Data)) {
        logger.warn(
          "Chat",
          "Warn",
          "[CodexProvider] 附件 base64 格式不合法，已略過",
        );
        continue;
      }

      // 驗證 MIME 副類型白名單
      const rawExt = block.mediaType
        .split("/")[1]
        ?.toLowerCase()
        .replace("jpeg", "jpg");
      if (!rawExt || !ALLOWED_IMAGE_EXTS.has(rawExt)) {
        logger.warn(
          "Chat",
          "Warn",
          "[CodexProvider] 附件 MIME 類型不在白名單內，已略過",
        );
        continue;
      }

      parts.unshift(
        `[image: data:${block.mediaType};base64,${block.base64Data}]`,
      );
    }
  }

  return parts.join("\n");
}

/** 組合新對話的 CLI 參數（無 resumeSessionId 或 sessionId 不合法時使用）。 */
function buildNewSessionArgs(model: string, repoPath: string): string[] {
  return [
    "exec",
    "-",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    repoPath,
    "--full-auto",
    "-c",
    "sandbox_workspace_write.network_access=true",
    "--model",
    model,
  ];
}

/**
 * 組合 codex CLI 參數。
 * 驗證 resumeSessionId 及 model 格式，防止 CLI 旗標注入。
 *
 * args 含 `--cd <repoPath>` 是雙保險：Bun.spawn cwd 已由上層 `resolvePodCwd` 統一解析，
 * `--cd` 則明確錨定 sandbox boundary，確保 codex sandbox 寫入限制與工作目錄一致。
 *
 * @param resumeSessionId 恢復對話的 session ID，為 null 時走新對話模式
 * @param model 模型名稱（已通過 MODEL_RE 驗證）
 * @param repoPath 工作目錄路徑（由上層 resolvePodCwd 解析過的合法路徑）
 * @returns CLI 參數陣列（不含 "codex" 本身）
 */
function buildCodexArgs(
  resumeSessionId: string | null,
  model: string,
  repoPath: string,
): string[] {
  if (resumeSessionId) {
    if (!SESSION_ID_RE.test(resumeSessionId)) {
      // resumeSessionId 格式不合法，防止旗標注入，改走新對話
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] resumeSessionId 格式不合法，已略過並改為新對話：${resumeSessionId}`,
      );
      return buildNewSessionArgs(model, repoPath);
    }

    // 恢復對話模式：不帶 --model（由 session 決定）
    return [
      "exec",
      "resume",
      resumeSessionId,
      "-",
      "--json",
      "--cd",
      repoPath,
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
    ];
  }

  return buildNewSessionArgs(model, repoPath);
}

/**
 * 判斷 err 是否為 ENOENT（codex CLI 尚未安裝或不在 PATH 中）。
 * 供 spawnCodexProcess catch 與 chat() catch 共用，消除重複的 duck-typing 程式碼。
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
 * 啟動 codex subprocess，直接 throw 原始錯誤，由 chat() 呼叫端統一判斷。
 * 不在此處做 ENOENT 包裝——改由 chat() 使用 isEnoentError 統一處理。
 *
 * cwd 與 args 中的 `--cd` 使用同一個 repoPath（雙保險）。
 * repoPath 已由上層 `resolvePodCwd` 統一解析，此處直接使用。
 *
 * @param args CLI 參數（不含 "codex"）
 * @param repoPath 工作目錄路徑（與 args 中 --cd 後的值同值）
 * @returns Bun.Subprocess
 */
function spawnCodexProcess(
  args: string[],
  repoPath: string,
): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn(["codex", ...args], {
    cwd: repoPath,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: CODEX_ENV,
  });
}

/**
 * 並行收集 codex subprocess 的 stderr，上限 STDERR_MAX_BYTES。
 * 必須在 stdout 消費「之前」啟動（或並行），避免 stderr buffer 滿導致 subprocess 卡住。
 *
 * @param proc Bun.Subprocess
 * @param abortSignal abort 控制（中止時停止收集）
 * @returns 收集到的 stderr 文字（已截斷標記、已遮蔽敏感資訊）
 */
async function collectStderr(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  abortSignal: AbortSignal,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    if (abortSignal.aborted) break;
    const buf = Buffer.from(chunk as Uint8Array);
    if (totalBytes + buf.byteLength <= STDERR_MAX_BYTES) {
      chunks.push(buf);
      totalBytes += buf.byteLength;
    } else {
      truncated = true;
      break;
    }
  }

  let text = Buffer.concat(chunks).toString("utf-8").trim();
  if (truncated) {
    text += "\n[TRUNCATED]";
  }
  return maskSensitiveText(text);
}

/**
 * 依 exit code 決定是否 yield error event 或 warn log。
 *
 * - exitCode !== 0 且未 abort 且 !hasTurnComplete → yield error event 並寫 error log
 * - exitCode !== 0 且 hasTurnComplete → 僅寫 warn log（不 yield error，避免污染正常流程）
 * - 其他情況（成功或已 abort）不做任何事
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
      `[CodexProvider] codex 已完成一個 turn 但以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}），可能為正常退出行為`,
    );
    if (stderrText) {
      logger.warn("Chat", "Warn", `[CodexProvider] stderr: ${stderrText}`);
    }
    return;
  }

  // 未完成 turn 且非零 exit code → yield error event（使用者友善訊息，exit code 細節留在 log）
  logger.error(
    "Chat",
    "Error",
    `[CodexProvider] codex 子程序以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}）${stderrText ? "，stderr 詳見下行" : "，無 stderr 輸出"}`,
  );
  if (stderrText) {
    logger.error("Chat", "Error", `[CodexProvider] stderr: ${stderrText}`);
  }
  yield {
    type: "error",
    message: "執行發生錯誤，請查閱伺服器日誌",
    fatal: false,
  };
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
 * 逐行讀取 codex subprocess 的 stdout，yield NormalizedEvent；
 * 並行啟動 stderr 收集（避免 stderr buffer 滿導致 subprocess 卡住），
 * 結束後依 exit code 決定是否 yield error event。
 *
 * @param proc Bun.Subprocess
 * @param promptText 寫入 stdin 的 prompt 文字
 * @param abortSignal abort 控制
 * @param podId 僅用於 log 顯示
 */
async function* streamCodexOutput(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  promptText: string,
  abortSignal: AbortSignal,
  podId: string,
): AsyncGenerator<NormalizedEvent> {
  // ── 寫入 prompt 到 stdin 後關閉 ────────────────────────────────
  proc.stdin.write(promptText);
  await proc.stdin.end();

  // ── 並行啟動 stderr 收集（在 stdout 之前啟動避免 buffer 滿卡住） ──
  const stderrPromise = collectStderr(proc, abortSignal);

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

export class CodexProvider implements AgentProvider<CodexOptions> {
  /**
   * Codex provider 的 metadata，包含 name、capabilities 與預設執行時選項。
   */
  readonly metadata: ProviderMetadata<CodexOptions> = {
    name: "codex",
    capabilities: CODEX_CAPABILITIES,
    defaultOptions: {
      model: "gpt-5.4",
      resumeMode: "cli",
    },
    availableModels: CODEX_AVAILABLE_MODELS,
    availableModelValues: CODEX_AVAILABLE_MODEL_VALUES,
  };

  /**
   * 從 Pod 設定建構 Codex 執行時選項。
   *
   * - 讀取 `pod.providerConfig?.model`：若為合法字串（通過 MODEL_RE 驗證）則使用之，
   *   否則回傳 metadata.defaultOptions.model。
   * - resumeMode 固定為 "cli"（Codex 目前只支援 CLI resume 路徑）。
   * - runContext 本 Phase 不使用（但簽名必須收），以符合 AgentProvider 介面規範。
   */
  async buildOptions(
    pod: Pod,
    _runContext?: RunContext,
  ): Promise<CodexOptions> {
    const rawModel = pod.providerConfig?.model;
    const model =
      typeof rawModel === "string" && MODEL_RE.test(rawModel)
        ? rawModel
        : this.metadata.defaultOptions.model;

    return {
      model,
      resumeMode: "cli",
    };
  }

  /**
   * 準備執行所需的 CLI 參數與 prompt 文字。
   * 驗證 model 格式，若不合法回傳 null（由 chat() 負責 yield error）。
   */
  private prepareExecution(
    ctx: ChatRequestContext<CodexOptions>,
  ): { codexArgs: string[]; promptText: string } | null {
    const { message, workspacePath, resumeSessionId, options } = ctx;
    const model = options?.model ?? this.metadata.defaultOptions.model;

    if (!MODEL_RE.test(model)) {
      return null;
    }

    const codexArgs = buildCodexArgs(resumeSessionId, model, workspacePath);
    const promptText = buildPromptText(message);

    return { codexArgs, promptText };
  }

  async *chat(
    ctx: ChatRequestContext<CodexOptions>,
  ): AsyncIterable<NormalizedEvent> {
    const { podId, workspacePath, abortSignal, options } = ctx;

    // ── 準備執行（model 驗證 + CLI 參數 + prompt 轉換） ─────────────
    const execution = this.prepareExecution(ctx);
    if (execution === null) {
      const model = options?.model ?? this.metadata.defaultOptions.model;
      yield {
        type: "error",
        message: `不合法的 model 名稱：${model}`,
        fatal: true,
      };
      return;
    }

    const { codexArgs, promptText } = execution;

    // ── Spawn subprocess ───────────────────────────────────────────
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;

    try {
      proc = spawnCodexProcess(codexArgs, workspacePath);
    } catch (err: unknown) {
      if (isEnoentError(err)) {
        yield {
          type: "error",
          message: "codex CLI 尚未安裝或不在 PATH 中，請執行 codex login",
          fatal: true,
        };
      } else {
        // 非 ENOENT 的啟動失敗：原始訊息寫進 logger，不暴露給前端
        logger.error(
          "Chat",
          "Error",
          "[CodexProvider] 啟動 codex 子程序失敗",
          err,
        );
        yield {
          type: "error",
          message: "啟動 codex 子程序失敗，請查 server log",
          fatal: true,
        };
      }
      return;
    }

    // ── abort signal 處理 ──────────────────────────────────────────
    const onAbort = (): void => {
      try {
        proc?.kill();
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
          "[CodexProvider] kill subprocess 時發生非預期錯誤",
          err,
        );
      }
    };

    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener("abort", onAbort, { once: true });

    try {
      yield* streamCodexOutput(proc, promptText, abortSignal, podId);
    } finally {
      abortSignal.removeEventListener("abort", onAbort);
    }
  }
}

export const codexProvider = new CodexProvider();
