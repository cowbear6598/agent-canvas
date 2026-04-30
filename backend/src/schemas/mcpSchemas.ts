import { z } from "zod";
import { requestIdSchema, canvasIdSchema, podIdSchema } from "./base.js";
import { providerSchema } from "./podSchemas.js";

/**
 * MCP server 名稱合法字元集規則：
 * - 首字元：英文字母、數字、底線（_）或點（.）
 * - 後續字元：英文字母、數字、底線（_）、點（.）或連字號（-）
 * 設計理由：對齊常見 MCP server 命名慣例，排除空白與特殊符號，避免命令注入風險。
 */
const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/;

/** MCP_LIST 請求 payload schema：指定要查詢的 provider */
export const mcpListRequestSchema = z
  .object({
    requestId: requestIdSchema,
    provider: providerSchema,
  })
  .strict();

/**
 * MCP 清單項目 schema：
 * - name：MCP server 名稱
 * - type：連線類型（stdio 或 http），未提供時由前端自行判斷
 */
export const mcpListItemSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["stdio", "http"]).optional(),
});

/** MCP_LIST_RESULT 回應 payload schema：帶回 provider 與對應的 MCP server 清單 */
export const mcpListResultSchema = z
  .object({
    provider: providerSchema,
    items: z.array(mcpListItemSchema),
  })
  .strict();

/**
 * POD_SET_MCP_SERVER_NAMES 請求 payload schema：
 * 設定指定 pod 的 MCP server 名稱清單（仿 podSetPluginsSchema 設計）
 */
export const podSetMcpServerNamesSchema = z
  .object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    podId: podIdSchema,
    /** MCP server 名稱清單，最多 50 筆，每筆名稱最長 200 字元，只允許字母、數字、底線、點、連字號 */
    mcpServerNames: z
      .array(z.string().min(1).max(200).regex(MCP_SERVER_NAME_PATTERN))
      .max(50),
  })
  .strict();

export type McpListRequest = z.infer<typeof mcpListRequestSchema>;
export type McpListItem = z.infer<typeof mcpListItemSchema>;
export type McpListResult = z.infer<typeof mcpListResultSchema>;
export type PodSetMcpServerNamesPayload = z.infer<
  typeof podSetMcpServerNamesSchema
>;
