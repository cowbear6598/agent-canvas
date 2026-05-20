import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  OpencodeProviderListResult,
  OpencodeProviderInfo,
  OpencodeModelInfo,
  OpencodeModelAlias,
} from "@/types/opencode";

// ─── 本地 Payload 型別定義 ──

interface OpencodeProviderListPayload {
  requestId: string;
}

interface OpencodeProviderListResultPayload extends OpencodeProviderListResult {
  requestId?: string;
  success?: boolean;
}

interface OpencodeAliasesListPayload {
  requestId: string;
}

interface OpencodeAliasesListResultPayload {
  requestId?: string;
  success?: boolean;
  items?: OpencodeModelAlias[];
}

interface OpencodeAliasesCreatePayload {
  requestId: string;
  providerID: string;
  modelID: string;
  alias: string;
  sortOrder: number;
}

interface OpencodeAliasesCreateResultPayload {
  requestId?: string;
  success?: boolean;
  item?: OpencodeModelAlias;
}

interface OpencodeAliasesUpdatePayload {
  requestId: string;
  id: string;
  modelID: string;
  alias: string;
}

interface OpencodeAliasesUpdateResultPayload {
  requestId?: string;
  success?: boolean;
  item?: OpencodeModelAlias;
}

interface OpencodeAliasesDeletePayload {
  requestId: string;
  id: string;
}

interface OpencodeAliasesDeleteResultPayload {
  requestId?: string;
  success?: boolean;
}

interface OpencodeAliasesReorderPayload {
  requestId: string;
  orderedIds: string[];
}

interface OpencodeAliasesReorderResultPayload {
  requestId?: string;
  success?: boolean;
  items?: OpencodeModelAlias[];
}

interface OpencodeServerRestartPayload {
  requestId: string;
}

interface OpencodeServerRestartResultPayload {
  requestId?: string;
  success?: boolean;
}

// ─── API 函式 ─────────────────────────────────────────────────────────────────

/**
 * 查詢 opencode 可用 Provider 列表（含模型清單、預設 provider、已連線清單）
 *
 * Normalize 後端原樣轉發的 opencode SDK 結構：SDK 回傳 `provider.models` 為
 * `Record<modelID, ModelInfo>`，前端統一轉成 `OpencodeModelInfo[]` 方便 v-for 使用。
 */
export async function listOpencodeProviders(): Promise<OpencodeProviderListResult> {
  // 後端 GET /provider 原樣轉發 SDK 結構，因此 models 在 wire 上可能是 Array 或 Record
  type RawProviderInfo = Omit<OpencodeProviderInfo, "models"> & {
    models: OpencodeModelInfo[] | Record<string, OpencodeModelInfo>;
  };
  type RawResult = Omit<OpencodeProviderListResultPayload, "all"> & {
    all: RawProviderInfo[];
  };

  const raw = await createWebSocketRequest<
    OpencodeProviderListPayload,
    RawResult
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_PROVIDER_LIST,
    responseEvent: WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
    payload: {},
  });

  return {
    all: raw.all.map((p) => ({
      ...p,
      models: Array.isArray(p.models)
        ? p.models
        : Object.values(p.models ?? {}),
    })),
    default: raw.default,
    connected: raw.connected,
  };
}

/**
 * 查詢 opencode model 別稱列表
 */
export async function listAliases(): Promise<OpencodeModelAlias[]> {
  const result = await createWebSocketRequest<
    OpencodeAliasesListPayload,
    OpencodeAliasesListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_ALIASES_LIST,
    responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT,
    payload: {},
  });

  return result.items ?? [];
}

/**
 * 新增 opencode model 別稱
 */
export async function createAlias(
  payload: Omit<OpencodeModelAlias, "id">,
): Promise<OpencodeModelAlias> {
  const result = await createWebSocketRequest<
    OpencodeAliasesCreatePayload,
    OpencodeAliasesCreateResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_ALIASES_CREATE,
    responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
    payload: {
      providerID: payload.providerID,
      modelID: payload.modelID,
      alias: payload.alias,
      sortOrder: payload.sortOrder,
    },
  });

  if (!result.item) {
    throw new Error("新增 opencode model 別稱失敗：後端未回傳 item");
  }

  return result.item;
}

/**
 * 更新 opencode model 別稱：只允許改 alias 與 modelID 對應；
 * sortOrder 由 reorderAliases API 獨立處理，不在此函式內。
 */
export async function updateAlias(
  payload: Pick<OpencodeModelAlias, "id" | "modelID" | "alias">,
): Promise<OpencodeModelAlias> {
  const result = await createWebSocketRequest<
    OpencodeAliasesUpdatePayload,
    OpencodeAliasesUpdateResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_ALIASES_UPDATE,
    responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
    payload: {
      id: payload.id,
      modelID: payload.modelID,
      alias: payload.alias,
    },
  });

  if (!result.item) {
    throw new Error("更新 opencode model 別稱失敗：後端未回傳 item");
  }

  return result.item;
}

/**
 * 刪除 opencode model 別稱
 */
export async function deleteAlias(id: string): Promise<void> {
  await createWebSocketRequest<
    OpencodeAliasesDeletePayload,
    OpencodeAliasesDeleteResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_ALIASES_DELETE,
    responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
    payload: { id },
  });
}

/**
 * 重啟 opencode 子程序
 */
export async function restartOpencodeServer(): Promise<void> {
  await createWebSocketRequest<
    OpencodeServerRestartPayload,
    OpencodeServerRestartResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_SERVER_RESTART,
    responseEvent: WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT,
    payload: {},
  });
}

/**
 * 重排 opencode model 別稱順序
 */
export async function reorderAliases(
  idsInOrder: string[],
): Promise<OpencodeModelAlias[]> {
  const result = await createWebSocketRequest<
    OpencodeAliasesReorderPayload,
    OpencodeAliasesReorderResultPayload
  >({
    requestEvent: WebSocketRequestEvents.OPENCODE_ALIASES_REORDER,
    responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
    payload: { orderedIds: idsInOrder },
  });

  return result.items ?? [];
}
