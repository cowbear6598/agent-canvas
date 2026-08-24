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
/**
 * 系統保留的 MCP server name 清單，使用者不能在 managed registry 註冊同名 entry。
 * - agent_canvas_managed_surface：per-run aggregated surface 注入到 provider 的名稱
 * - agent_canvas_goal：Goal Runtime built-in MCP 名稱
 * - agent_canvas_plugin：Plugin MCP bridge 注入到 provider 的名稱
 */
export const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  "agent_canvas_managed_surface",
  "agent_canvas_goal",
  "agent_canvas_plugin",
  "agent_canvas",
]);

/**
 * env key 黑名單：被列入後使用者無法在 entry env 設置這些 key。
 * 動機：
 * - PATH：誤把 PATH 寫死容易讓 spawn 找不到 binary，且 PATH 應由 backend 控制；
 * - LD_PRELOAD / LD_LIBRARY_PATH / DYLD_*：dynamic loader 注入 vector，
 *   雖然 spawn 為 child process 獨立 env，仍視為 foot-gun 預防。
 *
 * 注意：blocklist 屬 defense-in-depth；註冊 MCP 本身允許執行任意 binary，
 * 真正的權限控管請依賴 auth/RBAC 層。
 */
const ENV_KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_KEY_BLOCKLIST_EXACT = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
]);
const ENV_KEY_BLOCKLIST_PREFIX = ["DYLD_"];

function isEnvKeyBlocked(rawKey: string): boolean {
  const key = rawKey.toUpperCase();
  if (ENV_KEY_BLOCKLIST_EXACT.has(key)) return true;
  return ENV_KEY_BLOCKLIST_PREFIX.some((prefix) => key.startsWith(prefix));
}

const managedMcpEnvSchema = z
  .record(
    z.string().min(1).max(128).regex(ENV_KEY_NAME_PATTERN),
    z.string().max(4096),
  )
  .refine((env) => Object.keys(env).length <= 32, {
    message: "env 最多 32 個 key",
  })
  .refine((env) => !Object.keys(env).some((key) => isEnvKeyBlocked(key)), {
    message:
      "env 含被禁止的 key（PATH / LD_PRELOAD / LD_LIBRARY_PATH / DYLD_*）",
  });
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
    env: managedMcpEnvSchema.optional(),
  })
  .strict();

const managedMcpRegistryRemoteSchema = managedMcpRegistryBaseSchema
  .extend({
    transport: z.enum(["http", "sse"]),
    url: z.url().max(2000),
  })
  .strict();

export const managedMcpRegistryInputSchema = z
  .discriminatedUnion("transport", [
    managedMcpRegistryStdioSchema,
    managedMcpRegistryRemoteSchema,
  ])
  .refine((input) => !RESERVED_MCP_SERVER_NAMES.has(input.name.trim()), {
    message: "name 為系統保留，請改用其他名稱",
    path: ["name"],
  });

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

export const managedMcpRegistryTestRequestSchema = z
  .object({
    requestId: requestIdSchema,
    registryId: z.uuid(),
  })
  .strict();

export const podMcpAvailabilityItemSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    source: z.enum(["official", "user", "canvas"]),
    transport: mcpTransportSchema,
    status: managedMcpStatusSchema,
    selected: z.boolean(),
    selectable: z.boolean(),
    disabledReason: z.string().nullable(),
    disabledReasonKey: z.enum(["codexGloballyDisabled"]).optional(),
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
    /** Codex 原生 MCP 穩定識別 key；與 Canvas managed name 分開儲存。 */
    codexMcpServerKeys: z.array(z.string().min(1).max(1000)).max(200).optional(),
    agentCanvasMcpEnabled: z.boolean().optional(),
  })
  .strict();

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
export type ManagedMcpRegistryTestRequest = z.infer<
  typeof managedMcpRegistryTestRequestSchema
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
