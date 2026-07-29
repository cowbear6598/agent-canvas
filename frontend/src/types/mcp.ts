export type McpTransport = "stdio" | "http" | "sse";

export type McpDisplayStatus =
  | "healthy"
  | "starting"
  | "error"
  | "idle"
  | "disabled"
  | "unknown"
  | "running"
  | "blocked"
  | "completed";

/**
 * Header managed MCP modal 使用的 registry item。
 * 專注描述已註冊的 MCP 設定與最近一次 runtime 狀態。
 */
export interface ManagedMcpRegistryItem {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command: string | null;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  url: string | null;
  status: McpDisplayStatus;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  requiresSecretSetup?: boolean;
}

interface ManagedMcpRegistryBaseInput {
  id?: string;
  name: string;
  enabled: boolean;
}

export type ManagedMcpRegistryInput =
  | (ManagedMcpRegistryBaseInput & {
      transport: "stdio";
      command: string;
      args?: string[];
      cwd?: string | null;
      env?: Record<string, string>;
      url?: never;
    })
  | (ManagedMcpRegistryBaseInput & {
      transport: "http" | "sse";
      url: string;
      command?: never;
      args?: never;
      cwd?: never;
      env?: never;
    });

/**
 * Pod popover 使用的 availability item。
 * 描述在特定 Pod / provider 下是否可選、是否已選取，以及顯示所需的狀態資訊。
 */
export interface PodMcpAvailabilityItem {
  name: string;
  transport?: McpTransport;
  status?: McpDisplayStatus;
  selected?: boolean;
  selectable?: boolean;
  disabledReason?: string | null;
  lastError?: string | null;
  system?: boolean;
  locked?: boolean;
  description?: string;
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
