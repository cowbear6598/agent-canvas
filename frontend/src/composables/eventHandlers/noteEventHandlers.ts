import { WebSocketResponseEvents } from "@/services/websocket";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
import type {
  RepositoryNote,
  CommandNote,
  McpServer,
  McpServerNote,
} from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import { t } from "@/i18n";
import type { BasePayload } from "./sharedHandlerUtils";

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

function isValidStringField(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function validateIdAndName(
  id: unknown,
  name: unknown,
  context: string,
): boolean {
  if (!isValidStringField(id)) {
    console.error(`[Security] 無效的 ${context}.id 格式`);
    return false;
  }

  if (!isValidStringField(name)) {
    console.error(`[Security] 無效的 ${context}.name 格式`);
    return false;
  }

  return true;
}

function containsXssPattern(name: string): boolean {
  return /<script|javascript:|on\w+=/i.test(name);
}

type RepositoryItem = {
  id: string;
  name: string;
  parentRepoId?: string;
  branchName?: string;
};

const validateRepositoryItem = (repository: RepositoryItem): boolean => {
  if (!validateIdAndName(repository.id, repository.name, "repository"))
    return false;

  if (containsXssPattern(repository.name)) {
    console.error("[Security] 潛在惡意的 repository.name:", repository.name);
    return false;
  }

  return true;
};

const validateMcpServer = (mcpServer: McpServer): boolean => {
  if (!validateIdAndName(mcpServer.id, mcpServer.name, "mcpServer"))
    return false;

  if (containsXssPattern(mcpServer.name)) {
    console.error("[Security] 潛在惡意的 mcpServer.name:", mcpServer.name);
    return false;
  }

  return true;
};

const repositoryNoteHandlers = createNoteHandlers<RepositoryNote>({
  getStore: useRepositoryStore,
});
const commandNoteHandlers = createNoteHandlers<CommandNote>({
  getStore: useCommandStore,
});
const mcpServerNoteHandlers = createNoteHandlers<McpServerNote>({
  getStore: useMcpServerStore,
});

const handleRepositoryWorktreeCreated = createUnifiedHandler<
  BasePayload & { repository?: RepositoryItem; canvasId: string }
>(
  (payload) => {
    if (payload.repository && validateRepositoryItem(payload.repository)) {
      useRepositoryStore().addItemFromEvent(payload.repository);
    }
  },
  { toastMessage: () => t("composable.eventHandler.worktreeCreated") },
);

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

const handleCommandDeleted = createUnifiedHandler<
  BasePayload & {
    commandId: string;
    deletedNoteIds?: string[];
    canvasId: string;
  }
>(
  (payload) => {
    useCommandStore().removeItemFromEvent(
      payload.commandId,
      payload.deletedNoteIds,
    );
  },
  { toastMessage: () => t("composable.eventHandler.commandDeleted") },
);

const handleMcpServerCreated = createUnifiedHandler<
  BasePayload & { mcpServer?: McpServer; canvasId: string }
>(
  (payload) => {
    if (payload.mcpServer && validateMcpServer(payload.mcpServer)) {
      useMcpServerStore().addItemFromEvent(payload.mcpServer);
    }
  },
  { toastMessage: () => t("composable.eventHandler.mcpServerCreated") },
);

const handleMcpServerUpdated = createUnifiedHandler<
  BasePayload & { mcpServer?: McpServer; canvasId: string }
>(
  (payload) => {
    if (payload.mcpServer && validateMcpServer(payload.mcpServer)) {
      useMcpServerStore().updateItemFromEvent(payload.mcpServer);
    }
  },
  { toastMessage: () => t("composable.eventHandler.mcpServerUpdated") },
);

const handleMcpServerDeleted = createUnifiedHandler<
  BasePayload & {
    mcpServerId: string;
    deletedNoteIds?: string[];
    canvasId: string;
  }
>(
  (payload) => {
    if (!payload.mcpServerId || typeof payload.mcpServerId !== "string") {
      console.error("[Security] 無效的 mcpServerId:", payload.mcpServerId);
      return;
    }
    useMcpServerStore().removeItemFromEvent(
      payload.mcpServerId,
      payload.deletedNoteIds,
    );
  },
  {
    toastMessage: () => t("composable.eventHandler.mcpServerDeleted"),
    skipCanvasCheck: true,
  },
);

export function getNoteEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED,
      handler: handleRepositoryWorktreeCreated as (payload: unknown) => void,
    },
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
    {
      event: WebSocketResponseEvents.COMMAND_DELETED,
      handler: handleCommandDeleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
      handler: commandNoteHandlers.created as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
      handler: commandNoteHandlers.updated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
      handler: commandNoteHandlers.deleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_CREATED,
      handler: handleMcpServerCreated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_UPDATED,
      handler: handleMcpServerUpdated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_DELETED,
      handler: handleMcpServerDeleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED,
      handler: mcpServerNoteHandlers.created as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_NOTE_UPDATED,
      handler: mcpServerNoteHandlers.updated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.MCP_SERVER_NOTE_DELETED,
      handler: mcpServerNoteHandlers.deleted as (payload: unknown) => void,
    },
  ];
}
