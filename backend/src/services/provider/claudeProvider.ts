/**
 * ClaudeProvider — Phase 4 真實實作
 *
 * 實作 AgentProvider<ClaudeOptions> 介面，透過 Claude SDK 執行 AI 查詢。
 *
 * 子模組：
 *   - buildClaudeOptions.ts：從 Pod 設定組裝 ClaudeOptions（MCP / Plugin / Integration）
 *   - runClaudeQuery.ts：SDKMessage → NormalizedEvent 的轉換（直接呼叫 SDK query()）
 *   - sessionRetry.ts：Session resume 失敗時自動重試一次
 */

import {
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
  CLAUDE_CAPABILITIES,
} from "./capabilities.js";
import {
  buildClaudeOptions,
  BASE_ALLOWED_TOOLS,
  type ClaudeOptions,
} from "./claude/buildClaudeOptions.js";
import { withSessionRetry } from "./claude/sessionRetry.js";
import { getClaudeCodePath } from "../claude/claudePathResolver.js";
import type {
  AgentProvider,
  ChatRequestContext,
  NormalizedEvent,
  ProviderMetadata,
} from "./types.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";

// ─── ClaudeOptions re-export ──────────────────────────────────────────────────

export type { ClaudeOptions };

// ─── claudeProvider ──────────────────────────────────────────────────────────

/**
 * claudeProvider — 符合 AgentProvider<ClaudeOptions> 介面的真實實作。
 *
 * metadata.defaultOptions 記錄 Claude 的基本預設選項，
 * 前端可透過 provider:list 取得此值供新建 Pod 時顯示預設模型等資訊。
 */
export const claudeProvider: AgentProvider<ClaudeOptions> = {
  metadata: {
    name: "claude",
    capabilities: CLAUDE_CAPABILITIES,
    defaultOptions: {
      model: "opus",
      allowedTools: [...BASE_ALLOWED_TOOLS],
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      pathToClaudeCodeExecutable: getClaudeCodePath(),
    },
    availableModels: CLAUDE_AVAILABLE_MODELS,
    availableModelValues: CLAUDE_AVAILABLE_MODEL_VALUES,
  } satisfies ProviderMetadata<ClaudeOptions>,

  /**
   * 從 Pod 設定與 RunContext 建構執行時選項（ClaudeOptions）。
   * 委派給 buildClaudeOptions 子模組，涵蓋 MCP / Plugin / Integration 全部邏輯。
   */
  async buildOptions(
    pod: Pod,
    runContext?: RunContext,
  ): Promise<ClaudeOptions> {
    return buildClaudeOptions(pod, runContext);
  },

  /**
   * 發起聊天串流，回傳 NormalizedEvent 的 AsyncIterable。
   *
   * 委派給 withSessionRetry（包裝 runClaudeQuery），處理 session resume 失敗的自動重試。
   * 不再使用 onSessionInit callback；session_started 事件由 executor 端消化後呼叫 strategy.onSessionInit。
   */
  async *chat(
    ctx: ChatRequestContext<ClaudeOptions>,
  ): AsyncIterable<NormalizedEvent> {
    yield* withSessionRetry(ctx);
  },
};
