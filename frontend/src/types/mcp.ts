/**
 * MCP 清單項目：
 * - name：MCP server 名稱
 * - type：連線類型，與後端 mcpListItemSchema 對齊
 *   - Claude：不帶 type（前端僅顯示 name + Switch）
 *   - Codex：必帶 type（前端顯示 name + 類型標籤 + ✓）
 *   - Gemini：必帶 type，可能為 stdio / sse / http
 */
export interface McpListItem {
  name: string;
  type?: "stdio" | "http" | "sse";
}
