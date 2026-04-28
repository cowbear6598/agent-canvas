import {
  WebSocketResponseEvents,
  GroupCreatePayload,
  GroupListPayload,
  GroupDeletePayload,
} from "../schemas";
import { groupStore } from "../services/groupStore.js";
import {
  emitError,
  emitSuccess,
  emitNotFound,
} from "../utils/websocketResponse.js";
import { createI18nError } from "../utils/i18nError.js";
import { socketService } from "../services/socketService.js";

export async function handleGroupCreate(
  connectionId: string,
  payload: GroupCreatePayload,
  requestId: string,
): Promise<void> {
  const { canvasId, name, type } = payload;

  const exists = await groupStore.exists(name, type);
  if (exists) {
    emitError(
      connectionId,
      WebSocketResponseEvents.GROUP_CREATED,
      createI18nError("errors.groupNameExists"),
      null,
      requestId,
      undefined,
      "ALREADY_EXISTS",
    );
    return;
  }

  const group = await groupStore.create(name, type);

  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.GROUP_CREATED, {
    requestId,
    success: true,
    group,
  });
}

export async function handleGroupList(
  connectionId: string,
  payload: GroupListPayload,
  requestId: string,
): Promise<void> {
  const { type } = payload;

  const groups = await groupStore.list(type);

  emitSuccess(connectionId, WebSocketResponseEvents.GROUP_LIST_RESULT, {
    requestId,
    success: true,
    groups,
  });
}

export async function handleGroupDelete(
  connectionId: string,
  payload: GroupDeletePayload,
  requestId: string,
): Promise<void> {
  const { canvasId, groupId } = payload;

  const isCommand = await checkIsCommandGroup(groupId);
  if (!isCommand) {
    emitNotFound(
      connectionId,
      WebSocketResponseEvents.GROUP_DELETED,
      "Group",
      groupId,
      requestId,
      null,
    );
    return;
  }

  // 目前 codebase 僅有 "command" 一種 groupType，已由 checkIsCommandGroup 確認
  const hasItems = await groupStore.hasItems(groupId, "command");
  if (hasItems) {
    emitError(
      connectionId,
      WebSocketResponseEvents.GROUP_DELETED,
      createI18nError("errors.groupNotEmpty"),
      null,
      requestId,
      undefined,
      "GROUP_NOT_EMPTY",
    );
    return;
  }

  const deleted = await groupStore.delete(groupId, "command");
  if (!deleted) {
    emitNotFound(
      connectionId,
      WebSocketResponseEvents.GROUP_DELETED,
      "Group",
      groupId,
      requestId,
      null,
    );
    return;
  }

  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.GROUP_DELETED, {
    requestId,
    success: true,
    groupId,
  });
}

/**
 * 確認指定 group 是否為 command 類型。
 * 目前 codebase 僅有 "command" 一種 groupType，未來新增其他類型時需擴充此函式。
 */
async function checkIsCommandGroup(groupId: string): Promise<boolean> {
  return groupStore.exists(groupId, "command");
}
