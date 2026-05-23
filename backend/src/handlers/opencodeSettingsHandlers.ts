import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  OpencodeServerRestartPayload,
  OpencodeServerRestartResultPayload,
  OpencodeProviderListPayload,
  OpencodeAliasesListPayload,
  OpencodeAliasesCreatePayload,
  OpencodeAliasesUpdatePayload,
  OpencodeAliasesDeletePayload,
  OpencodeAliasesReorderPayload,
  OpencodeAliasesRefreshPresetsPayload,
} from "../schemas/opencodeSettingsSchemas.js";
import {
  getOpencodeServerState,
  restartOpencodeServer,
} from "../services/provider/opencodeServer.js";
import { socketService } from "../services/socketService.js";
import {
  createOpencodeAlias,
  deleteOpencodeAlias,
  listOpencodeAliases,
  refreshOpencodeAliasPresets,
  reorderOpencodeAliases,
  resetOpencodeThinkingPresetSnapshotFetcher,
  setOpencodeThinkingPresetSnapshotFetcher,
  updateOpencodeAlias,
} from "../services/provider/opencodeAliasService.js";
import { listOpencodeProviders } from "../services/provider/opencodeProviderListService.js";
import { logger } from "../utils/logger.js";

export {
  resetOpencodeThinkingPresetSnapshotFetcher,
  setOpencodeThinkingPresetSnapshotFetcher,
};

/**
 * 先呼叫 restartOpencodeServer()（stop → start），完成後取得最新 state：
 * - status === "ready" → 回傳 success=true
 * - 其他（"failed" 等）→ 回傳 success=false，error.code = opencode_restart_failed。
 */
export async function handleOpencodeServerRestart(
  connectionId: string,
  _payload: OpencodeServerRestartPayload,
  requestId: string,
): Promise<void> {
  await restartOpencodeServer();

  const state = getOpencodeServerState();

  let response: OpencodeServerRestartResultPayload;

  if (state.status === "ready") {
    response = { requestId, success: true };
  } else {
    logger.error(
      "Integration",
      "Error",
      `opencode 重新啟動失敗（status=${state.status}）`,
      state.failureReason,
    );
    response = {
      requestId,
      success: false,
      error: {
        code: "opencode_restart_failed",
        message: "opencode 重新啟動失敗，請稍後再試",
      },
    };
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT,
    response,
  );
}

/**
 * 轉發 opencode GET /provider，取得 all/default/connected 後回傳前端需要的欄位。
 * - opencode server 尚未 ready → 回傳 success=false / opencode_server_not_ready
 * - ready → 呼叫 client.provider.list()，只回傳 id/name/models.id/name
 */
export async function handleOpencodeProviderList(
  connectionId: string,
  _payload: OpencodeProviderListPayload,
  requestId: string,
): Promise<void> {
  const result = await listOpencodeProviders();
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
    { requestId, ...result },
  );
}

/**
 * 列出 provider_id="opencode" 的所有 alias，依 order_idx 升序回傳。
 */
export async function handleOpencodeAliasesList(
  connectionId: string,
  _payload: OpencodeAliasesListPayload,
  requestId: string,
): Promise<void> {
  const result = await listOpencodeAliases();
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT,
    { requestId, ...result },
  );
}

export async function handleOpencodeAliasesCreate(
  connectionId: string,
  payload: OpencodeAliasesCreatePayload,
  requestId: string,
): Promise<void> {
  const result = await createOpencodeAlias(payload);
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
    { requestId, ...result },
  );
}

export async function handleOpencodeAliasesUpdate(
  connectionId: string,
  payload: OpencodeAliasesUpdatePayload,
  requestId: string,
): Promise<void> {
  const result = await updateOpencodeAlias(payload);
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
    { requestId, ...result },
  );
}

export async function handleOpencodeAliasesRefreshPresets(
  connectionId: string,
  payload: OpencodeAliasesRefreshPresetsPayload,
  requestId: string,
): Promise<void> {
  const result = await refreshOpencodeAliasPresets(payload);
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT,
    { requestId, ...result },
  );
}

export async function handleOpencodeAliasesDelete(
  connectionId: string,
  payload: OpencodeAliasesDeletePayload,
  requestId: string,
): Promise<void> {
  const result = await deleteOpencodeAlias(payload);
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
    { requestId, ...result },
  );
}

export async function handleOpencodeAliasesReorder(
  connectionId: string,
  payload: OpencodeAliasesReorderPayload,
  requestId: string,
): Promise<void> {
  const result = await reorderOpencodeAliases(payload);
  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
    { requestId, ...result },
  );
}
