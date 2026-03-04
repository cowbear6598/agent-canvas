import type { OutputStyleListItem, OutputStyleNote, Pod } from '@/types'
import { createNoteStore, rebuildNotesFromPods } from './createNoteStore'
import type { NoteStoreContext, TypedNoteStore } from './createNoteStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { createGroupCRUDActions } from './createGroupCRUDActions'
import type {
  OutputStyleCreatedPayload,
  OutputStyleUpdatedPayload,
  OutputStyleReadResultPayload,
} from '@/types/websocket'
import type { Group } from '@/types'

interface OutputStyleStoreCustomActions {
  rebuildNotesFromPods(pods: Pod[]): Promise<void>
  createOutputStyle(name: string, content: string): Promise<{ success: boolean; outputStyle?: { id: string; name: string }; error?: string }>
  updateOutputStyle(outputStyleId: string, content: string): Promise<{ success: boolean; outputStyle?: { id: string; name: string }; error?: string }>
  readOutputStyle(outputStyleId: string): Promise<{ id: string; name: string; content: string } | null>
  deleteOutputStyle(outputStyleId: string): Promise<void>
  loadOutputStyles(): Promise<void>
  loadGroups(): Promise<void>
  createGroup(name: string): Promise<{ success: boolean; group?: Group; error?: string }>
  deleteGroup(groupId: string): Promise<{ success: boolean; error?: string }>
  moveItemToGroup(outputStyleId: string, groupId: string | null): Promise<{ success: boolean; error?: string }>
}

const outputStyleGroupCRUD = createGroupCRUDActions({
  storeName: 'OutputStyleStore',
  groupType: 'output-style',
  toastCategory: 'OutputStyle',
  moveItemToGroupEvents: {
    request: WebSocketRequestEvents.OUTPUT_STYLE_MOVE_TO_GROUP,
    response: WebSocketResponseEvents.OUTPUT_STYLE_MOVED_TO_GROUP,
  },
})

const store = createNoteStore<OutputStyleListItem, OutputStyleNote>({
  storeName: 'outputStyle',
  relationship: 'one-to-one',
  responseItemsKey: 'styles',
  itemIdField: 'outputStyleId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.OUTPUT_STYLE_LIST,
      response: WebSocketResponseEvents.OUTPUT_STYLE_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.NOTE_LIST,
      response: WebSocketResponseEvents.NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.NOTE_CREATE,
      response: WebSocketResponseEvents.NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.NOTE_UPDATE,
      response: WebSocketResponseEvents.NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.NOTE_DELETE,
      response: WebSocketResponseEvents.NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_OUTPUT_STYLE,
    response: WebSocketResponseEvents.POD_OUTPUT_STYLE_BOUND,
  },
  unbindEvents: {
    request: WebSocketRequestEvents.POD_UNBIND_OUTPUT_STYLE,
    response: WebSocketResponseEvents.POD_OUTPUT_STYLE_UNBOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.OUTPUT_STYLE_DELETE,
    response: WebSocketResponseEvents.OUTPUT_STYLE_DELETED,
  },
  groupEvents: {
    moveItemToGroup: {
      request: WebSocketRequestEvents.OUTPUT_STYLE_MOVE_TO_GROUP,
      response: WebSocketResponseEvents.OUTPUT_STYLE_MOVED_TO_GROUP,
    },
  },
  createNotePayload: (item: OutputStyleListItem) => ({
    outputStyleId: item.id,
  }),
  crudConfig: {
    resourceType: 'Output Style',
    methodPrefix: 'outputStyle',
    toastCategory: 'OutputStyle',
    events: {
      create: {
        request: WebSocketRequestEvents.OUTPUT_STYLE_CREATE,
        response: WebSocketResponseEvents.OUTPUT_STYLE_CREATED,
      },
      update: {
        request: WebSocketRequestEvents.OUTPUT_STYLE_UPDATE,
        response: WebSocketResponseEvents.OUTPUT_STYLE_UPDATED,
      },
      read: {
        request: WebSocketRequestEvents.OUTPUT_STYLE_READ,
        response: WebSocketResponseEvents.OUTPUT_STYLE_READ_RESULT,
      },
    },
    payloadConfig: {
      getUpdatePayload: (outputStyleId, content) => ({ outputStyleId, content }),
      getReadPayload: (outputStyleId) => ({ outputStyleId }),
      extractItemFromResponse: {
        create: (response) => (response as OutputStyleCreatedPayload).outputStyle,
        update: (response) => (response as OutputStyleUpdatedPayload).outputStyle,
        read: (response) => (response as OutputStyleReadResultPayload).outputStyle,
      },

    },
  },
  customActions: {
    async rebuildNotesFromPods(this: NoteStoreContext<OutputStyleListItem>, pods: Pod[]): Promise<void> {
      await rebuildNotesFromPods(this, pods, {
        storeName: 'OutputStyleStore',
        podIdField: 'outputStyleId',
        itemIdField: 'outputStyleId',
        yOffset: -50,
        requestEvent: WebSocketRequestEvents.NOTE_CREATE,
        responseEvent: WebSocketResponseEvents.NOTE_CREATED,
      })
    },

    ...outputStyleGroupCRUD,
  }
})

export const useOutputStyleStore = store as TypedNoteStore<typeof store, OutputStyleStoreCustomActions>
