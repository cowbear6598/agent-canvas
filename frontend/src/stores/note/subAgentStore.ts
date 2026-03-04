import type { SubAgent, SubAgentNote } from '@/types'
import { createNoteStore } from './createNoteStore'
import type { TypedNoteStore } from './createNoteStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { createGroupCRUDActions } from './createGroupCRUDActions'
import type {
  SubAgentCreatedPayload,
  SubAgentUpdatedPayload,
  SubAgentReadResultPayload,
} from '@/types/websocket'
import type { Group } from '@/types'

interface SubAgentStoreCustomActions {
  createSubAgent(name: string, content: string): Promise<{ success: boolean; subAgent?: { id: string; name: string }; error?: string }>
  updateSubAgent(subAgentId: string, content: string): Promise<{ success: boolean; subAgent?: { id: string; name: string }; error?: string }>
  readSubAgent(subAgentId: string): Promise<{ id: string; name: string; content: string } | null>
  deleteSubAgent(subAgentId: string): Promise<void>
  loadSubAgents(): Promise<void>
  loadGroups(): Promise<void>
  createGroup(name: string): Promise<{ success: boolean; group?: Group; error?: string }>
  deleteGroup(groupId: string): Promise<{ success: boolean; error?: string }>
  moveItemToGroup(subAgentId: string, groupId: string | null): Promise<{ success: boolean; error?: string }>
}

const subAgentGroupCRUD = createGroupCRUDActions({
  storeName: 'SubAgentStore',
  groupType: 'subagent',
  toastCategory: 'SubAgent',
  moveItemToGroupEvents: {
    request: WebSocketRequestEvents.SUBAGENT_MOVE_TO_GROUP,
    response: WebSocketResponseEvents.SUBAGENT_MOVED_TO_GROUP,
  },
})

const store = createNoteStore<SubAgent, SubAgentNote>({
  storeName: 'subAgent',
  relationship: 'one-to-many',
  responseItemsKey: 'subAgents',
  itemIdField: 'subAgentId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.SUBAGENT_LIST,
      response: WebSocketResponseEvents.SUBAGENT_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.SUBAGENT_NOTE_LIST,
      response: WebSocketResponseEvents.SUBAGENT_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.SUBAGENT_NOTE_CREATE,
      response: WebSocketResponseEvents.SUBAGENT_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.SUBAGENT_NOTE_UPDATE,
      response: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.SUBAGENT_NOTE_DELETE,
      response: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_SUBAGENT,
    response: WebSocketResponseEvents.POD_SUBAGENT_BOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.SUBAGENT_DELETE,
    response: WebSocketResponseEvents.SUBAGENT_DELETED,
  },
  groupEvents: {
    moveItemToGroup: {
      request: WebSocketRequestEvents.SUBAGENT_MOVE_TO_GROUP,
      response: WebSocketResponseEvents.SUBAGENT_MOVED_TO_GROUP,
    },
  },
  createNotePayload: (item: SubAgent) => ({
    subAgentId: item.id,
  }),
  crudConfig: {
    resourceType: 'SubAgent',
    methodPrefix: 'subAgent',
    toastCategory: 'SubAgent',
    events: {
      create: {
        request: WebSocketRequestEvents.SUBAGENT_CREATE,
        response: WebSocketResponseEvents.SUBAGENT_CREATED,
      },
      update: {
        request: WebSocketRequestEvents.SUBAGENT_UPDATE,
        response: WebSocketResponseEvents.SUBAGENT_UPDATED,
      },
      read: {
        request: WebSocketRequestEvents.SUBAGENT_READ,
        response: WebSocketResponseEvents.SUBAGENT_READ_RESULT,
      },
    },
    payloadConfig: {
      getUpdatePayload: (subAgentId, content) => ({ subAgentId, content }),
      getReadPayload: (subAgentId) => ({ subAgentId }),
      extractItemFromResponse: {
        create: (response) => (response as SubAgentCreatedPayload).subAgent,
        update: (response) => (response as SubAgentUpdatedPayload).subAgent,
        read: (response) => (response as SubAgentReadResultPayload).subAgent,
      },

    },
  },
  customActions: {
    ...subAgentGroupCRUD,
  }
})

export const useSubAgentStore = store as TypedNoteStore<typeof store, SubAgentStoreCustomActions>
