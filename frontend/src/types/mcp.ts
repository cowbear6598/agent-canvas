/**
 * MCP 清單項目：
 * - name：MCP server 名稱
 * - type：連線類型，與後端 mcpListItemSchema 對齊
 *   - Claude：不帶 type（前端僅顯示 name + Switch）
 *   - Codex：必帶 type（前端顯示 name + 類型標籤 + ✓）
 *   - Opencode：必帶 type，可能為 stdio / sse / http
 * - system：是否為內建系統工具（如 Goal built-in MCP）
 * - locked：系統工具固定啟用，不可切換
 */
export interface McpListItem {
  name: string;
  type?: "stdio" | "http" | "sse";
  system?: boolean;
  locked?: boolean;
  description?: string;
  status?: "running" | "blocked" | "completed";
  activeTodoId?: string | null;
  activeTodoText?: string | null;
  nextTodoId?: string | null;
  nextTodoText?: string | null;
  blockedReason?: string | null;
  handoffSummary?: string | null;
  completedTodoIds?: string[];
  completedCount?: number;
  totalCount?: number;
}
