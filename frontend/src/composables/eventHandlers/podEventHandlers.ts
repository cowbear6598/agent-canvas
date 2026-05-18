import { WebSocketResponseEvents } from "@/services/websocket";
import { usePodStore } from "@/stores/pod/podStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import type { Pod } from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";
import { invalidatePodMcpAvailabilityCache } from "@/services/managedMcpApi";

type DeletedNoteIds = {
  repositoryNote?: string[];
};

const noteTypeHandlers: {
  noteType: keyof DeletedNoteIds;
  getStore: () => { removeNoteFromEvent: (id: string) => void };
}[] = [
  { noteType: "repositoryNote", getStore: () => useRepositoryStore() },
];

export const removeDeletedNotes = (
  deletedNoteIds: DeletedNoteIds | undefined,
): void => {
  if (!deletedNoteIds) return;

  for (const { noteType, getStore } of noteTypeHandlers) {
    const ids = deletedNoteIds[noteType];
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

/**
 * 多人協作同步：當其他 client 切換 Pod 的 Plugin 時，
 * 更新本地 podStore 狀態，避免各 client 之間狀態不同步。
 * payload.pod 包含後端廣播的完整 PodPublicView，取 pluginIds 欄位更新本地。
 */
const handlePodPluginsSet = createUnifiedHandler<
  BasePayload & { canvasId: string; success?: boolean; pod?: Pod }
>((payload) => {
  if (
    !payload.success ||
    !payload.pod?.id ||
    !Array.isArray(payload.pod.pluginIds) ||
    !payload.pod.pluginIds.every((id) => typeof id === "string")
  )
    return;
  usePodStore().updatePodPlugins(payload.pod.id, payload.pod.pluginIds);
});

/**
 * 多人協作同步：當其他 client 更新 Pod 的 MCP server 名稱清單時，
 * 更新本地 podStore 狀態，避免各 client 之間狀態不同步。
 * @internal mcpApi.ts 僅處理自己發出的請求回應；此 handler 負責廣播給所有連線的更新。
 */
const handlePodMcpServerNamesUpdated = createUnifiedHandler<
  BasePayload & {
    canvasId: string;
    podId?: string;
    mcpServerNames?: string[];
  }
>((payload) => {
  if (
    !payload.podId ||
    !Array.isArray(payload.mcpServerNames) ||
    !payload.mcpServerNames.every((n) => typeof n === "string")
  )
    return;
  invalidatePodMcpAvailabilityCache(undefined, payload.podId);
  usePodStore().updatePodMcpServers(payload.podId, payload.mcpServerNames);
});

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
      event: WebSocketResponseEvents.POD_GOAL_SET,
      handler: handlePodStateUpdated as (payload: unknown) => void,
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
      event: WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      handler: handlePodMcpServerNamesUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_PLUGINS_SET,
      handler: handlePodPluginsSet as (payload: unknown) => void,
    },
  ];
}
