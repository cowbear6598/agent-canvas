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
 *   - 恢復對話：`codex exec resume <id> - --json --full-auto -c sandbox_workspace_write.network_access=true`
 *     （`exec resume` 不接受 `--cd`，工作目錄改由 Bun.spawn cwd 定錨）
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
import { buildProviderSystemError } from "./types.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderMetadata,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import { readCodexMcpServers } from "../mcp/codexMcpReader.js";
import { buildCodexEnv, collectStderr } from "../codex/codexHelpers.js";
import { isEnoentError } from "./utils.js";

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

/**
 * 允許作為 Codex image attachment 的 MIME 副類型白名單。
 * 只接受 Claude Codex CLI 支援的圖片格式；其他副類型（如 svg、tiff）一律略過。
 */
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "png", "gif", "webp"]);

/**
 * 合法 base64 字元集正則。
 * 用於驗證圖片 base64 資料，確保不含換行符（`\n`）或其他控制字元，
 * 以防止 prompt injection 攻擊。
 */
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/**
 * 合法 MIME 類型整體格式正則。
 * 格式要求：`image/<subtype>`，subtype 只允許小寫英數字與 `.`、`+`、`-`。
 * 拒絕含換行或控制字元的 MIME 字串，防止 HTTP header injection。
 */
const MIME_FORMAT_RE = /^image\/[a-z0-9.+-]+$/;

/** process.env 在 process 生命週期內不會改變，模組載入時快取一次 */
const CODEX_ENV = buildCodexEnv();

/** Codex provider 專用的系統錯誤建立 helper（委派給共用 buildProviderSystemError） */
function buildCodexSystemError(params: {
  content: string;
  fatal: boolean;
  code: string;
  rawContent?: string;
}): Extract<NormalizedEvent, { type: "error" }> {
  return buildProviderSystemError("codex", params);
}

/**
 * 驗證圖片 ContentBlock 是否符合安全規範。
 * 集中三段驗證邏輯：
 *   1. MIME 類型整體格式（拒絕含換行或控制字元）
 *   2. base64 字元合法性（防止換行符等造成 prompt injection）
 *   3. MIME 副類型白名單（只允許 jpg/png/gif/webp）
 *
 * @returns true 表示驗證通過，false 表示應略過此 block
 */
function validateImageBlock(
  block: import("../../types/message.js").ImageContentBlock,
): boolean {
  // 驗證 MIME 類型整體格式（拒絕含換行或控制字元）
  if (!MIME_FORMAT_RE.test(block.mediaType)) {
    logger.warn(
      "Chat",
      "Warn",
      "[CodexProvider] 附件 MIME 類型格式不合法，已略過",
    );
    return false;
  }

  // 驗證 base64 格式，防止換行符等字元造成 prompt injection
  if (!BASE64_RE.test(block.base64Data)) {
    logger.warn(
      "Chat",
      "Warn",
      "[CodexProvider] 附件 base64 格式不合法，已略過",
    );
    return false;
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
    return false;
  }

  return true;
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
      if (!validateImageBlock(block)) continue;

      parts.unshift(
        `[image: data:${block.mediaType};base64,${block.base64Data}]`,
      );
    }
  }

  return parts.join("\n");
}

/**
 * `-c` 旗標中的 MCP server name 安全格式：不允許 `.`，
 * 因為 `mcp_servers.<name>.<field>` 語法中 `.` 是 TOML path 分隔符，
 * 含 `.` 的 name 會使 codex CLI 誤將其解析為巢狀路徑，導致設定套用錯誤。
 * 此正則與 schema 的 MCP_SERVER_NAME_PATTERN 獨立，不影響儲存層驗證。
 */
const MCP_AUTO_APPROVE_SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 為每個使用者安裝的 MCP server 產生對應的 `-c mcp_servers.<name>.default_tools_approval_mode=approve` 旗標組。
 *
 * codex 在 sandbox=WorkspaceWrite + approval_policy=Never 下，MCP tool 仍會走 approval flow，
 * 但 spawn 時 stdin 是 pipe 無法取得使用者輸入，最終回 Cancel。
 * 透過 `-c` 覆寫各 server 的 default_tools_approval_mode=approve 可跳過 approval。
 *
 * 含 `.` 的 server name 會與 TOML path 語意衝突，直接 skip 並記錄 warn。
 */
function buildMcpAutoApproveArgs(): string[] {
  const servers = readCodexMcpServers();
  const result: string[] = [];
  for (const server of servers) {
    if (!MCP_AUTO_APPROVE_SAFE_NAME_RE.test(server.name)) {
      logger.warn(
        "McpServer",
        "Warn",
        `[CodexProvider] server name 含不合法字元（含 '.' 或特殊符號），已略過 auto-approve 旗標：${server.name}`,
      );
      continue;
    }
    result.push(
      "-c",
      `mcp_servers.${server.name}.default_tools_approval_mode=approve`,
    );
  }
  return result;
}

/** 組合新對話的 CLI 參數（無 resumeSessionId 或 sessionId 不合法時使用）。 */
function buildNewSessionArgs(
  model: string,
  repoPath: string,
  mcpAutoApproveArgs: string[],
): string[] {
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
    // 為每個使用者安裝的 MCP server 加入 auto-approve 旗標，避免 stdin pipe 無法回應時被 Cancel
    ...mcpAutoApproveArgs,
    "--model",
    model,
  ];
}

/**
 * 組合 codex CLI 參數。
 * 驗證 resumeSessionId 及 model 格式，防止 CLI 旗標注入。
 *
 * 新對話 args 含 `--cd <repoPath>` 是雙保險：Bun.spawn cwd 已由上層 `resolvePodCwd` 統一解析，
 * `--cd` 則明確錨定 sandbox boundary，確保 codex sandbox 寫入限制與工作目錄一致。
 *
 * resume 模式的 `codex exec resume` 不接受 `--cd` flag（會導致 "unexpected argument" 錯誤），
 * 因此 resume 只用 Bun.spawn cwd 定錨工作目錄，不傳 `--cd`。
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
  // MCP auto-approve 旗標只計算一次，兩條分支共用同一結果
  const mcpAutoApproveArgs = buildMcpAutoApproveArgs();

  if (resumeSessionId) {
    if (!SESSION_ID_RE.test(resumeSessionId)) {
      // resumeSessionId 格式不合法，防止旗標注入，改走新對話
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] resumeSessionId 格式不合法，已略過並改為新對話：${resumeSessionId}`,
      );
      return buildNewSessionArgs(model, repoPath, mcpAutoApproveArgs);
    }

    // 恢復對話模式：`codex exec resume` 不接受 --cd，僅依賴 Bun.spawn cwd 定錨工作目錄。
    // --model 由 session 決定，不傳入。
    return [
      "exec",
      "resume",
      resumeSessionId,
      "-",
      "--json",
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
      // 為每個使用者安裝的 MCP server 加入 auto-approve 旗標，避免 stdin pipe 無法回應時被 Cancel
      ...mcpAutoApproveArgs,
    ];
  }

  return buildNewSessionArgs(model, repoPath, mcpAutoApproveArgs);
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
  const rawContent = stderrText || `codex exited with code ${exitCode}`;
  yield buildCodexSystemError({
    content: "執行發生錯誤，請查閱伺服器日誌",
    fatal: false,
    code: "EXIT_CODE",
    rawContent,
  });
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
  const stderrPromise = collectStderr(proc, abortSignal, "[CodexProvider]");

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
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  /** 必須在 try-finally 中呼叫，確保 abort listener 被移除 */
  cleanup: () => void;
};

/** setupSubprocess 失敗結果，含使用者可見的 error event */
type SubprocessFailure = {
  ok: false;
  errorEvent: NormalizedEvent & { type: "error" };
};

/**
 * Spawn codex subprocess 並設置 abort signal 處理。
 * 以 discriminated union 回傳結果，讓 chat() 以單一 if 分支處理失敗，不混 try-catch。
 * 成功時回傳 { ok: true, proc, cleanup }；失敗時回傳 { ok: false, errorEvent }。
 */
function setupSubprocess(
  codexArgs: string[],
  workspacePath: string,
  abortSignal: AbortSignal,
): SubprocessSuccess | SubprocessFailure {
  // ── Spawn subprocess ───────────────────────────────────────────
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = spawnCodexProcess(codexArgs, workspacePath);
  } catch (err: unknown) {
    if (isEnoentError(err)) {
      return {
        ok: false,
        errorEvent: buildCodexSystemError({
          content: "codex CLI 尚未安裝或不在 PATH 中，請執行 codex login",
          fatal: true,
          code: "CLI_NOT_FOUND",
        }),
      };
    }
    // 非 ENOENT 的啟動失敗：原始訊息寫進 logger，不暴露給前端
    logger.error("Chat", "Error", "[CodexProvider] 啟動 codex 子程序失敗", err);
    return {
      ok: false,
      errorEvent: buildCodexSystemError({
        content: err instanceof Error ? err.message : "啟動 codex 子程序失敗",
        fatal: true,
        code: "SPAWN_FAILED",
        rawContent: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  // ── abort signal 處理 ──────────────────────────────────────────
  // killProc 同時被 abort listener 與 cleanup() 呼叫；
  // 用旗標去重避免實際 proc.kill() 被呼叫超過一次。
  // 對已結束的子程序呼叫 kill 會觸發 ESRCH，視為正常情況直接忽略。
  let killed = false;
  const killProc = (): void => {
    if (killed) return;
    killed = true;
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
        "[CodexProvider] kill subprocess 時發生非預期錯誤",
        err,
      );
    }
  };

  abortSignal.addEventListener("abort", killProc, { once: true });

  // spawn 前已 abort：listener 不會自動觸發，需主動呼叫 killProc
  if (abortSignal.aborted) {
    killProc();
  }

  // cleanup() 會在 chat() 的 finally 區塊執行：
  //   - generator 正常完成：proc 已自行退出，killProc 因 ESRCH 直接忽略
  //   - generator 因主迴圈 break / abort 提前 return：必須主動 kill 才不會留下 zombie process
  const cleanup = (): void => {
    abortSignal.removeEventListener("abort", killProc);
    killProc();
  };

  return { ok: true, proc, cleanup };
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
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] model 驗證失敗，不合法的 model 名稱：${model}`,
      );
      yield buildCodexSystemError({
        content: "不合法的 model 名稱",
        fatal: true,
        code: "INVALID_MODEL",
      });
      return;
    }

    const { codexArgs, promptText } = execution;

    // ── Spawn subprocess + abort signal 設置 ──────────────────────
    const subprocessResult = setupSubprocess(
      codexArgs,
      workspacePath,
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
      yield* streamCodexOutput(proc, promptText, abortSignal, podId);
    } finally {
      cleanup();
    }
  }
}

export const codexProvider = new CodexProvider();
