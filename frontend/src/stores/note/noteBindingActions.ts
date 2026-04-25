import { createWebSocketRequest } from "@/services/websocket";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import type { NoteStoreConfig } from "./createNoteStore";
import type { BasePayload, BaseResponse } from "@/types";

interface Position {
  x: number;
  y: number;
}

export type UnbindBehavior =
  | { mode: "return-to-original" }
  | { mode: "move-to-position"; position: Position }
  | { mode: "stay-in-place" };

interface NoteItem {
  id: string;
  boundToPodId: string | null;
  x: number;
  y: number;
  originalPosition?: Position | null;
}

// 允許透過 config.itemIdField（如 'commandId'）進行動態 key 查找
// 與 NoteItem 分離，避免 index signature 擴散到使用 NoteItem 的介面
interface NoteItemWithDynamicKey extends NoteItem {
  [key: string]: unknown;
}

interface NoteBindingStore {
  notes: NoteItem[];
  getNotesByPodId: (podId: string) => NoteItem[];
  unbindFromPod?: (podId: string, behavior?: UnbindBehavior) => Promise<void>;
}

interface UnbindPositionPayload {
  canvasId: string;
  noteId: string;
  boundToPodId: null;
  originalPosition: null;
  x?: number;
  y?: number;
  // BasePayload 要求 index signature，才能作為 WebSocket payload 傳入
  [key: string]: unknown;
}

function resolveUnbindPosition(
  note: NoteItem,
  behavior: UnbindBehavior,
  canvasId: string,
  noteId: string,
): UnbindPositionPayload {
  const base: UnbindPositionPayload = {
    canvasId,
    noteId,
    boundToPodId: null,
    originalPosition: null,
  };

  if (behavior.mode === "return-to-original" && note.originalPosition) {
    base.x = note.originalPosition.x;
    base.y = note.originalPosition.y;
  } else if (behavior.mode === "move-to-position") {
    base.x = behavior.position.x;
    base.y = behavior.position.y;
  }

  return base;
}

interface OneToOneBindingConfig {
  relationship: NoteStoreConfig<unknown>["relationship"];
  unbindEvents?: NoteStoreConfig<unknown>["unbindEvents"];
}

async function unbindExistingIfOneToOne(
  store: NoteBindingStore,
  podId: string,
  config: OneToOneBindingConfig,
): Promise<void> {
  if (config.relationship !== "one-to-one") return;

  const existingNotes = store.getNotesByPodId(podId);
  if (existingNotes.length === 0 || !config.unbindEvents) return;

  await store.unbindFromPod!(podId, { mode: "return-to-original" });
}

export function createNoteBindingActions<TItem>(
  config: NoteStoreConfig<TItem>,
): {
  bindToPod: (
    this: NoteBindingStore,
    noteId: string,
    podId: string,
  ) => Promise<void>;
  unbindFromPod: (
    this: NoteBindingStore,
    podId: string,
    behavior?: UnbindBehavior,
  ) => Promise<void>;
} {
  return {
    async bindToPod(
      this: NoteBindingStore,
      noteId: string,
      podId: string,
    ): Promise<void> {
      const note = this.notes.find((note) => note.id === noteId);
      if (!note) return;

      await unbindExistingIfOneToOne(this, podId, config);

      const originalPosition = { x: note.x, y: note.y };

      if (!config.bindEvents) return;

      const canvasId = requireActiveCanvas();

      await Promise.all([
        createWebSocketRequest<BasePayload, BaseResponse>({
          requestEvent: config.bindEvents.request,
          responseEvent: config.bindEvents.response,
          payload: {
            canvasId,
            podId,
            [config.itemIdField]: (note as NoteItemWithDynamicKey)[
              config.itemIdField
            ],
          },
        }),
        createWebSocketRequest<BasePayload, BaseResponse>({
          requestEvent: config.events.updateNote.request,
          responseEvent: config.events.updateNote.response,
          payload: {
            canvasId,
            noteId,
            boundToPodId: podId,
            originalPosition,
          },
        }),
      ]);
    },

    async unbindFromPod(
      this: NoteBindingStore,
      podId: string,
      behavior: UnbindBehavior = { mode: "stay-in-place" },
    ): Promise<void> {
      if (!config.unbindEvents || config.relationship !== "one-to-one") return;

      const notes = this.getNotesByPodId(podId);
      const note = notes[0];
      if (!note) return;

      const noteId = note.id;
      const canvasId = requireActiveCanvas();
      const updatePayload = resolveUnbindPosition(
        note,
        behavior,
        canvasId,
        noteId,
      );

      await Promise.all([
        createWebSocketRequest<BasePayload, BaseResponse>({
          requestEvent: config.unbindEvents.request,
          responseEvent: config.unbindEvents.response,
          payload: {
            canvasId,
            podId,
          },
        }),
        createWebSocketRequest<BasePayload, BaseResponse>({
          requestEvent: config.events.updateNote.request,
          responseEvent: config.events.updateNote.response,
          payload: updatePayload,
        }),
      ]);
    },
  };
}
