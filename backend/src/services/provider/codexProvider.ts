/**
 * CodexProvider
 *
 * 透過 `codex exec` subprocess 執行 OpenAI Codex CLI，
 * 將其 JSON line 輸出轉換為 NormalizedEvent 串流。
 *
 * 實作 AgentProvider 介面，支援基本聊天（chat=true）。
 *
 * CLI 指令組合：
 *   - 新對話：`codex exec - --json --skip-git-repo-check --cd <repoPath> --dangerously-bypass-approvals-and-sandbox --model <model>`
 *   - 恢復對話：`codex exec resume <id> - --json --dangerously-bypass-approvals-and-sandbox --model <model>`
 *     （`exec resume` 不接受 `--cd`，工作目錄由 Bun.spawn cwd 定錨）
 *   - `-` 表示從 stdin 讀取 prompt
 *   - `--cd <repoPath>` 讓 Codex 以 run clone 作為工作目錄
 *   - `--dangerously-bypass-approvals-and-sandbox` 關閉 Codex 內建 sandbox 與 approval，
 *     讓 Git metadata 與 shell 操作在 run clone 內完整可用
 */

import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  isFastModeSupported,
} from "./capabilities.js";
import { normalize } from "./codexNormalizer.js";
import { buildProviderSystemError } from "./types.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderErrorRecovery,
  ProviderMetadata,
} from "./types.js";
import { logger } from "../../utils/logger.js";
import { sanitizePodName } from "./podNameSanitizer.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import { buildMcpBootstrapPrompt } from "./mcpBootstrapPrompt.js";
import { formatPluginSkillCatalogPrompt } from "../plugin/pluginCatalogBuilder.js";
import {
  managedMcpSurfaceService,
  type PodMcpEntry,
} from "../mcp/managedMcpSurfaceService.js";
import { collectStderr } from "../codex/codexHelpers.js";
import { isEnoentError } from "./utils.js";
import { codexSkillService } from "../codex/codexSkillService.js";
import { podStore } from "../podStore.js";
import { codexMcpService } from "../codex/codexMcpService.js";

/**
 * Codex provider 的執行時選項（執行時型別，由 buildOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 */
export interface CodexOptions {
  /** 使用的模型名稱 */
  model: string;
  /** resume 模式固定為 "cli"（Codex 目前只支援 CLI resume 路徑） */
  resumeMode: "cli";
  /** 思考深度等級（thinkingLevel），對應 codex 的 model_reasoning_effort；未設定時不傳 -c 旗標 */
  thinkingLevel?: string;
  /** 是否啟用 Codex Fast mode。 */
  fastModeEnabled?: boolean;
  /**
   * 要注入給 codex 的 managed MCP entries（含 Goal Runtime；run / chat 模式統一）。
   * 每筆轉成 `-c mcp_servers.<name>.*` CLI args 餵給 codex CLI。
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
  /** Pod 明確選取的 Codex Skill key。 */
  codexSkillKeys: string[];
  /** Pod 明確選取的 Codex 原生 MCP key。 */
  codexMcpServerKeys: string[];
  /** 是否已完成舊 Pod 的首次 Skill 白名單初始化。 */
  codexSkillsInitialized: boolean;
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

/** Codex provider 專用的系統錯誤建立 helper（委派給共用 buildProviderSystemError） */
function buildCodexSystemError(
  params:
    | {
        content: string;
        fatal: false;
        code: string;
        rawContent?: string;
        recovery?: ProviderErrorRecovery;
      }
    | {
        content: string;
        fatal: true;
        code: string;
        rawContent?: string;
        recovery: ProviderErrorRecovery;
      },
): Extract<NormalizedEvent, { type: "error" }> {
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

function buildCodexPromptText(
  message: string | import("../../types/message.js").ContentBlock[],
  goalRuntimeAvailable: boolean,
  pluginCatalogText: string,
  hiddenSections: string[] | undefined,
  resumeSessionId?: string | null,
): string {
  const promptText = buildPromptText(message);
  // resume 時（gate retry 第 2 輪以後）不再注入 bootstrap，避免覆蓋 nudge 指示
  if (resumeSessionId) {
    return promptText;
  }
  return buildMcpBootstrapPrompt(promptText, {
    goalRuntimeAvailable,
    pluginCatalogText,
    hiddenSections,
  });
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
 * 即使 Codex 關閉內建 sandbox，MCP tool 仍可能走 approval flow，
 * 但 spawn 時 stdin 是 pipe 無法取得使用者輸入，最終回 Cancel。
 * 透過 `-c` 覆寫各 server 的 default_tools_approval_mode=approve 可跳過 approval。
 *
 * 含 `.` 的 server name 會與 TOML path 語意衝突，直接 skip 並記錄 warn。
 */
function buildMcpAutoApproveArgs(serverNames: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushServerName = (serverName: string): void => {
    if (seen.has(serverName)) return;
    seen.add(serverName);

    if (!MCP_AUTO_APPROVE_SAFE_NAME_RE.test(serverName)) {
      logger.warn(
        "McpServer",
        "Warn",
        `[CodexProvider] server name 含不合法字元（含 '.' 或特殊符號），已略過 auto-approve 旗標：${serverName}`,
      );
      return;
    }
    result.push(
      "-c",
      `mcp_servers.${serverName}.default_tools_approval_mode=approve`,
    );
  };

  for (const serverName of serverNames) {
    pushServerName(serverName);
  }

  return result;
}

/**
 * 將 PodMcpEntry[] 轉成 codex CLI 的 `-c mcp_servers.<name>.*` 參數。
 *
 * - stdio entry：寫 command / args / env（codex toml 的 stdio MCP 形狀）
 * - http entry：只寫 url（codex 透過 `url` 存在就判定 streamable HTTP transport，無 `type` 欄位）
 * - sse entry：理論上不會走到此分支 — buildPodMcpEntries 已對 codex 不支援的 sse 包成
 *   proxy bridge stdio entry。若仍進到這裡視為 invariant 破壞並跳過。
 *
 * 含 `.` 的 server name 會與 TOML path 語意衝突，直接 skip 並記錄 warn。
 */
function buildRuntimeMcpConfigArgs(entries: PodMcpEntry[]): string[] {
  const args: string[] = [];

  for (const entry of entries) {
    if (!MCP_AUTO_APPROVE_SAFE_NAME_RE.test(entry.name)) {
      logger.warn(
        "McpServer",
        "Warn",
        `[CodexProvider] MCP server name 不合法，已略過動態注入：${entry.name}`,
      );
      continue;
    }

    if (entry.transport === "stdio") {
      args.push(
        "-c",
        `mcp_servers.${entry.name}.command=${JSON.stringify(entry.command)}`,
        "-c",
        `mcp_servers.${entry.name}.args=${JSON.stringify(entry.args)}`,
      );

      for (const [key, value] of Object.entries(entry.env)) {
        args.push(
          "-c",
          `mcp_servers.${entry.name}.env.${key}=${JSON.stringify(value)}`,
        );
      }
      continue;
    }

    if (entry.transport === "http") {
      // codex 依 `url` 欄位存在自動判定為 streamable HTTP，不需也不接受 `type` 欄位
      args.push(
        "-c",
        `mcp_servers.${entry.name}.url=${JSON.stringify(entry.url)}`,
      );
      continue;
    }

    logger.warn(
      "McpServer",
      "Warn",
      `[CodexProvider] 不應走到的 transport：${entry.name}（${(entry as { transport: string }).transport}）— 預期 buildPodMcpEntries 已透過 proxy bridge 包裝`,
    );
  }

  return args;
}

function buildFastModeArgs(enabled: boolean): string[] {
  return [
    "-c",
    `features.fast_mode=${enabled}`,
    ...(enabled ? ["-c", 'service_tier="fast"'] : []),
  ];
}

/** 組合新對話的 CLI 參數（無 resumeSessionId 或 sessionId 不合法時使用）。 */
function buildNewSessionArgs(
  model: string,
  repoPath: string,
  mcpAutoApproveArgs: string[],
  goalMcpConfigArgs: string[],
  skillConfigArgs: string[],
  nativeMcpConfigArgs: string[],
  thinkingLevel?: string,
  fastModeEnabled = false,
): string[] {
  return [
    "exec",
    "-",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    repoPath,
    "--dangerously-bypass-approvals-and-sandbox",
    // thinkingLevel 為非空字串時才插入 -c model_reasoning_effort，否則交由 CLI 預設
    ...(thinkingLevel ? ["-c", `model_reasoning_effort=${thinkingLevel}`] : []),
    ...buildFastModeArgs(fastModeEnabled),
    ...goalMcpConfigArgs,
    ...nativeMcpConfigArgs,
    ...skillConfigArgs,
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
 * 新對話 args 含 `--cd <repoPath>`：Bun.spawn cwd 已由上層 `resolvePodCwd` 統一解析，
 * `--cd` 則讓 Codex UI / session 記錄使用同一個 run clone 工作目錄。
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
  options?: CodexOptions,
  thinkingLevel?: string,
  skillConfigArgs: string[] = [],
  nativeMcpConfigArgs: string[] = [],
  nativeMcpServerNames: string[] = [],
): string[] {
  const entries = options?.mcpEntries ?? [];

  // auto-approve 僅套用 Pod 選取的 Codex 原生 MCP 與 Canvas 動態注入 entries。
  const autoApproveServerNames = [
    ...nativeMcpServerNames,
    ...entries.map((entry) => entry.name),
  ];

  const mcpAutoApproveArgs = buildMcpAutoApproveArgs(autoApproveServerNames);
  const runtimeMcpConfigArgs = buildRuntimeMcpConfigArgs(entries);
  const fastModeEnabled = options?.fastModeEnabled ?? false;

  if (resumeSessionId) {
    if (!SESSION_ID_RE.test(resumeSessionId)) {
      // resumeSessionId 格式不合法，防止旗標注入，改走新對話
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] resumeSessionId 格式不合法，已略過並改為新對話：${resumeSessionId}`,
      );
      return buildNewSessionArgs(
        model,
        repoPath,
        mcpAutoApproveArgs,
        runtimeMcpConfigArgs,
        skillConfigArgs,
        nativeMcpConfigArgs,
        thinkingLevel,
        fastModeEnabled,
      );
    }

    // 恢復對話模式：`codex exec resume` 不接受 --cd，
    // 工作目錄由 Bun.spawn cwd 定錨。model 必須明確傳入，否則 CLI 會改用
    // ~/.codex/config.toml 的全域模型，可能與 session / Pod 設定不同。
    return [
      "exec",
      "resume",
      resumeSessionId,
      "-",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      // thinkingLevel 為非空字串時才插入 -c model_reasoning_effort，否則交由 CLI 預設
      ...(thinkingLevel
        ? ["-c", `model_reasoning_effort=${thinkingLevel}`]
        : []),
      ...buildFastModeArgs(fastModeEnabled),
      ...runtimeMcpConfigArgs,
      ...nativeMcpConfigArgs,
      ...skillConfigArgs,
      // 為每個使用者安裝的 MCP server 加入 auto-approve 旗標，避免 stdin pipe 無法回應時被 Cancel
      ...mcpAutoApproveArgs,
      "--model",
      model,
    ];
  }

  return buildNewSessionArgs(
    model,
    repoPath,
    mcpAutoApproveArgs,
    runtimeMcpConfigArgs,
    skillConfigArgs,
    nativeMcpConfigArgs,
    thinkingLevel,
    fastModeEnabled,
  );
}

/**
 * 啟動 codex subprocess，直接 throw 原始錯誤，由 chat() 呼叫端統一判斷。
 * 不在此處做 ENOENT 包裝——改由 chat() 使用 isEnoentError 統一處理。
 *
 * cwd 與新對話 args 中的 `--cd` 使用同一個 repoPath。
 * repoPath 已由上層 `resolvePodCwd` 統一解析，此處直接使用。
 *
 * @param args CLI 參數（不含 "codex"）
 * @param repoPath 工作目錄路徑
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
    env: process.env,
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
      if (event === null || consumeTransportProgress(event)) {
        continue;
      }
      if (event.type === "turn_complete") {
        out.hasTurnComplete = true;
      }
      yield event;
    }
  }

  // 處理 stdout 結束時剩餘的 buffer 內容
  if (buffer.trim()) {
    const event = normalize(buffer);
    if (event !== null && !consumeTransportProgress(event)) {
      if (event.type === "turn_complete") {
        out.hasTurnComplete = true;
      }
      yield event;
    }
  }
}

function consumeTransportProgress(event: NormalizedEvent): boolean {
  if (
    event.type !== "error" ||
    (event.code !== "STREAM_RECONNECTING" &&
      event.code !== "STREAM_TRANSPORT_FALLBACK")
  ) {
    return false;
  }

  const status =
    event.code === "STREAM_RECONNECTING"
      ? "正在重新連線"
      : "正在切換到 HTTPS transport";
  logger.warn(
    "Chat",
    "Warn",
    `[CodexProvider] Codex CLI ${status}：${event.message}`,
  );
  return true;
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
  proc.stdin.write(promptText);
  await proc.stdin.end();

  // 在 stdout 之前啟動 stderr 收集，避免 buffer 滿導致 subprocess 卡住
  const stderrPromise = collectStderr(proc, abortSignal, "[CodexProvider]");

  const turnState = { hasTurnComplete: false };
  yield* processStdoutLines(
    proc.stdout as ReadableStream<Uint8Array>,
    abortSignal,
    turnState,
  );

  const stderrText = await stderrPromise;
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
          recovery: "unrecoverable",
        }),
      };
    }
    // 非 ENOENT 的啟動失敗：err.message 直接帶到 errorEvent
    return {
      ok: false,
      errorEvent: buildCodexSystemError({
        content: err instanceof Error ? err.message : "啟動 codex 子程序失敗",
        fatal: true,
        code: "SPAWN_FAILED",
        rawContent: err instanceof Error ? err.message : String(err),
        recovery: "unrecoverable",
      }),
    };
  }

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

const codexMetadata: ProviderMetadata<CodexOptions> = {
  name: "codex",
  defaultOptions: {
    model: "gpt-5.6-luna",
    resumeMode: "cli",
    mcpEntries: [],
    hasGoalRuntime: false,
    pluginCatalogText: "",
    codexSkillKeys: [],
    codexMcpServerKeys: [],
    codexSkillsInitialized: true,
    fastModeEnabled: false,
  },
  availableModels: CODEX_AVAILABLE_MODELS,
  availableModelValues: CODEX_AVAILABLE_MODEL_VALUES,
};

function prepareCodexExecution(
  ctx: ChatRequestContext<CodexOptions>,
  skillConfigArgs: string[],
  nativeMcpConfigArgs: string[],
  nativeMcpServerNames: string[],
): { codexArgs: string[]; promptText: string } | null {
  const {
    message,
    workspacePath,
    resumeSessionId,
    hiddenBootstrapSections,
    options,
  } = ctx;
  const model = options?.model ?? codexMetadata.defaultOptions.model;

  if (!MODEL_RE.test(model)) {
    return null;
  }

  const codexArgs = buildCodexArgs(
    resumeSessionId,
    model,
    workspacePath,
    options,
    options?.thinkingLevel,
    skillConfigArgs,
    nativeMcpConfigArgs,
    nativeMcpServerNames,
  );
  const goalRuntimeAvailable = Boolean(options?.hasGoalRuntime);
  const pluginCatalogText = options?.pluginCatalogText ?? "";
  const promptText = buildCodexPromptText(
    message,
    goalRuntimeAvailable,
    pluginCatalogText,
    hiddenBootstrapSections,
    resumeSessionId,
  );

  return { codexArgs, promptText };
}

export const codexProvider: AgentProvider<CodexOptions> = {
  metadata: codexMetadata,

  async buildOptions(pod: Pod, runContext?: RunContext): Promise<CodexOptions> {
    const rawModel = pod.providerConfig?.model;
    const model =
      typeof rawModel === "string" && MODEL_RE.test(rawModel)
        ? rawModel
        : codexMetadata.defaultOptions.model;

    const { entries, hasGoalRuntime, pluginCatalog } =
      await managedMcpSurfaceService.buildPodMcpEntries(
        pod,
        runContext ?? null,
      );

    const result: CodexOptions = {
      model,
      resumeMode: "cli",
      mcpEntries: entries,
      hasGoalRuntime,
      pluginCatalogText: formatPluginSkillCatalogPrompt(pluginCatalog),
      codexSkillKeys: [...(pod.codexSkillKeys ?? [])],
      codexMcpServerKeys: [...(pod.codexMcpServerKeys ?? [])],
      codexSkillsInitialized: pod.codexSkillsInitialized ?? false,
      fastModeEnabled:
        pod.fastModeEnabled === true && isFastModeSupported("codex", model),
    };

    const rawThinkingLevel = pod.providerConfig?.thinkingLevel;
    if (typeof rawThinkingLevel === "string" && rawThinkingLevel.length > 0) {
      result.thinkingLevel = rawThinkingLevel;
    }

    return result;
  },

  async *chat(
    ctx: ChatRequestContext<CodexOptions>,
  ): AsyncIterable<NormalizedEvent> {
    const { podId, podName, workspacePath, abortSignal, options } = ctx;
    const requestedModel = options?.model ?? codexMetadata.defaultOptions.model;
    if (!MODEL_RE.test(requestedModel)) {
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] model 驗證失敗，不合法的 model 名稱：${requestedModel}`,
      );
      yield buildCodexSystemError({
        content: "不合法的 model 名稱",
        fatal: true,
        code: "INVALID_MODEL",
        recovery: "unrecoverable",
      });
      return;
    }

    let skillConfigArgs: string[];
    try {
      const { runtimeEntries } = await codexSkillService.list(
        workspacePath,
        true,
      );
      const selectedKeys = codexSkillService.resolveSelectedKeys(
        options?.codexSkillKeys ?? [],
        options?.codexSkillsInitialized ?? false,
        runtimeEntries,
      );
      if (
        options?.codexSkillsInitialized !== undefined &&
        (options.codexSkillsInitialized === false ||
          JSON.stringify(selectedKeys) !==
            JSON.stringify(options.codexSkillKeys ?? []))
      ) {
        podStore.setCodexSkillKeys(podId, selectedKeys);
      }
      skillConfigArgs = codexSkillService.buildRuntimeConfigArgs(
        selectedKeys,
        runtimeEntries,
      );
    } catch (error) {
      logger.error(
        "Chat",
        "Error",
        `[CodexProvider] 載入 Pod Skills 失敗（podId: ${podId}）：${error instanceof Error ? error.message : String(error)}`,
      );
      yield buildCodexSystemError({
        content: "無法載入 Codex Skills 設定，請稍後再試",
        fatal: true,
        code: "CODEX_SKILLS_LOAD_FAILED",
        recovery: "unrecoverable",
      });
      return;
    }

    let nativeMcpConfigArgs: string[];
    let nativeMcpServerNames: string[];
    try {
      const runtimeEntries = await codexMcpService.list(workspacePath);
      const selectedKeys = codexMcpService.resolveSelectedKeys(
        options?.codexMcpServerKeys ?? [],
        runtimeEntries,
      );
      if (
        JSON.stringify(selectedKeys) !==
        JSON.stringify(options?.codexMcpServerKeys ?? [])
      ) {
        podStore.setCodexMcpServerKeys(podId, selectedKeys);
      }
      nativeMcpConfigArgs = codexMcpService.buildRuntimeConfigArgs(
        selectedKeys,
        runtimeEntries,
      );
      const selectedSet = new Set(selectedKeys);
      nativeMcpServerNames = runtimeEntries
        .filter(
          (entry) => entry.globallyEnabled && selectedSet.has(entry.key),
        )
        .map((entry) => entry.name);
    } catch (error) {
      logger.error(
        "Chat",
        "Error",
        `[CodexProvider] 載入 Pod MCP 失敗（podId: ${podId}）：${error instanceof Error ? error.message : String(error)}`,
      );
      yield buildCodexSystemError({
        content: "無法載入 Codex MCP 設定，請稍後再試",
        fatal: true,
        code: "CODEX_MCP_LOAD_FAILED",
        recovery: "unrecoverable",
      });
      return;
    }

    const execution = prepareCodexExecution(
      ctx,
      skillConfigArgs,
      nativeMcpConfigArgs,
      nativeMcpServerNames,
    );
    if (execution === null) {
      const model = options?.model ?? codexMetadata.defaultOptions.model;
      logger.warn(
        "Chat",
        "Warn",
        `[CodexProvider] model 驗證失敗，不合法的 model 名稱：${model}`,
      );
      yield buildCodexSystemError({
        content: "不合法的 model 名稱",
        fatal: true,
        code: "INVALID_MODEL",
        recovery: "unrecoverable",
      });
      return;
    }

    const { codexArgs, promptText } = execution;
    const model = options?.model ?? codexMetadata.defaultOptions.model;
    logger.log(
      "Chat",
      "Update",
      `[CodexProvider] ${sanitizePodName(podName)} 開始查詢（model: ${model}，thinking: ${options?.thinkingLevel ?? "none"}）`,
    );

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

    try {
      yield* streamCodexOutput(proc, promptText, abortSignal, podId);
    } finally {
      cleanup();
    }
  },
};
