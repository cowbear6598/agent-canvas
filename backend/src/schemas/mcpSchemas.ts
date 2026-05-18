import { z } from "zod";
import { requestIdSchema, canvasIdSchema, podIdSchema } from "./base.js";
import { providerSchema } from "./podSchemas.js";

/**
 * MCP server 名稱合法字元集規則（唯一真相，供 reader 模組 import）：
 * - 首字元：英文字母、數字、底線（_）或點（.）
 * - 後續字元：英文字母、數字、底線（_）、點（.）或連字號（-）
 * 設計理由：對齊常見 MCP server 命名慣例，排除空白與特殊符號，避免命令注入風險。
 */
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/;
const mcpTransportSchema = z.enum(["stdio", "http", "sse"]);
const managedMcpStatusSchema = z.enum([
  "healthy",
  "starting",
  "error",
  "idle",
  "disabled",
  "unknown",
  "running",
  "blocked",
  "completed",
]);

/** MCP_LIST 請求 payload schema：指定要查詢的 provider */
export const mcpListRequestSchema = z
  .object({
    requestId: requestIdSchema,
    provider: providerSchema,
    podId: podIdSchema.optional(),
  })
  .strict();

/**
 * MCP 清單項目 schema：
 * - name：MCP server 名稱
 * - type：連線類型（stdio、http 或 sse），未提供時由前端自行判斷
 */
export const mcpListItemSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["stdio", "http", "sse"]).optional(),
  system: z.boolean().optional(),
  locked: z.boolean().optional(),
  description: z.string().optional(),
  status: z.enum(["running", "blocked", "completed"]).optional(),
  activeTodoId: z.string().nullable().optional(),
  activeTodoText: z.string().nullable().optional(),
  nextTodoId: z.string().nullable().optional(),
  nextTodoText: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
  handoffSummary: z.string().nullable().optional(),
  completedTodoIds: z.array(z.string()).optional(),
  completedCount: z.number().int().nonnegative().optional(),
  totalCount: z.number().int().nonnegative().optional(),
});

/** MCP_LIST_RESULT 回應 payload schema：帶回 provider 與對應的 MCP server 清單 */
export const mcpListResultSchema = z
  .object({
    provider: providerSchema,
    items: z.array(mcpListItemSchema),
  })
  .strict();

const managedMcpRegistryBaseSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(200).regex(MCP_SERVER_NAME_PATTERN),
  enabled: z.boolean(),
});

const managedMcpRegistryStdioSchema = managedMcpRegistryBaseSchema
  .extend({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(400),
    args: z.array(z.string().max(500)).max(50).optional(),
    cwd: z.string().min(1).max(2000).nullable().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const managedMcpRegistryRemoteSchema = managedMcpRegistryBaseSchema
  .extend({
    transport: z.enum(["http", "sse"]),
    url: z.url().max(2000),
  })
  .strict();

export const managedMcpRegistryInputSchema = z.discriminatedUnion(
  "transport",
  [managedMcpRegistryStdioSchema, managedMcpRegistryRemoteSchema],
);

export const managedMcpRegistryItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    transport: mcpTransportSchema,
    enabled: z.boolean(),
    command: z.string().nullable(),
    args: z.array(z.string()),
    cwd: z.string().nullable(),
    env: z.record(z.string(), z.string()),
    url: z.string().nullable(),
    status: managedMcpStatusSchema,
    lastError: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export const managedMcpRegistryListRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const managedMcpRegistrySaveRequestSchema = z
  .object({
    requestId: requestIdSchema,
    registry: managedMcpRegistryInputSchema,
  })
  .strict();

export const managedMcpRegistryDeleteRequestSchema = z
  .object({
    requestId: requestIdSchema,
    registryId: z.uuid(),
  })
  .strict();

export const podMcpAvailabilityItemSchema = z
  .object({
    name: z.string().min(1),
    transport: mcpTransportSchema,
    status: managedMcpStatusSchema,
    selected: z.boolean(),
    selectable: z.boolean(),
    disabledReason: z.string().nullable(),
    lastError: z.string().nullable(),
    system: z.boolean().optional(),
    locked: z.boolean().optional(),
    description: z.string().optional(),
    activeTodoId: z.string().nullable().optional(),
    activeTodoText: z.string().nullable().optional(),
    nextTodoId: z.string().nullable().optional(),
    nextTodoText: z.string().nullable().optional(),
    blockedReason: z.string().nullable().optional(),
    handoffSummary: z.string().nullable().optional(),
    completedTodoIds: z.array(z.string()).optional(),
    completedCount: z.number().int().nonnegative().optional(),
    totalCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const podMcpAvailabilityListRequestSchema = z
  .object({
    requestId: requestIdSchema,
    podId: podIdSchema,
    provider: providerSchema.optional(),
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
export type ManagedMcpRegistryInput = z.infer<
  typeof managedMcpRegistryInputSchema
>;
export type ManagedMcpRegistryItem = z.infer<
  typeof managedMcpRegistryItemSchema
>;
export type ManagedMcpRegistryListRequest = z.infer<
  typeof managedMcpRegistryListRequestSchema
>;
export type ManagedMcpRegistrySaveRequest = z.infer<
  typeof managedMcpRegistrySaveRequestSchema
>;
export type ManagedMcpRegistryDeleteRequest = z.infer<
  typeof managedMcpRegistryDeleteRequestSchema
>;
export type PodMcpAvailabilityItem = z.infer<
  typeof podMcpAvailabilityItemSchema
>;
export type PodMcpAvailabilityListRequest = z.infer<
  typeof podMcpAvailabilityListRequestSchema
>;
export type PodSetMcpServerNamesPayload = z.infer<
  typeof podSetMcpServerNamesSchema
>;
