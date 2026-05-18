import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  ManagedMcpRegistryDeleteRequest,
  ManagedMcpRegistryInput,
  ManagedMcpRegistryListRequest,
  ManagedMcpRegistrySaveRequest,
  McpListRequest,
  PodMcpAvailabilityListRequest,
  PodSetMcpServerNamesPayload,
} from "../schemas/mcpSchemas.js";
import { readClaudeMcpServers } from "../services/mcp/claudeMcpReader.js";
import { readCodexMcpServers } from "../services/mcp/codexMcpReader.js";
import { readOpencodeMcpServers } from "../services/mcp/opencodeMcpReader.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
} from "../services/mcp/managedMcpStore.js";
import { managedMcpRuntimeService } from "../services/mcp/managedMcpRuntimeService.js";
import { managedMcpAvailabilityService } from "../services/mcp/managedMcpAvailabilityService.js";
import { buildGoalRuntimeMcpListItem } from "../services/goalRuntime.js";
import { podStore } from "../services/podStore.js";
import { runStore } from "../services/runStore.js";
import { socketService } from "../services/socketService.js";
import { createI18nError } from "../utils/i18nError.js";
import { emitError, emitNotFound } from "../utils/websocketResponse.js";
import { getCanvasId } from "../utils/handlerHelpers.js";
import { logger } from "../utils/logger.js";
import type { ProviderName } from "../services/provider/index.js";

/**
 * 依 provider 分派到對應的 reader，回傳可用的 MCP server 清單。
 * - claude    → readClaudeMcpServers（僅 user-scoped，name 欄位，無 type）
 * - codex     → readCodexMcpServers（回傳 { name, type }）
 * - opencode  → readOpencodeMcpServers（回傳 { name, type }）
 */
function resolveAvailableMcpServers(
  provider: ProviderName,
  podId?: string,
): Array<{
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
}> {
  const pod = podId ? podStore.getByIdGlobal(podId)?.pod : null;
  const builtinGoal = pod ? buildGoalRuntimeMcpListItem(pod) : null;

  const builtinItems = builtinGoal ? [builtinGoal] : [];

  if (provider === "claude") {
    const servers = readClaudeMcpServers();
    return [
      ...builtinItems,
      ...servers.map(({ name }) => ({ name })),
    ];
  } else if (provider === "opencode") {
    return [...builtinItems, ...readOpencodeMcpServers()];
  } else {
    const servers = readCodexMcpServers();
    return [
      ...builtinItems,
      ...servers.map(({ name, type }) => ({ name, type })),
    ];
  }
}

function toManagedMcpRegistryItem(entry: ManagedMcpServerRecord): {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
  command: string | null;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  url: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: entry.id,
    name: entry.name,
    transport: entry.transport,
    enabled: entry.enabled,
    command: entry.command,
    args: entry.args,
    cwd: entry.cwd,
    env: entry.env,
    url: entry.url,
    status: entry.lastKnownStatus,
    lastError: entry.lastError,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * handleMcpList：依 provider 分派到對應的 reader，回傳 MCP_LIST_RESULT。
 * - provider = "claude"    → readClaudeMcpServers（僅 user-scoped，從 top-level mcpServers 讀取）
 * - provider = "codex"     → readCodexMcpServers（回傳 { name, type }[]）
 * - provider = "opencode"  → readOpencodeMcpServers（讀取 ~/.config/opencode/opencode.json mcp 區塊）
 * 統一對應 mcpListItemSchema 格式後回傳。
 */
export async function handleMcpList(
  connectionId: string,
  payload: McpListRequest,
  requestId: string,
): Promise<void> {
  const { provider } = payload;
  const podId = typeof payload.podId === "string" ? payload.podId : undefined;

  const items = resolveAvailableMcpServers(provider, podId);

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.MCP_LIST_RESULT,
    {
      requestId,
      success: true,
      provider,
      items,
    },
  );
}

export async function handleManagedMcpRegistryList(
  connectionId: string,
  _payload: ManagedMcpRegistryListRequest,
  requestId: string,
): Promise<void> {
  const items = managedMcpStore.list().map((entry) => toManagedMcpRegistryItem(entry));

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
    {
      requestId,
      success: true,
      items,
    },
  );
}

export async function handleManagedMcpRegistrySave(
  connectionId: string,
  payload: ManagedMcpRegistrySaveRequest,
  requestId: string,
): Promise<void> {
  try {
    const previous = payload.registry.id
      ? managedMcpStore.getById(payload.registry.id)
      : undefined;
    const saved = managedMcpStore.save(
      payload.registry as ManagedMcpRegistryInput,
    );
    if (previous?.name) {
      await managedMcpRuntimeService.markConfigDirty(previous.name);
    }
    await managedMcpRuntimeService.markConfigDirty(saved.name);

    const item = toManagedMcpRegistryItem(
      managedMcpStore.getById(saved.id) ?? saved,
    );

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      {
        requestId,
        success: true,
        item,
      },
    );
    socketService.emitToAll(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      {
        requestId,
        success: true,
        action: "saved",
        registryId: item.id,
        item,
      },
    );
  } catch (error) {
    emitError(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      error instanceof Error ? error : new Error("managed MCP save failed"),
      null,
      requestId,
      undefined,
      "MANAGED_MCP_SAVE_FAILED",
    );
  }
}

export async function handleManagedMcpRegistryDelete(
  connectionId: string,
  payload: ManagedMcpRegistryDeleteRequest,
  requestId: string,
): Promise<void> {
  const existing = managedMcpStore.getById(payload.registryId);
  if (!existing) {
    emitNotFound(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
      "ManagedMcpRegistry",
      payload.registryId,
      requestId,
      null,
    );
    return;
  }

  managedMcpStore.delete(payload.registryId);
  await managedMcpRuntimeService.markConfigDirty(existing.name);

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
    {
      requestId,
      success: true,
      registryId: payload.registryId,
    },
  );
  socketService.emitToAll(
    WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
    {
      requestId,
      success: true,
      action: "deleted",
      registryId: payload.registryId,
    },
  );
}

export async function handlePodMcpAvailabilityList(
  connectionId: string,
  payload: PodMcpAvailabilityListRequest,
  requestId: string,
): Promise<void> {
  const podRef = podStore.getByIdGlobal(payload.podId);
  if (!podRef) {
    emitNotFound(
      connectionId,
      WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
      "Pod",
      payload.podId,
      requestId,
      null,
    );
    return;
  }

  const items = managedMcpAvailabilityService.listForPod(
    podRef.pod,
    payload.provider,
  );

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
    {
      requestId,
      success: true,
      podId: payload.podId,
      items,
    },
  );
}

/**
 * handlePodSetMcpServerNames：設定指定 pod 的 MCP server 名稱清單。
 * - pod 不存在 → i18nError
 * - pod busy → 拒絕並 i18nError
 * - self-healing：過濾掉 ~/.claude.json 不存在的 name
 * - 寫入並廣播 POD_MCP_SERVER_NAMES_UPDATED
 */
export async function handlePodSetMcpServerNames(
  connectionId: string,
  payload: PodSetMcpServerNamesPayload,
  requestId: string,
): Promise<void> {
  const { podId, mcpServerNames } = payload;

  // 取得 canvasId（未設定 active canvas 時 getCanvasId 已自動回傳 error）
  const canvasId = getCanvasId(
    connectionId,
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    requestId,
  );
  if (!canvasId) return;

  // 驗證 pod 是否存在
  const pod = podStore.getById(canvasId, podId);
  if (!pod) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      createI18nError("errors.notFound", { entity: "Pod", id: podId }),
      canvasId,
      requestId,
      podId,
      "NOT_FOUND",
    );
    return;
  }

  // pod 有 active run 時拒絕變更
  if (runStore.hasActiveRunForPod(podId)) {
    emitError(
      connectionId,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      createI18nError("errors.podBusy", { id: podId }),
      canvasId,
      requestId,
      podId,
      "POD_BUSY",
    );
    return;
  }

  // self-healing：依 provider 讀取對應的可用 MCP server 清單，
  // 過濾掉已不存在的 name（例如使用者在外部刪除了 settings.json 中的 server）
  // Codex popover 為唯讀，理論上不會觸發此事件；
  // 仍統一走 resolveAvailableMcpServers 過濾，避免異常呼叫時繞過驗證
  const availableNameSet = new Set(
    managedMcpAvailabilityService
      .listForPod(pod, pod.provider)
      .filter((item) => !item.system && !item.locked && item.selectable)
      .map((item) => item.name),
  );

  const invalidNames = mcpServerNames.filter((n) => !availableNameSet.has(n));
  if (invalidNames.length > 0) {
    logger.warn(
      "Pod",
      "Warn",
      `handlePodSetMcpServerNames：略過不存在的 MCP server name（已遮罩，共 ${invalidNames.length} 筆）`,
    );
  }
  const validNames = mcpServerNames.filter((n) => availableNameSet.has(n));

  // 寫入 podStore
  podStore.setMcpServerNames(podId, validNames);

  // 廣播 POD_MCP_SERVER_NAMES_UPDATED 給 canvas 所有連線
  // ignoredNames：被過濾掉的 name 清單，前端可據此提示使用者
  socketService.emitToCanvas(
    canvasId,
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    {
      requestId,
      canvasId,
      podId,
      success: true,
      mcpServerNames: validNames,
      ignoredNames: invalidNames,
    },
  );
}
