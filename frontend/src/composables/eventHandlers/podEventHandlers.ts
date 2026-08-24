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

const removeDeletedNotes = (
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
>((payload) => {
  if (payload.pod) {
    usePodStore().addPodFromEvent(payload.pod);
  }
});

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
>((payload) => {
  usePodStore().updatePodName(payload.podId, payload.name);
});

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
>((payload) => {
  if (payload.pod) {
    usePodStore().updatePod(payload.pod);
  }
});

const handlePodDeleted = createUnifiedHandler<
  BasePayload & {
    podId: string;
    canvasId: string;
    deletedNoteIds?: DeletedNoteIds;
  }
>((payload) => {
  usePodStore().removePod(payload.podId);
  removeDeletedNotes(payload.deletedNoteIds);
});

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

const handlePodCodexSkillsSet = createUnifiedHandler<
  BasePayload & { canvasId: string; success?: boolean; pod?: Pod }
>((payload) => {
  if (
    !payload.success ||
    !payload.pod?.id ||
    !Array.isArray(payload.pod.codexSkillKeys) ||
    !payload.pod.codexSkillKeys.every((key) => typeof key === "string")
  )
    return;
  usePodStore().updatePodCodexSkills(
    payload.pod.id,
    payload.pod.codexSkillKeys,
  );
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
    agentCanvasMcpEnabled?: boolean;
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
  if (typeof payload.agentCanvasMcpEnabled === "boolean") {
    usePodStore().updatePodAgentCanvasMcpEnabled(
      payload.podId,
      payload.agentCanvasMcpEnabled,
    );
  }
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
      event: WebSocketResponseEvents.POD_PROVIDER_SET,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MODEL_SET,
      handler: handlePodModelSet as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_FAST_MODE_SET,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_SCHEDULE_SET,
      handler: handlePodScheduleSet as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MEMORY_ENABLED_SET,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MEMORY_CLEARED,
      handler: handlePodStateUpdated as (payload: unknown) => void,
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
    {
      event: WebSocketResponseEvents.POD_CODEX_SKILLS_SET,
      handler: handlePodCodexSkillsSet as (payload: unknown) => void,
    },
  ];
}
