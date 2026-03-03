import type { Command, CommandNote, Pod } from '@/types'
import { createNoteStore, rebuildNotesFromPods } from './createNoteStore'
import type { NoteStoreContext } from './createNoteStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { createGroupCRUDActions } from './createGroupCRUDActions'
import type {
  CommandCreatedPayload,
  CommandUpdatedPayload,
  CommandReadResultPayload,
} from '@/types/websocket'
import type { Group } from '@/types'

interface CommandStoreCustomActions {
  rebuildNotesFromPods(pods: Pod[]): Promise<void>
  createCommand(name: string, content: string): Promise<{ success: boolean; command?: { id: string; name: string }; error?: string }>
  updateCommand(commandId: string, content: string): Promise<{ success: boolean; command?: { id: string; name: string }; error?: string }>
  readCommand(commandId: string): Promise<{ id: string; name: string; content: string } | null>
  deleteCommand(commandId: string): Promise<void>
  loadCommands(): Promise<void>
  loadGroups(): Promise<void>
  createGroup(name: string): Promise<{ success: boolean; group?: Group; error?: string }>
  deleteGroup(groupId: string): Promise<{ success: boolean; error?: string }>
  moveItemToGroup(commandId: string, groupId: string | null): Promise<{ success: boolean; error?: string }>
}

const commandGroupCRUD = createGroupCRUDActions({
  storeName: 'CommandStore',
  groupType: 'command',
  toastCategory: 'Command',
  moveItemToGroupEvents: {
    request: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
    response: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
  },
})

const store = createNoteStore<Command, CommandNote>({
  storeName: 'command',
  relationship: 'one-to-one',
  responseItemsKey: 'commands',
  itemIdField: 'commandId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.COMMAND_LIST,
      response: WebSocketResponseEvents.COMMAND_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.COMMAND_NOTE_LIST,
      response: WebSocketResponseEvents.COMMAND_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.COMMAND_NOTE_CREATE,
      response: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.COMMAND_NOTE_UPDATE,
      response: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.COMMAND_NOTE_DELETE,
      response: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_COMMAND,
    response: WebSocketResponseEvents.POD_COMMAND_BOUND,
  },
  unbindEvents: {
    request: WebSocketRequestEvents.POD_UNBIND_COMMAND,
    response: WebSocketResponseEvents.POD_COMMAND_UNBOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.COMMAND_DELETE,
    response: WebSocketResponseEvents.COMMAND_DELETED,
  },
  groupEvents: {
    moveItemToGroup: {
      request: WebSocketRequestEvents.COMMAND_MOVE_TO_GROUP,
      response: WebSocketResponseEvents.COMMAND_MOVED_TO_GROUP,
    },
  },
  createNotePayload: (item: Command) => ({
    commandId: item.id,
  }),
  crudConfig: {
    resourceType: 'Command',
    methodPrefix: 'command',
    toastCategory: 'Command',
    events: {
      create: {
        request: WebSocketRequestEvents.COMMAND_CREATE,
        response: WebSocketResponseEvents.COMMAND_CREATED,
      },
      update: {
        request: WebSocketRequestEvents.COMMAND_UPDATE,
        response: WebSocketResponseEvents.COMMAND_UPDATED,
      },
      read: {
        request: WebSocketRequestEvents.COMMAND_READ,
        response: WebSocketResponseEvents.COMMAND_READ_RESULT,
      },
    },
    payloadConfig: {
      getUpdatePayload: (commandId, content) => ({ commandId, content }),
      getReadPayload: (commandId) => ({ commandId }),
      extractItemFromResponse: {
        create: (response) => (response as CommandCreatedPayload).command,
        update: (response) => (response as CommandUpdatedPayload).command,
        read: (response) => (response as CommandReadResultPayload).command,
      },

    },
  },
  customActions: {
    async rebuildNotesFromPods(this: NoteStoreContext<Command>, pods: Pod[]): Promise<void> {
      await rebuildNotesFromPods(this, pods, {
        storeName: 'CommandStore',
        podIdField: 'commandId',
        itemIdField: 'commandId',
        yOffset: -100,
        requestEvent: WebSocketRequestEvents.COMMAND_NOTE_CREATE,
        responseEvent: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
      })
    },

    ...commandGroupCRUD,
  }
})

export const useCommandStore: (() => ReturnType<typeof store> & CommandStoreCustomActions) & { $id: string } = store as (() => ReturnType<typeof store> & CommandStoreCustomActions) & { $id: string }
