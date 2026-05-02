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
  type SdkPluginConfig,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { readClaudeMcpServers } from "../../mcp/claudeMcpReader.js";
import { scanInstalledPlugins } from "../../pluginScanner.js";
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
  /** Plugin 設定（來自 pluginIds） */
  plugins?: SdkPluginConfig[];
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
 * 從 ~/.claude.json top-level `mcpServers` 讀取 user-scoped MCP server，
 * 再以 pod.mcpServerNames 做 allowlist 過濾。
 *
 * 若 pod.mcpServerNames 為空，或過濾後無符合項目，則回傳空物件。
 */
function applyMcpServers(pod: Pod): Pick<ClaudeOptions, "mcpServers"> {
  if (!pod.mcpServerNames.length) return {};

  // 讀取 user-scoped MCP servers（top-level mcpServers）
  const allowedSet = new Set(pod.mcpServerNames);
  const allServers = readClaudeMcpServers();
  const filtered = allServers.filter((s) => allowedSet.has(s.name));

  if (filtered.length === 0) return {};

  const mcpServers: NonNullable<Options["mcpServers"]> = {};
  for (const server of filtered) {
    mcpServers[server.name] = {
      command: server.command,
      args: server.args,
      env: server.env,
    };
  }
  return { mcpServers };
}

// ─── applyPlugins ────────────────────────────────────────────────────────────

/**
 * 套用 Plugin 設定，回傳包含 plugins 的 partial options。
 * 若 pod 無 pluginIds 設定，則回傳空物件。
 */
function applyPlugins(pod: Pod): Pick<ClaudeOptions, "plugins"> {
  if (!pod.pluginIds.length) return {};

  const enabledSet = new Set(pod.pluginIds);
  const plugins = scanInstalledPlugins("claude")
    .filter((plugin) => enabledSet.has(plugin.id))
    .map(
      (plugin): SdkPluginConfig => ({
        type: "local",
        path: plugin.installPath,
      }),
    );

  if (plugins.length > 0) {
    return { plugins };
  }
  return {};
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
 *   4. applyPlugins（plugins）
 *   5. model（來自 pod.providerConfig.model 或 default）
 *
 * runContext 用於 buildIntegrationTool 內部 closure 讀取 replyContextStore。
 *
 * 注意：cwd 在 buildOptions 階段尚未知道（需等 executor 解析 workspacePath），
 * 因此此函式產出的 ClaudeOptions.cwd 為 undefined，由 chat() 負責在組裝 SDK options 時填入。
 */
// 介面契約（AgentProvider.buildOptions）要求回傳 Promise<TOptions>，實際執行同步；
// async 保留以符合介面簽名，不影響執行效能。
export async function buildClaudeOptions(
  pod: Pod,
  runContext?: RunContext,
): Promise<ClaudeOptions> {
  const mcpServerOptions = applyMcpServers(pod);
  const pluginOptions = applyPlugins(pod);

  // Integration Tool：整合 MCP servers 與 allowedTools
  const integrationResult = applyIntegrationToolOptions(
    pod,
    {
      mcpServers: mcpServerOptions.mcpServers,
      allowedTools: [...BASE_ALLOWED_TOOLS],
    },
    runContext,
  );

  // model：來自 pod.providerConfig.model（字串型別），否則 fallback 到 "sonnet"
  const rawModel = pod.providerConfig?.model;
  const model = typeof rawModel === "string" && rawModel ? rawModel : "sonnet";

  const baseOptions: Omit<ClaudeOptions, "model"> = {
    settingSources: ["project"],
    // 安全敏感點：bypassPermissions 讓 Claude 繞過工具使用權限確認。
    // 每次修改 BASE_ALLOWED_TOOLS 時須同步做 security review，
    // 確認新增工具不會引入非預期的系統存取風險。
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    pathToClaudeCodeExecutable: getClaudeCodePath(),
    allowedTools: integrationResult.allowedTools,
  };

  // 合併所有選項（mcpServers 已包含 MCP Server + Integration 兩者）
  const result: ClaudeOptions = {
    ...baseOptions,
    ...(integrationResult.mcpServers &&
    Object.keys(integrationResult.mcpServers).length > 0
      ? { mcpServers: integrationResult.mcpServers }
      : {}),
    ...pluginOptions,
    model,
  };

  // sanitize pod.name：截前 50 字元 + 移除控制字元，避免 log injection
  // eslint-disable-next-line no-control-regex
  const safePodName = pod.name.slice(0, 50).replace(/[\x00-\x1f\x7f]/g, "");

  logger.log(
    "Chat",
    "Update",
    `[buildClaudeOptions] Pod ${safePodName} 選項建構完成：model=${model}，allowedTools=${result.allowedTools.length}，mcpServers=${Object.keys(result.mcpServers ?? {}).length}，plugins=${result.plugins?.length ?? 0}`,
  );

  return result;
}
