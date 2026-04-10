import { WebSocketResponseEvents } from "@/services/websocket";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useOutputStyleStore } from "@/stores/note/outputStyleStore";
import { useSkillStore } from "@/stores/note/skillStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useSubAgentStore } from "@/stores/note/subAgentStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type {
  Pod,
  OutputStyleNote,
  SkillNote,
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  Canvas,
  McpServerNote,
  Connection,
} from "@/types";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";

type RawConnectionFromEvent = Omit<Connection, "status">;

const addCreatedItems = <T>(
  items: T[] | undefined,
  addFn: (item: T) => void,
): void => {
  if (items) {
    for (const item of items) {
      addFn(item);
    }
  }
};

const handleCanvasCreated = createUnifiedHandler<
  BasePayload & { canvas?: Canvas }
>(
  (payload) => {
    if (payload.canvas) {
      useCanvasStore().addCanvasFromEvent(payload.canvas);
    }
  },
  {
    toastMessage: () => t("composable.eventHandler.canvasCreated"),
    skipCanvasCheck: true,
  },
);

const handleCanvasRenamed = createUnifiedHandler<
  BasePayload & { canvasId: string; newName: string }
>(
  (payload) => {
    useCanvasStore().renameCanvasFromEvent(payload.canvasId, payload.newName);
  },
  { toastMessage: () => t("composable.eventHandler.canvasRenamed"), skipCanvasCheck: true },
);

const handleCanvasDeleted = createUnifiedHandler<
  BasePayload & { canvasId: string }
>(
  (payload) => {
    useCanvasStore().removeCanvasFromEvent(payload.canvasId);
  },
  { skipCanvasCheck: true },
);

const handleCanvasReordered = createUnifiedHandler<
  BasePayload & { canvasIds: string[] }
>(
  (payload) => {
    useCanvasStore().reorderCanvasesFromEvent(payload.canvasIds);
  },
  { skipCanvasCheck: true },
);

const handleCanvasPasted = createUnifiedHandler<
  BasePayload & {
    canvasId: string;
    createdPods?: Pod[];
    createdOutputStyleNotes?: OutputStyleNote[];
    createdSkillNotes?: SkillNote[];
    createdRepositoryNotes?: RepositoryNote[];
    createdSubAgentNotes?: SubAgentNote[];
    createdCommandNotes?: CommandNote[];
    createdMcpServerNotes?: McpServerNote[];
    createdConnections?: RawConnectionFromEvent[];
  }
>(
  (payload) => {
    const podStore = usePodStore();
    const connectionStore = useConnectionStore();
    const outputStyleStore = useOutputStyleStore();
    const skillStore = useSkillStore();
    const repositoryStore = useRepositoryStore();
    const subAgentStore = useSubAgentStore();
    const commandStore = useCommandStore();
    const mcpServerStore = useMcpServerStore();

    addCreatedItems(payload.createdPods, (pod) =>
      podStore.addPodFromEvent(pod),
    );
    addCreatedItems(payload.createdOutputStyleNotes, (note) =>
      outputStyleStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdSkillNotes, (note) =>
      skillStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdRepositoryNotes, (note) =>
      repositoryStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdSubAgentNotes, (note) =>
      subAgentStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdCommandNotes, (note) =>
      commandStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdMcpServerNotes, (note) =>
      mcpServerStore.addNoteFromEvent(note),
    );
    addCreatedItems(payload.createdConnections, (connection) =>
      connectionStore.addConnectionFromEvent(connection),
    );
  },
  { toastMessage: () => t("composable.eventHandler.pasted") },
);

export function getCanvasEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.CANVAS_CREATED,
      handler: handleCanvasCreated as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CANVAS_RENAMED,
      handler: handleCanvasRenamed as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CANVAS_DELETED,
      handler: handleCanvasDeleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CANVAS_REORDERED,
      handler: handleCanvasReordered as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.CANVAS_PASTE_RESULT,
      handler: handleCanvasPasted as (payload: unknown) => void,
    },
  ];
}
