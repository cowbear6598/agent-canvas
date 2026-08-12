import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  ManagedMcpRegistryDeleteRequest,
  ManagedMcpRegistryInput,
  ManagedMcpRegistryListRequest,
  ManagedMcpRegistrySaveRequest,
  ManagedMcpRegistryTestRequest,
  PodMcpAvailabilityListRequest,
  PodSetMcpServerNamesPayload,
} from "../schemas/mcpSchemas.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
} from "../services/mcp/managedMcpStore.js";
import { managedMcpRuntimeService } from "../services/mcp/managedMcpRuntimeService.js";
import { managedMcpAvailabilityService } from "../services/mcp/managedMcpAvailabilityService.js";
import { podStore } from "../services/podStore.js";
import { socketService } from "../services/socketService.js";
import { createI18nError } from "../utils/i18nError.js";
import { emitError, emitNotFound } from "../utils/websocketResponse.js";
import { getCanvasId } from "../utils/handlerHelpers.js";
import { logger } from "../utils/logger.js";

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

export async function handleManagedMcpRegistryList(
  connectionId: string,
  _payload: ManagedMcpRegistryListRequest,
  requestId: string,
): Promise<void> {
  const items = managedMcpStore
    .list()
    .map((entry) => toManagedMcpRegistryItem(entry));

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

/**
 * 手動觸發 entry probe（test connection 按鈕）。
 *
 * 流程：
 * 1. 找出 entry（不存在則 notFound）
 * 2. markConfigDirty → 強制下一次 ensureReady 重新 probe
 * 3. ensureReady：實際做 connect → listTools，回傳結果 snapshot
 * 4. 回傳 result 給觸發者；同時廣播 registry updated 讓其他 client 同步 lastError
 */
export async function handleManagedMcpRegistryTest(
  connectionId: string,
  payload: ManagedMcpRegistryTestRequest,
  requestId: string,
): Promise<void> {
  const entry = managedMcpStore.getById(payload.registryId);
  if (!entry) {
    emitNotFound(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      "ManagedMcpRegistry",
      payload.registryId,
      requestId,
      null,
    );
    return;
  }

  try {
    await managedMcpRuntimeService.markConfigDirty(entry.name);
    const snapshot = await managedMcpRuntimeService.ensureReady(entry.name);

    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      {
        requestId,
        success: snapshot.status === "healthy",
        registryId: entry.id,
        status: snapshot.status,
        lastError: snapshot.lastError,
      },
    );

    // 廣播 registry updated → 其他 client 重新拉 list 取得最新 status / lastError
    socketService.emitToAll(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      {
        requestId,
        success: true,
        action: "diagnostics",
        registryId: entry.id,
      },
    );
  } catch (error) {
    emitError(
      connectionId,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      error instanceof Error ? error : new Error("managed MCP test failed"),
      null,
      requestId,
      undefined,
      "MANAGED_MCP_TEST_FAILED",
    );
  }
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

  const items = managedMcpAvailabilityService.listForPod(podRef.pod);

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
 *
 * - pod 不存在 → i18nError
 * - self-healing：依 managed registry 過濾掉不存在 / 不可選的 name
 * - 寫入並廣播 POD_MCP_SERVER_NAMES_UPDATED
 *
 * 不再拒絕 active run 中的 pod：per-MCP entry 架構下，每次 provider.buildOptions
 * 會從 registry 重抓 pod.mcpServerNames，當下正在 stream 的 chat 仍鎖在 spawn 時的
 * 快照（不會被影響），下一個 turn / 下一個 pod 自動套用新設定。
 */
export async function handlePodSetMcpServerNames(
  connectionId: string,
  payload: PodSetMcpServerNamesPayload,
  requestId: string,
): Promise<void> {
  const { podId, mcpServerNames, agentCanvasMcpEnabled } = payload;

  // 取得 canvasId（未設定 active canvas 時 getCanvasId 已自動回傳 error）
  const canvasId = getCanvasId(
    connectionId,
    WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    requestId,
  );
  if (!canvasId) return;

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

  // self-healing：依 managed registry 過濾掉不可選的 name（已從 registry 刪除或被 disable），
  // 避免異常呼叫時繞過驗證。
  const availableNameSet = new Set(
    managedMcpAvailabilityService
      .listForPod(pod)
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

  podStore.setMcpServerNames(podId, validNames);
  if (agentCanvasMcpEnabled !== undefined) {
    podStore.update(canvasId, podId, { agentCanvasMcpEnabled });
  }

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
      agentCanvasMcpEnabled:
        agentCanvasMcpEnabled ?? pod.agentCanvasMcpEnabled,
      ignoredNames: invalidNames,
    },
  );
}
