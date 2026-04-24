import { defineStore } from "pinia";
import type { BaseNote, Pod, Group, BasePayload, BaseResponse } from "@/types";
import { createWebSocketRequest } from "@/services/websocket";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useDeleteItem } from "@/composables/useDeleteItem";
import { useToast } from "@/composables/useToast";
import {
  requireActiveCanvas,
  getActiveCanvasIdOrWarn,
} from "@/utils/canvasGuard";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";
import { createNoteBindingActions } from "./noteBindingActions";
import type { UnbindBehavior } from "./noteBindingActions";
import { createNotePositionActions } from "./notePositionActions";
import type {
  CRUDEventsConfig,
  CRUDPayloadConfig,
} from "./createResourceCRUDActions";
import type { ToastCategory } from "@/composables/useToast";
import { removeById } from "@/lib/arrayHelpers";
import { buildCRUDActions } from "./buildCRUDActions";
import { t } from "@/i18n";

const STORE_TO_CATEGORY_MAP: Record<string, ToastCategory> = {
  skill: "Skill",
  repository: "Repository",
  subAgent: "SubAgent",
  command: "Command",
  outputStyle: "OutputStyle",
  mcpServer: "McpServer",
};

function findItemById<T extends { id: string }>(
  items: T[],
  itemId: string,
): T | undefined {
  return items.find((item) => item.id === itemId);
}

interface NoteItem extends BaseNote {
  // index signature 允許透過 config.itemIdField（如 'commandId'、'skillId'）進行動態 key 查找
  [key: string]: unknown;
}

// 用於 groupId 存取的最小介面，實際 TItem 可能包含更多欄位
interface ItemWithGroupId {
  groupId?: string | null;
}

export interface NoteCRUDConfig<
  TItem extends { id: string; name: string },
  TReadResult extends { id: string; name: string } = {
    id: string;
    name: string;
    content: string;
  },
> {
  resourceType: string;
  methodPrefix: string;
  toastCategory: ToastCategory;
  events: CRUDEventsConfig;
  payloadConfig: CRUDPayloadConfig<TItem, string, string, TReadResult>;
}

export interface NoteStoreConfig<
  TItem,
  TCustomActions extends object = object,
> {
  storeName: string;
  relationship: "one-to-one" | "one-to-many";
  responseItemsKey: string;
  itemIdField: string;
  events: {
    listItems: { request: string; response: string };
    listNotes: { request: string; response: string };
    createNote: { request: string; response: string };
    updateNote: { request: string; response: string };
    deleteNote: { request: string; response: string };
  };
  bindEvents?: {
    request: string;
    response: string;
  };
  unbindEvents?: {
    request: string;
    response: string;
  };
  deleteItemEvents?: {
    request: string;
    response: string;
  };
  groupEvents?: {
    listGroups?: { request: string; response: string };
    createGroup?: { request: string; response: string };
    deleteGroup?: { request: string; response: string };
    moveItemToGroup: { request: string; response: string };
  };
  createNotePayload: (item: TItem, x: number, y: number) => object;
  getItemId?: (item: TItem) => string;
  getItemName?: (item: TItem) => string;
  crudConfig?: NoteCRUDConfig<{ id: string; name: string }>;
  customActions?: TCustomActions;
}

export interface RebuildNotesConfig {
  storeName: string;
  podIdField: keyof Pod;
  itemIdField: string;
  yOffset: number;
  requestEvent: string;
  responseEvent: string;
}

type RebuildNotesStoreContext = Pick<
  NoteStoreContext,
  "notes" | "availableItems" | "getNotesByPodId"
>;

function shouldCreateNote(
  pod: Pod,
  itemId: string | null | undefined,
  existingNotes: NoteItem[],
): boolean {
  return (
    itemId !== undefined &&
    itemId !== null &&
    itemId !== "" &&
    existingNotes.length === 0
  );
}

interface RebuildNoteResponse {
  note?: NoteItem;
}

async function createAndAddNote(
  pod: Pod,
  itemId: string,
  config: RebuildNotesConfig,
  canvasId: string,
  context: RebuildNotesStoreContext,
): Promise<void> {
  const item = findItemById(
    context.availableItems as { id: string; name?: string }[],
    itemId,
  );
  const itemName = item?.name ?? itemId;

  const response = await createWebSocketRequest<
    BasePayload,
    RebuildNoteResponse
  >({
    requestEvent: config.requestEvent,
    responseEvent: config.responseEvent,
    payload: {
      canvasId,
      [config.itemIdField]: itemId,
      name: itemName,
      x: pod.x,
      y: pod.y + config.yOffset,
      boundToPodId: pod.id,
      originalPosition: { x: pod.x, y: pod.y + config.yOffset },
    },
  });

  if (response.note) {
    context.notes.push(response.note);
  }
}

export async function rebuildNotesFromPods(
  context: RebuildNotesStoreContext,
  pods: Pod[],
  config: RebuildNotesConfig,
): Promise<void> {
  const canvasId = getActiveCanvasIdOrWarn(config.storeName);
  if (!canvasId) return;

  const promises = pods
    .filter((pod) =>
      shouldCreateNote(
        pod,
        pod[config.podIdField] as string | null | undefined,
        context.getNotesByPodId(pod.id),
      ),
    )
    .map((pod) =>
      createAndAddNote(
        pod,
        pod[config.podIdField] as string,
        config,
        canvasId,
        context,
      ),
    );

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

interface BaseNoteState {
  availableItems: unknown[];
  notes: NoteItem[];
  isLoading: boolean;
  error: string | null;
  draggedNoteId: string | null;
  animatingNoteIds: Set<string>;
  isDraggingNote: boolean;
  isOverTrash: boolean;
  groups: Group[];
  expandedGroupIds: Set<string>;
}

export interface NoteStoreContext<TItem = unknown> extends BaseNoteState {
  availableItems: TItem[];
  loadItems(): Promise<void>;
  loadNotesFromBackend(): Promise<void>;
  createNote(itemId: string, x: number, y: number): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  deleteNote(noteId: string): Promise<void>;
  bindToPod(noteId: string, podId: string): Promise<void>;
  unbindFromPod(podId: string, behavior?: UnbindBehavior): Promise<void>;
  getNotesByPodId(podId: string): NoteItem[];
}

// Pinia 的 StoreDefinition 型別結構複雜，這裡作為 generic constraint 必須允許任意 callable，
// 改用 unknown 會導致實際的 store 函式無法被賦值進來，屬於 TS 慣用的 generic constraint 寫法。
/* eslint-disable @typescript-eslint/no-explicit-any */
export type TypedNoteStore<
  TStore extends (...args: any[]) => any,
  TCustomActions extends object,
> = (() => ReturnType<TStore> & TCustomActions) & { $id: string };
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createNoteStore<
  TItem,
  TNote extends BaseNote,
  TCustomActions extends object = object,
>(config: NoteStoreConfig<TItem, TCustomActions>) {
  const getItemId =
    config.getItemId ?? ((item: TItem): string => (item as { id: string }).id);
  const getItemName =
    config.getItemName ??
    ((item: TItem): string => (item as { name: string }).name);

  return defineStore(config.storeName, {
    state: (): BaseNoteState => ({
      availableItems: [],
      notes: [],
      isLoading: false,
      error: null,
      draggedNoteId: null,
      animatingNoteIds: new Set<string>(),
      isDraggingNote: false,
      isOverTrash: false,
      groups: [],
      expandedGroupIds: new Set<string>(),
    }),

    getters: {
      typedAvailableItems: (state): TItem[] => state.availableItems as TItem[],
      typedNotes: (state): TNote[] => state.notes as TNote[],

      getUnboundNotes: (state) =>
        state.notes.filter((note) => note.boundToPodId === null),

      getNotesByPodId:
        (state) =>
        (podId: string): TNote[] => {
          if (config.relationship === "one-to-one") {
            const note = state.notes.find(
              (note) => note.boundToPodId === podId,
            );
            return note ? [note as TNote] : [];
          }
          return state.notes.filter(
            (note) => note.boundToPodId === podId,
          ) as TNote[];
        },

      getNoteById:
        (state) =>
        (noteId: string): TNote | undefined =>
          state.notes.find((note) => note.id === noteId) as TNote | undefined,

      isNoteAnimating:
        (state) =>
        (noteId: string): boolean =>
          state.animatingNoteIds.has(noteId),

      canDeleteDraggedNote: (state) => {
        if (state.draggedNoteId === null) return false;
        const note = state.notes.find(
          (note) => note.id === state.draggedNoteId,
        );
        return note?.boundToPodId === null;
      },

      isItemInUse:
        (state) =>
        (itemId: string): boolean =>
          state.notes.some(
            (note) =>
              note[config.itemIdField] === itemId && note.boundToPodId !== null,
          ),

      isItemBoundToPod:
        (state) =>
        (itemId: string, podId: string): boolean =>
          state.notes.some(
            (note) =>
              note[config.itemIdField] === itemId &&
              note.boundToPodId === podId,
          ),

      getGroupById:
        (state) =>
        (groupId: string): Group | undefined =>
          state.groups.find((group) => group.id === groupId),

      getItemsByGroupId:
        (state) =>
        (groupId: string | null): TItem[] =>
          state.availableItems.filter(
            (item) => (item as ItemWithGroupId).groupId === groupId,
          ) as TItem[],

      getRootItems: (state): TItem[] =>
        state.availableItems.filter(
          (item) => !(item as ItemWithGroupId).groupId,
        ) as TItem[],

      getSortedItemsWithGroups: (
        state,
      ): { groups: Group[]; rootItems: TItem[] } => {
        const groups = [...state.groups].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        const rootItems = state.availableItems
          .filter((item) => !(item as ItemWithGroupId).groupId)
          .sort((a, b) =>
            getItemName(a as TItem).localeCompare(getItemName(b as TItem)),
          );
        return { groups, rootItems: rootItems as TItem[] };
      },

      isGroupExpanded:
        (state) =>
        (groupId: string): boolean =>
          state.expandedGroupIds.has(groupId),

      canDeleteGroup:
        (state) =>
        (groupId: string): boolean =>
          !state.availableItems.some(
            (item) => (item as ItemWithGroupId).groupId === groupId,
          ),
    },

    actions: {
      async fetchWithActiveCanvasId(
        requestEvent: string,
        responseEvent: string,
      ): Promise<BaseResponse | null> {
        this.isLoading = true;
        this.error = null;

        const { wrapWebSocketRequest } = useWebSocketErrorHandler();
        const canvasId = getActiveCanvasIdOrWarn(config.storeName);

        if (!canvasId) {
          this.isLoading = false;
          return null;
        }

        const response = await wrapWebSocketRequest(
          createWebSocketRequest<BasePayload, BaseResponse>({
            requestEvent,
            responseEvent,
            payload: { canvasId },
          }),
        );

        this.isLoading = false;

        if (!response) {
          this.error = t("store.resource.loadFailed");
        }

        return response ?? null;
      },

      async loadItems(): Promise<void> {
        const response = await this.fetchWithActiveCanvasId(
          config.events.listItems.request,
          config.events.listItems.response,
        );

        if (!response) return;

        if (response[config.responseItemsKey]) {
          this.availableItems = response[config.responseItemsKey] as unknown[];
        }
      },

      async loadNotesFromBackend(): Promise<void> {
        const response = await this.fetchWithActiveCanvasId(
          config.events.listNotes.request,
          config.events.listNotes.response,
        );

        if (!response) return;

        if (response.notes) {
          this.notes = response.notes as NoteItem[];
        }
      },

      async createNote(itemId: string, x: number, y: number): Promise<void> {
        const item = this.availableItems.find(
          (candidate) => getItemId(candidate as TItem) === itemId,
        );
        if (!item) return;

        const itemName = getItemName(item as TItem);
        const canvasId = requireActiveCanvas();

        const payload = {
          canvasId,
          ...config.createNotePayload(item as TItem, x, y),
          name: itemName,
          x,
          y,
          boundToPodId: null,
          originalPosition: null,
        };

        await createWebSocketRequest<BasePayload, BaseResponse>({
          requestEvent: config.events.createNote.request,
          responseEvent: config.events.createNote.response,
          payload,
        });
      },

      ...createNotePositionActions(config),

      setDraggedNote(noteId: string | null): void {
        this.draggedNoteId = noteId;
      },

      setNoteAnimating(noteId: string, isAnimating: boolean): void {
        if (isAnimating) {
          this.animatingNoteIds.add(noteId);
        } else {
          this.animatingNoteIds.delete(noteId);
        }
      },

      setIsDraggingNote(isDragging: boolean): void {
        this.isDraggingNote = isDragging;
      },

      setIsOverTrash(isOver: boolean): void {
        this.isOverTrash = isOver;
      },

      ...createNoteBindingActions(config),

      async deleteNote(noteId: string): Promise<void> {
        const { sendCanvasAction } = useSendCanvasAction();

        await sendCanvasAction<BasePayload, BaseResponse>({
          requestEvent: config.events.deleteNote.request,
          responseEvent: config.events.deleteNote.response,
          payload: { noteId },
        });
      },

      async deleteItem(itemId: string): Promise<void> {
        if (!config.deleteItemEvents) return;

        const { deleteItem } = useDeleteItem();
        const canvasId = requireActiveCanvas();
        const { showSuccessToast } = useToast();

        const item = this.availableItems.find(
          (candidate) => getItemId(candidate as TItem) === itemId,
        );
        const itemName = item ? getItemName(item as TItem) : undefined;
        const category: ToastCategory =
          STORE_TO_CATEGORY_MAP[config.storeName] ?? "Note";

        // payload 使用動態 key（config.itemIdField），無法以靜態型別表達，故使用 DynamicKeyPayload
        type DynamicKeyPayload = { canvasId: string } & {
          [key: string]: string;
        };
        const response = await deleteItem<DynamicKeyPayload, BaseResponse>({
          requestEvent: config.deleteItemEvents.request,
          responseEvent: config.deleteItemEvents.response,
          payload: {
            canvasId,
            [config.itemIdField]: itemId,
          } as DynamicKeyPayload,
          errorMessage: t("store.resource.deleteFailed"),
        });

        if (!response) return;

        const index = this.availableItems.findIndex(
          (i) => getItemId(i as TItem) === itemId,
        );
        if (index !== -1) {
          this.availableItems.splice(index, 1);
        }
        if (response.deletedNoteIds) {
          const deletedIds = response.deletedNoteIds as string[];
          this.notes.splice(
            0,
            this.notes.length,
            ...this.notes.filter((note) => !deletedIds.includes(note.id)),
          );
        }
        showSuccessToast(category, t("store.resource.deleteSuccess"), itemName);
      },

      addNoteFromEvent(note: TNote): void {
        const exists = this.notes.some(
          (existingNote) => existingNote.id === note.id,
        );
        if (!exists) {
          // TNote extends BaseNote，NoteItem 也 extends BaseNote 且加上 index signature。
          // 兩者在 runtime 結構相同，此轉換僅為適配 state 的內部型別。
          this.notes.push(note as unknown as NoteItem);
        }
      },

      updateNoteFromEvent(note: TNote): void {
        const index = this.notes.findIndex(
          (existingNote) => existingNote.id === note.id,
        );
        if (index !== -1) {
          // 同 addNoteFromEvent，TNote 與 NoteItem 在 runtime 結構相同。
          this.notes.splice(index, 1, note as unknown as NoteItem);
        }
      },

      removeNoteFromEvent(noteId: string): void {
        this.notes = removeById(this.notes, noteId);
      },

      addItemFromEvent(item: TItem): void {
        const exists = this.availableItems.some(
          (i) => getItemId(i as TItem) === getItemId(item),
        );
        if (!exists) {
          this.availableItems.push(item);
        }
      },

      updateItemFromEvent(item: TItem): void {
        const index = this.availableItems.findIndex(
          (i) => getItemId(i as TItem) === getItemId(item),
        );
        if (index !== -1) {
          this.availableItems.splice(index, 1, item);
        }
      },

      removeItemFromEvent(itemId: string, deletedNoteIds?: string[]): void {
        this.availableItems = this.availableItems.filter(
          (item) => getItemId(item as TItem) !== itemId,
        );

        if (deletedNoteIds) {
          this.notes = this.notes.filter(
            (note) => !deletedNoteIds.includes(note.id),
          );
        }
      },

      toggleGroupExpand(groupId: string): void {
        if (this.expandedGroupIds.has(groupId)) {
          this.expandedGroupIds.delete(groupId);
        } else {
          this.expandedGroupIds.add(groupId);
        }
      },

      addGroupFromEvent(group: Group): void {
        const exists = this.groups.some((g) => g.id === group.id);
        if (!exists) {
          this.groups.push(group);
        }
      },

      removeGroupFromEvent(groupId: string): void {
        this.groups = removeById(this.groups, groupId);
      },

      updateItemGroupId(itemId: string, groupId: string | null): void {
        const item = this.availableItems.find(
          (candidate) => getItemId(candidate as TItem) === itemId,
        ) as (TItem & { groupId?: string | null }) | undefined;
        if (item) {
          item.groupId = groupId;
        }
      },

      // 切換 canvas 時重設 note store 狀態
      resetForCanvasSwitch(): void {
        this.notes = [];
        this.availableItems = [];
      },

      ...(config.customActions ?? ({} as TCustomActions)),
      ...buildCRUDActions(config),
    },
  });
}
