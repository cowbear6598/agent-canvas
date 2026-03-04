import type { McpServer, McpServerNote, McpServerConfig } from '@/types'
import { createNoteStore } from './createNoteStore'
import type { NoteStoreContext, TypedNoteStore } from './createNoteStore'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { createResourceCRUDActions, defaultMergeItemInList } from './createResourceCRUDActions'
import type {
  McpServerCreatedPayload,
  McpServerUpdatedPayload,
  McpServerReadResultPayload,
} from '@/types/websocket'

interface McpServerStoreCustomActions {
  createMcpServer(name: string, config: McpServerConfig): Promise<{ success: boolean; mcpServer?: { id: string; name: string }; error?: string }>
  updateMcpServer(mcpServerId: string, name: string, config: McpServerConfig): Promise<{ success: boolean; mcpServer?: { id: string; name: string }; error?: string }>
  readMcpServer(mcpServerId: string): Promise<{ id: string; name: string; config: McpServerConfig } | null>
  deleteMcpServer(mcpServerId: string): Promise<void>
  loadMcpServers(): Promise<void>
}

interface McpServerUpdateInput {
  name: string
  config: McpServerConfig
}

function toMcpServerResult(result: { success: boolean; item?: { id: string; name: string }; error?: string }): { success: boolean; mcpServer?: { id: string; name: string }; error?: string } {
  return result.success ? { success: true, mcpServer: result.item } : { success: false, error: result.error }
}

const mcpServerCRUD = createResourceCRUDActions<
  McpServer,
  McpServerConfig,
  McpServerUpdateInput,
  { id: string; name: string; config: McpServerConfig }
>(
  'MCP Server',
  {
    create: {
      request: WebSocketRequestEvents.MCP_SERVER_CREATE,
      response: WebSocketResponseEvents.MCP_SERVER_CREATED,
    },
    update: {
      request: WebSocketRequestEvents.MCP_SERVER_UPDATE,
      response: WebSocketResponseEvents.MCP_SERVER_UPDATED,
    },
    read: {
      request: WebSocketRequestEvents.MCP_SERVER_READ,
      response: WebSocketResponseEvents.MCP_SERVER_READ_RESULT,
    },
  },
  {
    getCreatePayload: (name, config) => ({ name, config }),
    getUpdatePayload: (mcpServerId, { name, config }) => ({ mcpServerId, name, config }),
    getReadPayload: (mcpServerId) => ({ mcpServerId }),
    extractItemFromResponse: {
      create: (response) => (response as McpServerCreatedPayload).mcpServer,
      update: (response) => (response as McpServerUpdatedPayload).mcpServer,
      read: (response) => (response as McpServerReadResultPayload).mcpServer,
    },
    updateItemsList: defaultMergeItemInList,
  },
  'McpServer'
)

const store = createNoteStore<McpServer, McpServerNote>({
  storeName: 'mcpServer',
  relationship: 'one-to-many',
  responseItemsKey: 'mcpServers',
  itemIdField: 'mcpServerId',
  events: {
    listItems: {
      request: WebSocketRequestEvents.MCP_SERVER_LIST,
      response: WebSocketResponseEvents.MCP_SERVER_LIST_RESULT,
    },
    listNotes: {
      request: WebSocketRequestEvents.MCP_SERVER_NOTE_LIST,
      response: WebSocketResponseEvents.MCP_SERVER_NOTE_LIST_RESULT,
    },
    createNote: {
      request: WebSocketRequestEvents.MCP_SERVER_NOTE_CREATE,
      response: WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED,
    },
    updateNote: {
      request: WebSocketRequestEvents.MCP_SERVER_NOTE_UPDATE,
      response: WebSocketResponseEvents.MCP_SERVER_NOTE_UPDATED,
    },
    deleteNote: {
      request: WebSocketRequestEvents.MCP_SERVER_NOTE_DELETE,
      response: WebSocketResponseEvents.MCP_SERVER_NOTE_DELETED,
    },
  },
  bindEvents: {
    request: WebSocketRequestEvents.POD_BIND_MCP_SERVER,
    response: WebSocketResponseEvents.POD_MCP_SERVER_BOUND,
  },
  unbindEvents: {
    request: WebSocketRequestEvents.POD_UNBIND_MCP_SERVER,
    response: WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND,
  },
  deleteItemEvents: {
    request: WebSocketRequestEvents.MCP_SERVER_DELETE,
    response: WebSocketResponseEvents.MCP_SERVER_DELETED,
  },
  createNotePayload: (item: McpServer) => ({
    mcpServerId: item.id,
  }),
  customActions: {
    async createMcpServer(this: NoteStoreContext<McpServer>, name: string, config: McpServerConfig): Promise<{ success: boolean; mcpServer?: { id: string; name: string }; error?: string }> {
      const result = await mcpServerCRUD.create(this.availableItems, name, config)
      return toMcpServerResult(result)
    },

    async updateMcpServer(this: NoteStoreContext<McpServer>, mcpServerId: string, name: string, config: McpServerConfig): Promise<{ success: boolean; mcpServer?: { id: string; name: string }; error?: string }> {
      const result = await mcpServerCRUD.update(this.availableItems, mcpServerId, { name, config })
      return toMcpServerResult(result)
    },

    async readMcpServer(this: NoteStoreContext<McpServer>, mcpServerId: string): Promise<{ id: string; name: string; config: McpServerConfig } | null> {
      return mcpServerCRUD.read(mcpServerId)
    },

    async deleteMcpServer(this: NoteStoreContext<McpServer>, mcpServerId: string): Promise<void> {
      return this.deleteItem(mcpServerId)
    },

    async loadMcpServers(this: NoteStoreContext<McpServer>): Promise<void> {
      return this.loadItems()
    },
  }
})

export const useMcpServerStore = store as TypedNoteStore<typeof store, McpServerStoreCustomActions>
