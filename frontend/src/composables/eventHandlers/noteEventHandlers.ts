import { WebSocketResponseEvents } from "@/services/websocket";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import type { RepositoryNote } from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";

interface NoteHandlerConfig<TNote> {
  getStore: () => {
    addNoteFromEvent: (note: TNote) => void;
    updateNoteFromEvent: (note: TNote) => void;
    removeNoteFromEvent: (noteId: string) => void;
  };
}

type NotePayloadCreated<TNote> = BasePayload & {
  note?: TNote;
  canvasId: string;
};
type NotePayloadUpdated<TNote> = BasePayload & {
  note?: TNote;
  canvasId: string;
};
type NotePayloadDeleted = BasePayload & { noteId: string; canvasId: string };

function createNoteHandlers<TNote>(config: NoteHandlerConfig<TNote>): {
  created: (payload: NotePayloadCreated<TNote>) => void;
  updated: (payload: NotePayloadUpdated<TNote>) => void;
  deleted: (payload: NotePayloadDeleted) => void;
} {
  return {
    created: createUnifiedHandler<NotePayloadCreated<TNote>>((payload) => {
      if (payload.note) {
        config.getStore().addNoteFromEvent(payload.note);
      }
    }),
    updated: createUnifiedHandler<NotePayloadUpdated<TNote>>((payload) => {
      if (payload.note) {
        config.getStore().updateNoteFromEvent(payload.note);
      }
    }),
    deleted: createUnifiedHandler<NotePayloadDeleted>((payload) => {
      config.getStore().removeNoteFromEvent(payload.noteId);
    }),
  };
}

const repositoryNoteHandlers = createNoteHandlers<RepositoryNote>({
  getStore: useRepositoryStore,
});

const handleRepositoryDeleted = createUnifiedHandler<
  BasePayload & {
    repositoryId: string;
    deletedNoteIds?: string[];
    canvasId: string;
  }
>(
  (payload) => {
    useRepositoryStore().removeItemFromEvent(
      payload.repositoryId,
      payload.deletedNoteIds,
    );
  },
  { toastMessage: () => t("composable.eventHandler.repositoryDeleted") },
);

const handleRepositoryBranchChanged = createUnifiedHandler<
  BasePayload & { repositoryId: string; branchName: string }
>(
  (payload) => {
    if (!payload.branchName || !/^[a-zA-Z0-9_\-/]+$/.test(payload.branchName))
      return;

    useRepositoryStore().updateCurrentBranch(
      payload.repositoryId,
      payload.branchName,
    );
  },
  { skipCanvasCheck: true },
);

export function getNoteEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.REPOSITORY_DELETED,
      handler: handleRepositoryDeleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED,
      handler: handleRepositoryBranchChanged as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
      handler: repositoryNoteHandlers.created as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
      handler: repositoryNoteHandlers.updated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
      handler: repositoryNoteHandlers.deleted as (payload: unknown) => void,
    },
  ];
}
