/**
 * Claude Provider 的選項建構模組。
 *
 * 將 claudeService 裡的 apply* 邏輯與 buildBaseOptions 搬至此處，
 * 以符合 AgentProvider<ClaudeOptions>.buildOptions 的介面契約。
 *
 * 產出 ClaudeOptions，涵蓋 Claude 獨有能力：
 *   MCP Server / Plugin / Integration Tool / Base Options / Model
 */

import {
  type Options,
  type EffortLevel,
  type ThinkingConfig,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { readClaudeMcpServers } from "../../mcp/claudeMcpReader.js";
import { integrationRegistry } from "../../integration/index.js";
import {
  replyContextStore,
  buildReplyContextKey,
} from "../../integration/replyContextStore.js";
import { getClaudeCodePath } from "../../claude/claudePathResolver.js";
import type { Pod } from "../../../types/pod.js";
import type { RunContext } from "../../../types/run.js";
import { getResultErrorString } from "../../../types/result.js";
import { logger } from "../../../utils/logger.js";
import { managedMcpSurfaceService } from "../../mcp/managedMcpSurfaceService.js";
import { formatPluginSkillCatalogPrompt } from "../../plugin/pluginCatalogBuilder.js";

// ─── ClaudeOptions 介面定義 ──────────────────────────────────────────────────

/**
 * Claude provider 的執行時選項（執行時型別，由 buildClaudeOptions 輸出）。
 * 與 Pod.providerConfig（儲存型別 { model: string }）是兩個獨立概念。
 *
 * 承載 Claude 獨有能力：MCP / Plugins / Integration / Base SDK 設定
 */
export interface ClaudeOptions {
  /** 使用的 Claude 模型（預設為 "sonnet"） */
  model: string;
  /** MCP Server 設定（來自 mcpServerNames 與 Integration Tool） */
  mcpServers?: Options["mcpServers"];
  /** 允許的工具清單（baseAllowedTools + Integration Tool 追加） */
  allowedTools: string[];
  /** SDK 設定來源（固定為 ["project"]） */
  settingSources: Options["settingSources"];
  /** SDK 權限模式（固定為 "bypassPermissions"） */
  permissionMode: Options["permissionMode"];
  /** 是否包含部分訊息（固定為 true） */
  includePartialMessages: boolean;
  /** Claude Code 可執行檔路徑（由 getClaudeCodePath 取得） */
  pathToClaudeCodeExecutable?: string;
  /** 工作目錄（chat 時從 ctx.workspacePath 取得，buildOptions 階段為 undefined） */
  cwd?: string;
  /** 思考強度（來自 pod.providerConfig.thinkingLevel；undefined 代表走 CLI 預設） */
  effort?: EffortLevel;
  /** 思考設定（搭配 effort 使用，固定為 adaptive） */
  thinking?: ThinkingConfig;
  /**
   * SDK 內建 sandbox 設定（取代自寫的 claudeSandboxLauncher）。
   *
   * filesystem.allowWrite 在執行階段才能組（需要 workspacePath / sandboxHomePath），
   * 因此 buildClaudeOptions 階段不設 sandbox，由 runClaudeQuery / claudeService 於
   * 已知 cwd 時動態組裝。
   */
  sandbox?: Options["sandbox"];
  /**
   * Plugin Skill Catalog 文字段落（已預先 format）。
   * 空字串代表本 Pod 無啟用 plugin 或掃不出任何 SKILL.md。
   * Fresh session 首輪會與 Goal Runtime bootstrap 一起注入 user prompt。
   */
  pluginCatalogText: string;
}

// ─── 基礎 Claude 工具清單 ────────────────────────────────────────────────────

/**
 * Claude 預設允許的工具清單。
 * 對應 claudeService.buildQueryOptions 裡的 baseAllowedTools。
 *
 * ⚠️ 安全警告：此清單搭配 permissionMode: "bypassPermissions" 使用，
 * 代表清單內所有工具均可在無需用戶確認的情況下被 Claude 呼叫。
 * 每次新增或移除工具時，必須在 PR description 中明確列出 security 影響評估，
 * 包含：該工具可存取的資源範圍、最壞情況下的系統風險、以及是否需要縮小 bypassPermissions 範圍。
 */
export const BASE_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "Skill",
  "WebSearch",
];

// ─── applyMcpServers ─────────────────────────────────────────────────────────

/**
 * 套用 MCP Server 設定，回傳包含 mcpServers 的 partial options。
 *
 * 統一走 managedMcpSurfaceService.buildPodMcpEntries，每顆 managed MCP 各自獨立 entry
 * 注入給 Claude SDK（agent 看到 N+1 個獨立 MCP，不再是一顆 surface aggregator）。
 *
 * - Run 模式：含 Goal Runtime + 各 managed MCP entry
 * - Chat 模式：只有 managed MCP entry（無 Goal Runtime）
 * - http / sse target：buildPodMcpEntries 已自動包成 per-MCP proxy bridge 的 stdio entry
 *
 * 若 entries 為空但 pod.mcpServerNames 有值，退回 ~/.claude.json 的 user-scoped allowlist
 * 作為歷史相容（popover 已只露 managed，此分支主要保護早期 pod 設定）。
 */
async function applyMcpServers(
  pod: Pod,
  runContext?: RunContext,
): Promise<Pick<ClaudeOptions, "mcpServers" | "pluginCatalogText">> {
  const { entries, pluginCatalog } =
    await managedMcpSurfaceService.buildPodMcpEntries(pod, runContext ?? null);

  const mcpServers: NonNullable<Options["mcpServers"]> = {};
  for (const entry of entries) {
    if (entry.transport !== "stdio") {
      // buildPodMcpEntries 的 invariant：Claude 不原生支援的 transport 應已被 proxy bridge
      // 包成 stdio。若進到這裡代表 invariant 破壞，跳過並 warn 以避免 SDK 噴錯。
      logger.warn(
        "McpServer",
        "Warn",
        `[ClaudeOptions] 略過非 stdio entry：${entry.name}（${entry.transport}）— 預期已被 proxy bridge 包裝`,
      );
      continue;
    }
    mcpServers[entry.name] = {
      command: entry.command,
      args: entry.args,
      env: entry.env,
    };
  }

  // Legacy fallback：pod.mcpServerNames 中若有不在 managed registry 的項目，退回
  // ~/.claude.json 的 user-scoped allowlist 補上。此流程獨立於 entries 是否已含項目，
  // 避免被永遠存在的 agent_canvas_plugin entry 短路掉。
  if (pod.mcpServerNames.length > 0) {
    const allowedSet = new Set(pod.mcpServerNames);
    const allServers = readClaudeMcpServers();
    for (const server of allServers) {
      if (!allowedSet.has(server.name)) continue;
      if (mcpServers[server.name]) continue;
      mcpServers[server.name] = {
        command: server.command,
        args: server.args,
        env: server.env,
      };
    }
  }

  const pluginCatalogText = formatPluginSkillCatalogPrompt(pluginCatalog);

  if (Object.keys(mcpServers).length > 0) {
    return { mcpServers, pluginCatalogText };
  }
  return { pluginCatalogText };
}

// ─── buildIntegrationTool ────────────────────────────────────────────────────

type ReplyToolHandler = (params: { text: string }) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

/**
 * 建立 reply tool 的 async handler 閉包：執行 sendMessage 並格式化成功/失敗結果。
 * 透過 replyContextStore 取得 runContext 以定址正確的回覆上下文。
 */
function createReplyToolHandler(
  binding: NonNullable<Pod["integrationBindings"]>[number],
  provider: NonNullable<ReturnType<typeof integrationRegistry.get>>,
  podId: string,
  runContext?: RunContext,
): ReplyToolHandler {
  return async (params: { text: string }) => {
    const replyContext = replyContextStore.get(
      buildReplyContextKey(runContext, podId),
    );
    const mergedExtra = { ...binding.extra, ...replyContext };
    const result = await provider.sendMessage!(
      binding.appId,
      binding.resourceId,
      params.text,
      mergedExtra,
    );
    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `錯誤: ${getResultErrorString(result.error)}`,
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text" as const, text: "success" }] };
  };
}

/**
 * 建立單一 Integration 的 MCP reply tool，回傳 mcpServer、serverName 與 toolName。
 * closure 透過 replyContextStore 取得 runContext 以定址正確的回覆上下文。
 *
 * 對應 claudeService.buildIntegrationTool 的邏輯。
 */
function buildIntegrationTool(
  binding: NonNullable<Pod["integrationBindings"]>[number],
  provider: NonNullable<ReturnType<typeof integrationRegistry.get>>,
  podId: string,
  runContext?: RunContext,
): {
  mcpServer: ReturnType<typeof createSdkMcpServer>;
  serverName: string;
  toolName: string;
} {
  const serverName = `${binding.provider}-reply`;
  const toolName = `${binding.provider}_reply`;

  const replyTool = tool(
    toolName,
    `回覆 ${provider.displayName} 訊息。當需要在 ${provider.displayName} 中回覆用戶時使用此工具。`,
    {
      text: z.string().min(1).describe("要發送的訊息內容"),
    },
    createReplyToolHandler(binding, provider, podId, runContext),
  );

  const mcpServer = createSdkMcpServer({
    name: serverName,
    tools: [replyTool],
  });

  return { mcpServer, serverName, toolName };
}

// ─── applyIntegrationToolOptions ─────────────────────────────────────────────

/**
 * 收集 pod 所有 integrationBindings 並建構 IntegrationTool 清單。
 * 無 sendMessage 或 provider 不存在的 binding 自動略過。
 */
/** binding.provider 格式白名單：只允許字母、數字、底線、連字號 */
const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function collectIntegrationTools(
  pod: Pod,
  runContext?: RunContext,
): ReturnType<typeof buildIntegrationTool>[] {
  if (!pod.integrationBindings?.length) return [];

  return pod.integrationBindings
    .map((binding) => {
      // 驗證 provider 格式，防止動態 mcp tool 名稱注入不合法字元
      if (!PROVIDER_NAME_PATTERN.test(binding.provider)) {
        logger.warn(
          "Integration",
          "Warn",
          `略過不合法格式的 integration provider（名稱已遮罩）`,
        );
        return null;
      }
      const provider = integrationRegistry.get(binding.provider);
      if (!provider?.sendMessage) return null;
      return buildIntegrationTool(binding, provider, pod.id, runContext);
    })
    .filter((t) => t !== null);
}

/**
 * 套用 Integration Tool 設定，回傳包含 mcpServers 與 allowedTools 的 partial options。
 * 若 pod 無 integrationBindings 或無合法 tool，則原封不動回傳 base。
 *
 * 對應 claudeService.applyIntegrationToolOptions 的邏輯。
 */
function applyIntegrationToolOptions(
  pod: Pod,
  base: { mcpServers?: Options["mcpServers"]; allowedTools: string[] },
  runContext?: RunContext,
): { mcpServers?: Options["mcpServers"]; allowedTools: string[] } {
  const builtTools = collectIntegrationTools(pod, runContext);

  if (builtTools.length === 0) return base;

  const mcpServers: NonNullable<Options["mcpServers"]> = {
    ...base.mcpServers,
  };
  const allowedTools: string[] = [...base.allowedTools];

  for (const { mcpServer, serverName, toolName } of builtTools) {
    mcpServers[serverName] = mcpServer;
    allowedTools.push(`mcp__${serverName}__${toolName}`);
  }

  return {
    mcpServers: { ...mcpServers },
    allowedTools,
  };
}

// ─── buildClaudeOptions ──────────────────────────────────────────────────────

/**
 * 建構 Claude 查詢的完整執行時選項（ClaudeOptions）。
 *
 * 合併順序：
 *   1. buildBaseOptions（固定 SDK 設定 + cwd）
 *   2. applyMcpServers（mcpServers）
 *   3. applyIntegrationToolOptions（追加 mcpServers + allowedTools）
 *   4. model（來自 pod.providerConfig.model 或 default）
 *
 * runContext 用於 buildIntegrationTool 內部 closure 讀取 replyContextStore。
 *
 * 注意：cwd 在 buildOptions 階段尚未知道（需等 executor 解析 workspacePath），
 * 因此此函式產出的 ClaudeOptions.cwd 為 undefined，由 chat() 負責在組裝 SDK options 時填入。
 */
export async function buildClaudeOptions(
  pod: Pod,
  runContext?: RunContext,
): Promise<ClaudeOptions> {
  const mcpServerOptions = await applyMcpServers(pod, runContext);

  // Integration Tool：整合 MCP servers 與 allowedTools
  const integrationResult = applyIntegrationToolOptions(
    pod,
    {
      mcpServers: mcpServerOptions.mcpServers,
      allowedTools: [...BASE_ALLOWED_TOOLS],
    },
    runContext,
  );
  const mergedMcpServers: NonNullable<Options["mcpServers"]> = {
    ...(integrationResult.mcpServers ?? {}),
  };

  // model：來自 pod.providerConfig.model（字串型別），否則 fallback 到 "sonnet"
  const rawModel = pod.providerConfig?.model;
  const model = typeof rawModel === "string" && rawModel ? rawModel : "sonnet";

  const baseOptions: Omit<ClaudeOptions, "model" | "pluginCatalogText"> = {
    settingSources: ["project"],
    // 安全敏感點：bypassPermissions 讓 Claude 繞過工具使用權限確認。
    // 每次修改 BASE_ALLOWED_TOOLS 時須同步做 security review，
    // 確認新增工具不會引入非預期的系統存取風險。
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    pathToClaudeCodeExecutable: getClaudeCodePath(),
    allowedTools: integrationResult.allowedTools,
  };

  // thinkingLevel：sanitizeProviderConfigStrict 已注入該 model 的 default，
  // 故支援 thinking 的 model 必有非空字串值；不支援的 model 為 undefined。
  // 後端不驗證合法性，信賴前端傳入；undefined 代表不傳 effort/thinking 讓 CLI 走預設。
  const rawThinkingLevel = pod.providerConfig?.thinkingLevel;
  const thinkingLevel =
    typeof rawThinkingLevel === "string" && rawThinkingLevel
      ? rawThinkingLevel
      : null;

  // 合併所有選項（mcpServers 已包含 MCP Server + Integration 兩者）
  const result: ClaudeOptions = {
    ...baseOptions,
    ...(Object.keys(mergedMcpServers).length > 0
      ? { mcpServers: mergedMcpServers }
      : {}),
    model,
    pluginCatalogText: mcpServerOptions.pluginCatalogText ?? "",
    ...(thinkingLevel
      ? {
          effort: thinkingLevel as EffortLevel,
          thinking: { type: "adaptive" } as ThinkingConfig,
        }
      : {}),
  };

  return result;
}
