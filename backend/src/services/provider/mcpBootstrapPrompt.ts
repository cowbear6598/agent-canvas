/**
 * MCP bootstrap prompt — 三家 provider 共用。
 *
 * 在 fresh session（非 resume）的第一輪 user message 前注入兩段內容：
 *   1. Goal Runtime 引導語（若 Pod 有 Goal Runtime MCP）
 *   2. Plugin Skill Catalog（若 Pod 有啟用 plugin 且能掃出 SKILL.md）
 *
 * 兩段獨立判斷：可只注入 Goal、只注入 Plugin、或兩者皆注入。
 * Resume session 時兩段都不注入，避免覆蓋 gate retry 的 nudge 指示。
 */

const GOAL_RUNTIME_BOOTSTRAP_LINES = [
  "A Goal Runtime MCP is available for this Pod.",
  "Start by calling get_active_goal_todo to read only the current active todo.",
  "Do not call get_goal_status just to learn what to work on; use it only when full progress/debug state is needed.",
  "Then continue with the current active todo instead of asking for a new task.",
  "Only ask for clarification if Goal Runtime shows no actionable todo or the work is blocked.",
];

export interface McpBootstrapContext {
  /** Pod 是否有 Goal Runtime MCP（run 模式才會 true） */
  goalRuntimeAvailable: boolean;
  /**
   * Plugin Skill Catalog 文字段落（已由 formatPluginSkillCatalogPrompt 預先組好）。
   * 空字串代表無可用 skill，不會被注入。
   */
  pluginCatalogText: string;
  /**
   * 額外的隱性 bootstrap 段落，例如 memory 注入。
   * 僅在 fresh session 第一輪附加，不會顯示在使用者 transcript。
   */
  hiddenSections?: string[];
}

function hasAnyBootstrap(ctx: McpBootstrapContext): boolean {
  return (
    ctx.goalRuntimeAvailable ||
    ctx.pluginCatalogText.length > 0 ||
    (ctx.hiddenSections?.length ?? 0) > 0
  );
}

function joinBootstrapSections(ctx: McpBootstrapContext): string {
  const sections: string[] = [];
  if (ctx.goalRuntimeAvailable) {
    sections.push(GOAL_RUNTIME_BOOTSTRAP_LINES.join("\n"));
  }
  if (ctx.pluginCatalogText) {
    sections.push(ctx.pluginCatalogText);
  }
  if (ctx.hiddenSections?.length) {
    sections.push(ctx.hiddenSections.join("\n\n"));
  }
  return sections.join("\n\n");
}

/**
 * codex / opencode 用：把 bootstrap 內容前置於使用者訊息。
 * 沒有任何要注入的內容時直接回原始訊息（trim 後）。
 */
export function buildMcpBootstrapPrompt(
  rawMessage: string,
  ctx: McpBootstrapContext,
): string {
  const trimmed = rawMessage.trim();
  if (!hasAnyBootstrap(ctx)) return trimmed;

  return [`User request: ${trimmed}`, "", joinBootstrapSections(ctx)].join(
    "\n",
  );
}

/**
 * Claude SDK 用：把 bootstrap 內容包成單一 text ContentBlock，放在 user message 的最前面。
 * 沒有要注入時回 null，呼叫端據此決定是否插入此 block。
 */
export function buildMcpBootstrapContentBlock(
  ctx: McpBootstrapContext,
): { type: "text"; text: string } | null {
  if (!hasAnyBootstrap(ctx)) return null;

  const text = [
    joinBootstrapSections(ctx),
    "",
    "The user's request follows in the remaining content blocks of this message.",
  ].join("\n");
  return { type: "text", text };
}
