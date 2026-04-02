import { WebSocketResponseEvents } from "@/services/websocket";
import { usePodStore } from "@/stores/pod/podStore";
import { useOutputStyleStore } from "@/stores/note/outputStyleStore";
import { useSkillStore } from "@/stores/note/skillStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useSubAgentStore } from "@/stores/note/subAgentStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
import { useChatStore } from "@/stores/chat/chatStore";
import type { Pod } from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";

type DeletedNoteIds = {
  // 'note' 對應後端 PodDeletedPayload.deletedNoteIds.note，實際為 OutputStyleNote 的 ID 清單。
  // 此命名由後端 WebSocket 協議決定，前端不應單方面更改以避免協議不一致。
  note?: string[];
  skillNote?: string[];
  repositoryNote?: string[];
  commandNote?: string[];
  subAgentNote?: string[];
  mcpServerNote?: string[];
};

const noteTypeHandlers: {
  key: keyof DeletedNoteIds;
  getStore: () => { removeNoteFromEvent: (id: string) => void };
}[] = [
  { key: "note", getStore: () => useOutputStyleStore() },
  { key: "skillNote", getStore: () => useSkillStore() },
  { key: "repositoryNote", getStore: () => useRepositoryStore() },
  { key: "commandNote", getStore: () => useCommandStore() },
  { key: "subAgentNote", getStore: () => useSubAgentStore() },
  { key: "mcpServerNote", getStore: () => useMcpServerStore() },
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
      event: WebSocketResponseEvents.POD_OUTPUT_STYLE_BOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_OUTPUT_STYLE_UNBOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_SKILL_BOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
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
      event: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
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
      event: WebSocketResponseEvents.POD_MCP_SERVER_BOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND,
      handler: handlePodStateUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
      handler: handleWorkflowClearResult as (payload: unknown) => void,
    },
  ];
}
