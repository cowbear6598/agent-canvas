import { WebSocketResponseEvents } from "@/services/websocket";
import { usePodStore } from "@/stores/pod/podStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useChatStore } from "@/stores/chat/chatStore";
import type { Pod } from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";

type DeletedNoteIds = {
  repositoryNote?: string[];
  commandNote?: string[];
};

const noteTypeHandlers: {
  key: keyof DeletedNoteIds;
  getStore: () => { removeNoteFromEvent: (id: string) => void };
}[] = [
  { key: "repositoryNote", getStore: () => useRepositoryStore() },
  { key: "commandNote", getStore: () => useCommandStore() },
];

export const removeDeletedNotes = (
  deletedNoteIds: DeletedNoteIds | undefined,
): void => {
  if (!deletedNoteIds) return;

  for (const { key, getStore } of noteTypeHandlers) {
    const ids = deletedNoteIds[key];
    if (!ids || ids.length === 0) continue;

    const store = getStore();
    ids.forEach((noteId) => store.removeNoteFromEvent(noteId));
  }
};

const handlePodCreated = createUnifiedHandler<
  BasePayload & { pod?: Pod; canvasId: string }
>(
  (payload) => {
    if (payload.pod) {
      usePodStore().addPodFromEvent(payload.pod);
    }
  },
  { toastMessage: () => t("composable.eventHandler.podCreated") },
);

const handlePodMoved = createUnifiedHandler<
  BasePayload & { pod?: Pod; canvasId: string }
>((payload) => {
  if (payload.pod) {
    usePodStore().updatePodPosition(
      payload.pod.id,
      payload.pod.x,
      payload.pod.y,
    );
  }
});

const handlePodRenamed = createUnifiedHandler<
  BasePayload & { podId: string; name: string; canvasId: string }
>(
  (payload) => {
    usePodStore().updatePodName(payload.podId, payload.name);
  },
  { toastMessage: () => t("composable.eventHandler.podRenamed") },
);

const handlePodModelSet = createUnifiedHandler<
  BasePayload & { pod?: Pod; canvasId: string }
>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod);
    }
  },
  { toastMessage: () => t("composable.eventHandler.podModelSet") },
);

const handlePodScheduleSet = createUnifiedHandler<
  BasePayload & { pod?: Pod; canvasId: string }
>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod);
    }
  },
  { toastMessage: () => t("composable.eventHandler.podScheduleSet") },
);

const handlePodDeleted = createUnifiedHandler<
  BasePayload & {
    podId: string;
    canvasId: string;
    deletedNoteIds?: DeletedNoteIds;
  }
>(
  (payload) => {
    usePodStore().removePod(payload.podId);
    removeDeletedNotes(payload.deletedNoteIds);
  },
  { toastMessage: () => t("composable.eventHandler.podDeleted") },
);

const handlePodStateUpdated = createUnifiedHandler<
  BasePayload & { pod?: Pod; canvasId: string }
>((payload) => {
  if (payload.pod) {
    usePodStore().updatePod(payload.pod);
  }
});

const handleWorkflowClearResult = createUnifiedHandler<
  BasePayload & { canvasId: string; clearedPodIds?: string[] }
>(
  (payload) => {
    if (payload.clearedPodIds) {
      const chatStore = useChatStore();
      chatStore.clearMessagesByPodIds(payload.clearedPodIds);

      const podStore = usePodStore();
      podStore.clearPodOutputsByIds(payload.clearedPodIds);
    }
  },
  { toastMessage: () => t("composable.eventHandler.workflowCleared") },
);

/**
 * 多人協作同步：當其他 client 切換 Pod 的 Plugin 時，
 * 更新本地 podStore 狀態，避免各 client 之間狀態不同步。
 * payload.pod 包含後端廣播的完整 PodPublicView，取 pluginIds 欄位更新本地。
 */
const handlePodPluginsSet = (payload: {
  requestId?: string;
  canvasId?: string;
  success?: boolean;
  pod?: Pod;
}): void => {
  if (
    !payload.success ||
    !payload.pod?.id ||
    !Array.isArray(payload.pod.pluginIds)
  )
    return;
  usePodStore().updatePodPlugins(payload.pod.id, payload.pod.pluginIds);
};

/**
 * 多人協作同步：當其他 client 更新 Pod 的 MCP server 名稱清單時，
 * 更新本地 podStore 狀態，避免各 client 之間狀態不同步。
 */
const handlePodMcpServerNamesUpdated = (payload: {
  requestId?: string;
  canvasId?: string;
  podId?: string;
  success?: boolean;
  mcpServerNames?: string[];
}): void => {
  // 非廣播事件（requestId 對應自己的請求）由 mcpApi.ts 處理，此處統一更新所有來源
  if (!payload.podId || !Array.isArray(payload.mcpServerNames)) return;
  usePodStore().updatePodMcpServers(payload.podId, payload.mcpServerNames);
};

export const handlePodChatUserMessage = (payload: {
  podId: string;
  messageId: string;
  content: string;
  timestamp: string;
}): void => {
  const chatStore = useChatStore();
  chatStore.addRemoteUserMessage(
    payload.podId,
    payload.messageId,
    payload.content,
    payload.timestamp,
  );
};

export function getPodEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.POD_CREATED,
      handler: handlePodCreated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MOVED,
      handler: handlePodMoved as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_RENAMED,
      handler: handlePodRenamed as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MODEL_SET,
      handler: handlePodModelSet as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_SCHEDULE_SET,
      handler: handlePodScheduleSet as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_DELETED,
      handler: handlePodDeleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_REPOSITORY_BOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_REPOSITORY_UNBOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_COMMAND_BOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_COMMAND_UNBOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MULTI_INSTANCE_SET,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
      handler: handleWorkflowClearResult as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      handler: handlePodMcpServerNamesUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_PLUGINS_SET,
      handler: handlePodPluginsSet as (payload: unknown) => void,
    },
  ];
}
