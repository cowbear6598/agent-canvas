/**
 * CodexProvider
 *
 * 透過 `codex exec` subprocess 執行 OpenAI Codex CLI，
 * 將其 JSON line 輸出轉換為 NormalizedEvent 串流。
 *
 * 實作 AgentProvider 介面，支援基本聊天（chat=true）。
 *
 * CLI 指令組合：
 *   - 新對話：`codex exec - --json --yolo --skip-git-repo-check --model <model>`
 *   - 恢復對話：`codex exec resume <id> - --json --yolo`
 *   - `-` 表示從 stdin 讀取 prompt
 */

import { CODEX_AVAILABLE_MODELS, CODEX_CAPABILITIES } from "./capabilities.js";
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

/**
 * 傳入 codex subprocess 的環境變數白名單（固定清單）。
 * 僅傳遞 codex 實際需要的 key，避免洩漏其他 API key、DB 連線字串等敏感資訊。
 */
const CODEX_ENV_WHITELIST = new Set([
  "PATH", // 讓 codex 找到可執行檔與依賴
  "HOME", // 讀取使用者設定檔
  "LANG", // 避免 CLI 輸出亂碼
  "LC_ALL", // locale override
  "OPENAI_API_KEY", // codex 的 API 認證
  "TERM", // 終端機類型
]);

/**
 * 明確 allow-list 避免 CODEX_SECRET 之類的敏感 env 被無意洩漏到 subprocess。
 * 這裡只列出 codex CLI 已知需要的環境變數，使用者可視需要後續擴充。
 */
const CODEX_ALLOWED_ENV: ReadonlyArray<string> = [
  "CODEX_DISABLE_TELEMETRY",
  "CODEX_LOG_LEVEL",
];

/** 篩選環境變數，僅保留白名單與明確允許的 CODEX_* key */
function buildCodexEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (CODEX_ENV_WHITELIST.has(key) || CODEX_ALLOWED_ENV.includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 將 stderr 文字中的敏感資訊遮蔽。
 * 避免 OPENAI_API_KEY 或 Bearer token 等資訊寫進 server log。
 */
function maskSensitiveText(text: string): string {
  return text
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
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
      // 驗證 base64 格式，防止換行符等字元造成 prompt injection
      if (!BASE64_RE.test(block.base64Data)) {
        logger.warn(
          "Chat",
          "Warn",
          "[CodexProvider] 附件 base64 格式不合法，已略過",
        );
        continue;
      }

      // 驗證 MIME 類型
      const rawExt = block.mediaType
        .split("/")[1]
        ?.toLowerCase()
        .replace("jpeg", "jpg");
      if (!rawExt || !ALLOWED_IMAGE_EXTS.has(rawExt)) {
        logger.warn(
          "Chat",
          "Warn",
          `[CodexProvider] 附件 MIME 類型不在白名單內，已略過（mediaType: ${block.mediaType}）`,
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

/**
 * 組合 codex CLI 參數。
 * 驗證 resumeSessionId 及 model 格式，防止 CLI 旗標注入。
 *
 * @param resumeSessionId 恢復對話的 session ID，為 null 時走新對話模式
 * @param model 模型名稱（已通過 MODEL_RE 驗證）
 * @returns CLI 參數陣列（不含 "codex" 本身）
 */
function buildCodexArgs(
  resumeSessionId: string | null,
  model: string,
): string[] {
  const args: string[] = [];

  if (resumeSessionId) {
    if (!SESSION_ID_RE.test(resumeSessionId)) {
      // resumeSessionId 格式不合法，防止旗標注入，改走新對話
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] resumeSessionId 格式不合法，已略過並改為新對話：${resumeSessionId}`,
      );
      args.push(
        "exec",
        "-",
        "--json",
        "--yolo",
        "--skip-git-repo-check",
        "--model",
        model,
      );
    } else {
      // 恢復對話模式：不帶 --model（由 session 決定）
      args.push("exec", "resume", resumeSessionId, "-", "--json", "--yolo");
    }
  } else {
    // 新對話模式
    args.push(
      "exec",
      "-",
      "--json",
      "--yolo",
      "--skip-git-repo-check",
      "--model",
      model,
    );
  }

  return args;
}

/**
 * 啟動 codex subprocess。
 * ENOENT 錯誤會重新包裝後拋出，讓上層可辨識；其他錯誤訊息寫進 logger 後拋出通用訊息。
 *
 * @param args CLI 參數（不含 "codex"）
 * @param workspacePath 工作目錄
 * @returns Bun.Subprocess
 */
function spawnCodexProcess(
  args: string[],
  workspacePath: string,
): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  try {
    return Bun.spawn(["codex", ...args], {
      cwd: workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: buildCodexEnv(),
    });
  } catch (err: unknown) {
    // 判斷是否為 ENOENT（codex CLI 尚未安裝）
    const isNotFound =
      err instanceof Error &&
      ("code" in err
        ? (err as NodeJS.ErrnoException).code === "ENOENT"
        : err.message.includes("ENOENT"));

    if (isNotFound) {
      const notFoundErr = new Error(
        "codex CLI 尚未安裝或不在 PATH 中，請執行 codex login",
      );
      (notFoundErr as NodeJS.ErrnoException).code = "ENOENT";
      throw notFoundErr;
    }

    // 其他錯誤：原始訊息寫進 logger，不暴露給前端
    logger.error("Chat", "Error", "[CodexProvider] 啟動 codex 子程序失敗", err);
    throw new Error("啟動 codex 子程序失敗，請查 server log");
  }
}

/**
 * 逐行讀取 codex subprocess 的 stdout，yield NormalizedEvent；
 * 同時收集 stderr（上限 STDERR_MAX_BYTES），並在結束後依 exit code 決定是否 yield error event。
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
  // Bun.Subprocess.stdin 是 FileSink，直接呼叫 write/end
  proc.stdin.write(promptText);
  await proc.stdin.end();

  // ── 逐行讀取 stdout ─────────────────────────────────────────────
  let buffer = "";
  let hasTurnComplete = false;

  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    if (abortSignal.aborted) break;

    buffer += Buffer.from(chunk as Uint8Array).toString("utf-8");

    const lines = buffer.split("\n");
    // 最後一段可能不完整，保留在 buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = normalize(line);
      if (event !== null) {
        if (event.type === "turn_complete") {
          hasTurnComplete = true;
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
        hasTurnComplete = true;
      }
      yield event;
    }
  }

  // ── 收集 stderr（僅用於 exit code 處理時的 server log） ─────────
  // 累計長度超過 STDERR_MAX_BYTES 後停止 push，避免記憶體爆掉
  const stderrChunks: Buffer[] = [];
  let stderrTotalBytes = 0;
  let stderrTruncated = false;

  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    const buf = Buffer.from(chunk as Uint8Array);
    if (stderrTotalBytes + buf.byteLength <= STDERR_MAX_BYTES) {
      stderrChunks.push(buf);
      stderrTotalBytes += buf.byteLength;
    } else {
      // 超過上限後停止收集，標記為已截斷
      stderrTruncated = true;
      break;
    }
  }

  let stderrText = Buffer.concat(stderrChunks).toString("utf-8").trim();
  if (stderrTruncated) {
    stderrText += "\n[TRUNCATED]";
  }

  // ── exit code 檢查 ──────────────────────────────────────────────
  const exitCode = await proc.exited;

  if (exitCode !== 0 && !abortSignal.aborted && !hasTurnComplete) {
    logger.error(
      "Chat",
      "Error",
      `[CodexProvider] codex 子程序以非零 exit code 結束（exit code: ${exitCode}，podId: ${podId}）${stderrText ? "，stderr 詳見下行" : "，無 stderr 輸出"}`,
    );
    if (stderrText) {
      // stderr 遮蔽敏感資訊後寫進 logger，不對外廣播
      const maskedText = maskSensitiveText(stderrText);
      logger.error("Chat", "Error", `[CodexProvider] stderr: ${maskedText}`);
    }
    yield {
      type: "error",
      message: `Codex 執行時發生錯誤（exit code: ${exitCode}），請查閱伺服器日誌`,
      fatal: false,
    };
  }
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

  async *chat(
    ctx: ChatRequestContext<CodexOptions>,
  ): AsyncIterable<NormalizedEvent> {
    const {
      podId,
      message,
      workspacePath,
      resumeSessionId,
      abortSignal,
      options,
    } = ctx;

    // 從 ctx.options 取得模型（Phase 3 起不再從 ctx.providerConfig 取值）
    const model = options?.model ?? this.metadata.defaultOptions.model;

    // ── 驗證 model（防止 CLI 旗標注入） ───────────────────────────────
    if (!MODEL_RE.test(model)) {
      yield {
        type: "error",
        message: `不合法的 model 名稱：${model}`,
        fatal: true,
      };
      return;
    }

    // ── 組合 CLI 參數 ──────────────────────────────────────────────
    const codexArgs = buildCodexArgs(resumeSessionId, model);

    // ── 組合 prompt 文字 ───────────────────────────────────────────
    const promptText = buildPromptText(message);

    // ── Spawn subprocess ───────────────────────────────────────────
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;

    try {
      proc = spawnCodexProcess(codexArgs, workspacePath);
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error &&
        ("code" in err
          ? (err as NodeJS.ErrnoException).code === "ENOENT"
          : err.message.includes("ENOENT"));

      if (isNotFound) {
        yield {
          type: "error",
          message: "codex CLI 尚未安裝或不在 PATH 中，請執行 codex login",
          fatal: true,
        };
      } else {
        yield {
          type: "error",
          message: "啟動 codex 子程序失敗，請查 server log",
          fatal: true,
        };
      }
      return;
    }

    // ── abort signal 處理 ──────────────────────────────────────────
    // abort 由外部 abortRegistry 驅動 signal，subprocess 監聽 signal 自己退場；
    // Phase 3 起不再使用 activeProcesses Map 自管 subprocess。
    const onAbort = (): void => {
      try {
        proc?.kill();
      } catch {
        // subprocess 已結束則忽略
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
