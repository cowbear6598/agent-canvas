import { ref } from 'vue'
import { websocketClient, WebSocketResponseEvents } from '@/services/websocket'
import { tryResolvePendingRequest } from '@/services/websocket/createWebSocketRequest'
import { usePodStore } from '@/stores/pod/podStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useOutputStyleStore } from '@/stores/note/outputStyleStore'
import { useSkillStore } from '@/stores/note/skillStore'
import { useRepositoryStore } from '@/stores/note/repositoryStore'
import { useSubAgentStore } from '@/stores/note/subAgentStore'
import { useCommandStore } from '@/stores/note/commandStore'
import { useMcpServerStore } from '@/stores/note/mcpServerStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useChatStore } from '@/stores/chat/chatStore'
import { useSlackStore } from '@/stores/slackStore'
import { useToast } from '@/composables/useToast'
import { truncateContent } from '@/stores/chat/chatUtils'
import { CONTENT_PREVIEW_LENGTH } from '@/lib/constants'
import type { Pod, Connection, OutputStyleNote, SkillNote, RepositoryNote, SubAgentNote, CommandNote, Canvas, McpServer, McpServerNote } from '@/types'
import type { SlackApp, SlackAppConnectionStatus, SlackChannel } from '@/types/slack'

const isListenerRegistered = ref(false)

interface BasePayload {
  requestId?: string
  canvasId?: string
}

interface UnifiedHandlerOptions {
  toastMessage?: string
  skipCanvasCheck?: boolean
}

const isCurrentCanvas = (canvasId: string): boolean => {
  const canvasStore = useCanvasStore()
  return canvasStore.activeCanvasId === canvasId
}

function createUnifiedHandler<T extends BasePayload>(
  handler: (payload: T, isOwnOperation: boolean) => void,
  options?: UnifiedHandlerOptions
): (payload: T) => void {
  return (payload: T): void => {
    if (!options?.skipCanvasCheck && payload.canvasId) {
      if (!isCurrentCanvas(payload.canvasId)) {
        return
      }
    }

    const isOwnOperation = payload.requestId ? tryResolvePendingRequest(payload.requestId, payload) : false

    if (isOwnOperation && options?.toastMessage) {
      const { toast } = useToast()
      toast({ title: options.toastMessage })
    }

    handler(payload, isOwnOperation)
  }
}

const handlePodCreated = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().addPodFromEvent(payload.pod)
    }
  },
  { toastMessage: 'Pod 建立成功' }
)

const handlePodMoved = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePodPosition(payload.pod.id, payload.pod.x, payload.pod.y)
    }
  }
)

const handlePodRenamed = createUnifiedHandler<BasePayload & { podId: string; name: string; canvasId: string }>(
  (payload) => {
    usePodStore().updatePodName(payload.podId, payload.name)
  },
  { toastMessage: '重命名成功' }
)

const handlePodModelSet = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod)
    }
  },
  { toastMessage: '模型設定成功' }
)

const handlePodScheduleSet = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod)
    }
  },
  { toastMessage: '排程設定成功' }
)

type DeletedNoteIds = {
  note?: string[]
  skillNote?: string[]
  repositoryNote?: string[]
  commandNote?: string[]
  subAgentNote?: string[]
  mcpServerNote?: string[]
}

const noteTypeHandlers: {
  key: keyof DeletedNoteIds
  getStore: () => { removeNoteFromEvent: (id: string) => void }
}[] = [
  { key: 'note', getStore: () => useOutputStyleStore() },
  { key: 'skillNote', getStore: () => useSkillStore() },
  { key: 'repositoryNote', getStore: () => useRepositoryStore() },
  { key: 'commandNote', getStore: () => useCommandStore() },
  { key: 'subAgentNote', getStore: () => useSubAgentStore() },
  { key: 'mcpServerNote', getStore: () => useMcpServerStore() },
]

const removeDeletedNotes = (deletedNoteIds: DeletedNoteIds | undefined): void => {
  if (!deletedNoteIds) return

  for (const { key, getStore } of noteTypeHandlers) {
    const ids = deletedNoteIds[key]
    if (ids && ids.length > 0) {
      const store = getStore()
      ids.forEach(noteId => store.removeNoteFromEvent(noteId))
    }
  }
}

const handlePodDeleted = createUnifiedHandler<BasePayload & {
  podId: string
  canvasId: string
  deletedNoteIds?: DeletedNoteIds
}>(
  (payload) => {
    usePodStore().removePod(payload.podId)
    removeDeletedNotes(payload.deletedNoteIds)
  },
  { toastMessage: 'Pod 已刪除' }
)

const handlePodStateUpdated = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod)
    }
  }
)

type RawConnectionFromEvent = Omit<Connection, 'status'>

const handleConnectionCreated = createUnifiedHandler<BasePayload & { connection?: RawConnectionFromEvent; canvasId: string }>(
  (payload) => {
    if (payload.connection) {
      useConnectionStore().addConnectionFromEvent(payload.connection)
    }
  },
  { toastMessage: '連線建立成功' }
)

const handleConnectionUpdated = createUnifiedHandler<BasePayload & { connection?: RawConnectionFromEvent; canvasId: string }>(
  (payload) => {
    if (payload.connection) {
      useConnectionStore().updateConnectionFromEvent(payload.connection)
    }
  }
)

const handleConnectionDeleted = createUnifiedHandler<BasePayload & { connectionId: string; canvasId: string }>(
  (payload) => {
    useConnectionStore().removeConnectionFromEvent(payload.connectionId)
  },
  { toastMessage: '連線已刪除' }
)

const handleOutputStyleDeleted = createUnifiedHandler<BasePayload & { outputStyleId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    useOutputStyleStore().removeItemFromEvent(payload.outputStyleId, payload.deletedNoteIds)
  },
  { toastMessage: '輸出風格已刪除' }
)

// 五種 note store 的 created/updated/deleted 事件結構完全相同，以 data-driven 方式統一產生 handler
interface NoteHandlerConfig<TNote> {
  created: string
  updated: string
  deleted: string
  getStore: () => {
    addNoteFromEvent: (note: TNote) => void
    updateNoteFromEvent: (note: TNote) => void
    removeNoteFromEvent: (noteId: string) => void
  }
}

type NotePayloadCreated<TNote> = BasePayload & { note?: TNote; canvasId: string }
type NotePayloadUpdated<TNote> = BasePayload & { note?: TNote; canvasId: string }
type NotePayloadDeleted = BasePayload & { noteId: string; canvasId: string }

function createNoteHandlers<TNote>(config: NoteHandlerConfig<TNote>): {
  created: (payload: NotePayloadCreated<TNote>) => void
  updated: (payload: NotePayloadUpdated<TNote>) => void
  deleted: (payload: NotePayloadDeleted) => void
} {
  return {
    created: createUnifiedHandler<NotePayloadCreated<TNote>>((payload) => {
      if (payload.note) {
        config.getStore().addNoteFromEvent(payload.note)
      }
    }),
    updated: createUnifiedHandler<NotePayloadUpdated<TNote>>((payload) => {
      if (payload.note) {
        config.getStore().updateNoteFromEvent(payload.note)
      }
    }),
    deleted: createUnifiedHandler<NotePayloadDeleted>((payload) => {
      config.getStore().removeNoteFromEvent(payload.noteId)
    }),
  }
}

const outputStyleNoteHandlers = createNoteHandlers<OutputStyleNote>({
  created: WebSocketResponseEvents.NOTE_CREATED,
  updated: WebSocketResponseEvents.NOTE_UPDATED,
  deleted: WebSocketResponseEvents.NOTE_DELETED,
  getStore: useOutputStyleStore,
})

const skillNoteHandlers = createNoteHandlers<SkillNote>({
  created: WebSocketResponseEvents.SKILL_NOTE_CREATED,
  updated: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
  deleted: WebSocketResponseEvents.SKILL_NOTE_DELETED,
  getStore: useSkillStore,
})

const repositoryNoteHandlers = createNoteHandlers<RepositoryNote>({
  created: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED,
  updated: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED,
  deleted: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED,
  getStore: useRepositoryStore,
})

const subAgentNoteHandlers = createNoteHandlers<SubAgentNote>({
  created: WebSocketResponseEvents.SUBAGENT_NOTE_CREATED,
  updated: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED,
  deleted: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED,
  getStore: useSubAgentStore,
})

const commandNoteHandlers = createNoteHandlers<CommandNote>({
  created: WebSocketResponseEvents.COMMAND_NOTE_CREATED,
  updated: WebSocketResponseEvents.COMMAND_NOTE_UPDATED,
  deleted: WebSocketResponseEvents.COMMAND_NOTE_DELETED,
  getStore: useCommandStore,
})

const mcpServerNoteHandlers = createNoteHandlers<McpServerNote>({
  created: WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED,
  updated: WebSocketResponseEvents.MCP_SERVER_NOTE_UPDATED,
  deleted: WebSocketResponseEvents.MCP_SERVER_NOTE_DELETED,
  getStore: useMcpServerStore,
})

const handleSkillDeleted = createUnifiedHandler<BasePayload & { skillId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    useSkillStore().removeItemFromEvent(payload.skillId, payload.deletedNoteIds)
  },
  { toastMessage: 'Skill 已刪除' }
)

type RepositoryItem = { id: string; name: string; parentRepoId?: string; branchName?: string }

function isValidStringField(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function validateIdAndName(id: unknown, name: unknown, context: string): boolean {
  if (!isValidStringField(id)) {
    console.error(`[Security] 無效的 ${context}.id 格式`)
    return false
  }

  if (!isValidStringField(name)) {
    console.error(`[Security] 無效的 ${context}.name 格式`)
    return false
  }

  return true
}

function containsXssPattern(name: string): boolean {
  return /<script|javascript:|on\w+=/i.test(name)
}

const validateRepositoryItem = (repository: RepositoryItem): boolean => {
  if (!validateIdAndName(repository.id, repository.name, 'repository')) return false

  if (containsXssPattern(repository.name)) {
    console.error('[Security] 潛在惡意的 repository.name:', repository.name)
    return false
  }

  return true
}

const handleRepositoryWorktreeCreated = createUnifiedHandler<BasePayload & { repository?: RepositoryItem; canvasId: string }>(
  (payload) => {
    if (payload.repository && validateRepositoryItem(payload.repository)) {
      useRepositoryStore().addItemFromEvent(payload.repository)
    }
  },
  { toastMessage: 'Worktree 建立成功' }
)

const handleRepositoryDeleted = createUnifiedHandler<BasePayload & { repositoryId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    useRepositoryStore().removeItemFromEvent(payload.repositoryId, payload.deletedNoteIds)
  },
  { toastMessage: 'Repository 已刪除' }
)

const handleRepositoryBranchChanged = createUnifiedHandler<BasePayload & { repositoryId: string; branchName: string }>(
  (payload) => {
    if (!payload.branchName || !/^[a-zA-Z0-9_\-/]+$/.test(payload.branchName)) return

    const repositoryStore = useRepositoryStore()
    const repository = repositoryStore.typedAvailableItems.find((item) => item.id === payload.repositoryId)
    if (repository) {
      repository.currentBranch = payload.branchName
    }
  },
  { skipCanvasCheck: true }
)

const handleSubAgentDeleted = createUnifiedHandler<BasePayload & { subAgentId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    useSubAgentStore().removeItemFromEvent(payload.subAgentId, payload.deletedNoteIds)
  },
  { toastMessage: 'SubAgent 已刪除' }
)

const handleCommandDeleted = createUnifiedHandler<BasePayload & { commandId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    useCommandStore().removeItemFromEvent(payload.commandId, payload.deletedNoteIds)
  },
  { toastMessage: 'Command 已刪除' }
)

const validateMcpServer = (mcpServer: McpServer): boolean => {
  if (!validateIdAndName(mcpServer.id, mcpServer.name, 'mcpServer')) return false

  if (containsXssPattern(mcpServer.name)) {
    console.error('[Security] 潛在惡意的 mcpServer.name:', mcpServer.name)
    return false
  }

  return true
}

const handleMcpServerCreated = createUnifiedHandler<BasePayload & { mcpServer?: McpServer; canvasId: string }>(
  (payload) => {
    if (payload.mcpServer && validateMcpServer(payload.mcpServer)) {
      useMcpServerStore().addItemFromEvent(payload.mcpServer)
    }
  },
  { toastMessage: 'MCP Server 已建立' }
)

const handleMcpServerUpdated = createUnifiedHandler<BasePayload & { mcpServer?: McpServer; canvasId: string }>(
  (payload) => {
    if (payload.mcpServer && validateMcpServer(payload.mcpServer)) {
      useMcpServerStore().updateItemFromEvent(payload.mcpServer)
    }
  },
  { toastMessage: 'MCP Server 已更新' }
)

const handleMcpServerDeleted = createUnifiedHandler<BasePayload & { mcpServerId: string; deletedNoteIds?: string[]; canvasId: string }>(
  (payload) => {
    if (!payload.mcpServerId || typeof payload.mcpServerId !== 'string') {
      console.error('[Security] 無效的 mcpServerId:', payload.mcpServerId)
      return
    }
    useMcpServerStore().removeItemFromEvent(payload.mcpServerId, payload.deletedNoteIds)
  },
  { toastMessage: 'MCP Server 已刪除', skipCanvasCheck: true }
)

const handleCanvasCreated = createUnifiedHandler<BasePayload & { canvas?: Canvas }>(
  (payload) => {
    if (payload.canvas) {
      useCanvasStore().addCanvasFromEvent(payload.canvas)
    }
  },
  { toastMessage: 'Canvas 建立成功', skipCanvasCheck: true }
)

const handleCanvasRenamed = createUnifiedHandler<BasePayload & { canvasId: string; newName: string }>(
  (payload) => {
    useCanvasStore().renameCanvasFromEvent(payload.canvasId, payload.newName)
  },
  { toastMessage: 'Canvas 重命名成功', skipCanvasCheck: true }
)

const handleCanvasDeleted = createUnifiedHandler<BasePayload & { canvasId: string }>(
  (payload) => {
    useCanvasStore().removeCanvasFromEvent(payload.canvasId)
  },
  { skipCanvasCheck: true }
)

const handleCanvasReordered = createUnifiedHandler<BasePayload & { canvasIds: string[] }>(
  (payload) => {
    useCanvasStore().reorderCanvasesFromEvent(payload.canvasIds)
  },
  { skipCanvasCheck: true }
)

const addCreatedItems = <T>(
  items: T[] | undefined,
  addFn: (item: T) => void
): void => {
  if (items) {
    for (const item of items) {
      addFn(item)
    }
  }
}

const handleCanvasPasted = createUnifiedHandler<BasePayload & {
  canvasId: string
  createdPods?: Pod[]
  createdOutputStyleNotes?: OutputStyleNote[]
  createdSkillNotes?: SkillNote[]
  createdRepositoryNotes?: RepositoryNote[]
  createdSubAgentNotes?: SubAgentNote[]
  createdCommandNotes?: CommandNote[]
  createdMcpServerNotes?: McpServerNote[]
  createdConnections?: RawConnectionFromEvent[]
}>(
  (payload) => {
    const podStore = usePodStore()
    const connectionStore = useConnectionStore()
    const outputStyleStore = useOutputStyleStore()
    const skillStore = useSkillStore()
    const repositoryStore = useRepositoryStore()
    const subAgentStore = useSubAgentStore()
    const commandStore = useCommandStore()
    const mcpServerStore = useMcpServerStore()

    addCreatedItems(payload.createdPods, pod => podStore.addPodFromEvent(pod))
    addCreatedItems(payload.createdOutputStyleNotes, note => outputStyleStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdSkillNotes, note => skillStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdRepositoryNotes, note => repositoryStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdSubAgentNotes, note => subAgentStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdCommandNotes, note => commandStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdMcpServerNotes, note => mcpServerStore.addNoteFromEvent(note))
    addCreatedItems(payload.createdConnections, connection => connectionStore.addConnectionFromEvent(connection))
  },
  { toastMessage: '貼上成功' }
)

const handleWorkflowClearResult = createUnifiedHandler<BasePayload & { canvasId: string; clearedPodIds?: string[] }>(
  (payload) => {
    if (payload.clearedPodIds) {
      const chatStore = useChatStore()
      chatStore.clearMessagesByPodIds(payload.clearedPodIds)

      const podStore = usePodStore()
      podStore.clearPodOutputsByIds(payload.clearedPodIds)
    }
  },
  { toastMessage: '已清空訊息' }
)

const handleSlackAppCreated = createUnifiedHandler<BasePayload & { slackApp?: SlackApp }>(
  (payload) => {
    if (payload.slackApp) {
      useSlackStore().addSlackAppFromEvent(payload.slackApp)
    }
  },
  { skipCanvasCheck: true }
)

const handleSlackAppDeleted = createUnifiedHandler<BasePayload & { slackAppId?: string }>(
  (payload) => {
    if (payload.slackAppId) {
      useSlackStore().removeSlackAppFromEvent(payload.slackAppId)
    }
  },
  { skipCanvasCheck: true }
)

const handlePodSlackBound = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod)
    }
  }
)

const handlePodSlackUnbound = createUnifiedHandler<BasePayload & { pod?: Pod; canvasId: string }>(
  (payload) => {
    if (payload.pod) {
      usePodStore().updatePod(payload.pod)
    }
  }
)

const handleSlackConnectionStatusChanged = (payload: { slackAppId: string; connectionStatus: SlackAppConnectionStatus; channels?: SlackChannel[] }): void => {
  useSlackStore().updateSlackAppStatus(payload.slackAppId, payload.connectionStatus, payload.channels)
}

const handleSlackMessageReceived = (payload: { podId: string; userName: string; text: string }): void => {
  const { toast } = useToast()
  const truncatedText = truncateContent(payload.text, CONTENT_PREVIEW_LENGTH)
  toast({ title: `Slack 訊息`, description: `來自 ${payload.userName}：${truncatedText}` })
}

const handlePodChatUserMessage = (payload: { podId: string; messageId: string; content: string; timestamp: string }): void => {
  const chatStore = useChatStore()
  chatStore.addRemoteUserMessage(payload.podId, payload.messageId, payload.content, payload.timestamp)
}

export const listeners = [
  { event: WebSocketResponseEvents.POD_CREATED, handler: handlePodCreated },
  { event: WebSocketResponseEvents.POD_MOVED, handler: handlePodMoved },
  { event: WebSocketResponseEvents.POD_RENAMED, handler: handlePodRenamed },
  { event: WebSocketResponseEvents.POD_MODEL_SET, handler: handlePodModelSet },
  { event: WebSocketResponseEvents.POD_SCHEDULE_SET, handler: handlePodScheduleSet },
  { event: WebSocketResponseEvents.POD_DELETED, handler: handlePodDeleted },
  { event: WebSocketResponseEvents.POD_OUTPUT_STYLE_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_OUTPUT_STYLE_UNBOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_SKILL_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_REPOSITORY_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_REPOSITORY_UNBOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_SUBAGENT_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_COMMAND_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_COMMAND_UNBOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_AUTO_CLEAR_SET, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.CONNECTION_CREATED, handler: handleConnectionCreated },
  { event: WebSocketResponseEvents.CONNECTION_UPDATED, handler: handleConnectionUpdated },
  { event: WebSocketResponseEvents.CONNECTION_DELETED, handler: handleConnectionDeleted },
  { event: WebSocketResponseEvents.OUTPUT_STYLE_DELETED, handler: handleOutputStyleDeleted },
  { event: WebSocketResponseEvents.NOTE_CREATED, handler: outputStyleNoteHandlers.created },
  { event: WebSocketResponseEvents.NOTE_UPDATED, handler: outputStyleNoteHandlers.updated },
  { event: WebSocketResponseEvents.NOTE_DELETED, handler: outputStyleNoteHandlers.deleted },
  { event: WebSocketResponseEvents.SKILL_NOTE_CREATED, handler: skillNoteHandlers.created },
  { event: WebSocketResponseEvents.SKILL_NOTE_UPDATED, handler: skillNoteHandlers.updated },
  { event: WebSocketResponseEvents.SKILL_NOTE_DELETED, handler: skillNoteHandlers.deleted },
  { event: WebSocketResponseEvents.SKILL_DELETED, handler: handleSkillDeleted },
  { event: WebSocketResponseEvents.REPOSITORY_WORKTREE_CREATED, handler: handleRepositoryWorktreeCreated },
  { event: WebSocketResponseEvents.REPOSITORY_DELETED, handler: handleRepositoryDeleted },
  { event: WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED, handler: handleRepositoryBranchChanged },
  { event: WebSocketResponseEvents.REPOSITORY_NOTE_CREATED, handler: repositoryNoteHandlers.created },
  { event: WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED, handler: repositoryNoteHandlers.updated },
  { event: WebSocketResponseEvents.REPOSITORY_NOTE_DELETED, handler: repositoryNoteHandlers.deleted },
  { event: WebSocketResponseEvents.SUBAGENT_DELETED, handler: handleSubAgentDeleted },
  { event: WebSocketResponseEvents.SUBAGENT_NOTE_CREATED, handler: subAgentNoteHandlers.created },
  { event: WebSocketResponseEvents.SUBAGENT_NOTE_UPDATED, handler: subAgentNoteHandlers.updated },
  { event: WebSocketResponseEvents.SUBAGENT_NOTE_DELETED, handler: subAgentNoteHandlers.deleted },
  { event: WebSocketResponseEvents.COMMAND_DELETED, handler: handleCommandDeleted },
  { event: WebSocketResponseEvents.COMMAND_NOTE_CREATED, handler: commandNoteHandlers.created },
  { event: WebSocketResponseEvents.COMMAND_NOTE_UPDATED, handler: commandNoteHandlers.updated },
  { event: WebSocketResponseEvents.COMMAND_NOTE_DELETED, handler: commandNoteHandlers.deleted },
  { event: WebSocketResponseEvents.MCP_SERVER_CREATED, handler: handleMcpServerCreated },
  { event: WebSocketResponseEvents.MCP_SERVER_UPDATED, handler: handleMcpServerUpdated },
  { event: WebSocketResponseEvents.MCP_SERVER_DELETED, handler: handleMcpServerDeleted },
  { event: WebSocketResponseEvents.MCP_SERVER_NOTE_CREATED, handler: mcpServerNoteHandlers.created },
  { event: WebSocketResponseEvents.MCP_SERVER_NOTE_UPDATED, handler: mcpServerNoteHandlers.updated },
  { event: WebSocketResponseEvents.MCP_SERVER_NOTE_DELETED, handler: mcpServerNoteHandlers.deleted },
  { event: WebSocketResponseEvents.POD_MCP_SERVER_BOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.POD_MCP_SERVER_UNBOUND, handler: handlePodStateUpdated },
  { event: WebSocketResponseEvents.CANVAS_CREATED, handler: handleCanvasCreated },
  { event: WebSocketResponseEvents.CANVAS_RENAMED, handler: handleCanvasRenamed },
  { event: WebSocketResponseEvents.CANVAS_DELETED, handler: handleCanvasDeleted },
  { event: WebSocketResponseEvents.CANVAS_REORDERED, handler: handleCanvasReordered },
  { event: WebSocketResponseEvents.CANVAS_PASTE_RESULT, handler: handleCanvasPasted },
  { event: WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT, handler: handleWorkflowClearResult },
  { event: WebSocketResponseEvents.SLACK_APP_CREATED, handler: handleSlackAppCreated },
  { event: WebSocketResponseEvents.SLACK_APP_DELETED, handler: handleSlackAppDeleted },
  { event: WebSocketResponseEvents.POD_SLACK_BOUND, handler: handlePodSlackBound },
  { event: WebSocketResponseEvents.POD_SLACK_UNBOUND, handler: handlePodSlackUnbound },
] as const

export function registerUnifiedListeners(): void {
  if (isListenerRegistered.value) return
  isListenerRegistered.value = true

  for (const { event, handler } of listeners) {
    websocketClient.on(event, handler as (payload: unknown) => void)
  }

  websocketClient.on(WebSocketResponseEvents.POD_CHAT_USER_MESSAGE, handlePodChatUserMessage as (payload: unknown) => void)
  websocketClient.on(WebSocketResponseEvents.SLACK_CONNECTION_STATUS_CHANGED, handleSlackConnectionStatusChanged as (payload: unknown) => void)
  websocketClient.on(WebSocketResponseEvents.SLACK_MESSAGE_RECEIVED, handleSlackMessageReceived as (payload: unknown) => void)
}

export function unregisterUnifiedListeners(): void {
  if (!isListenerRegistered.value) return
  isListenerRegistered.value = false

  for (const { event, handler } of listeners) {
    websocketClient.off(event, handler as (payload: unknown) => void)
  }

  websocketClient.off(WebSocketResponseEvents.POD_CHAT_USER_MESSAGE, handlePodChatUserMessage as (payload: unknown) => void)
  websocketClient.off(WebSocketResponseEvents.SLACK_CONNECTION_STATUS_CHANGED, handleSlackConnectionStatusChanged as (payload: unknown) => void)
  websocketClient.off(WebSocketResponseEvents.SLACK_MESSAGE_RECEIVED, handleSlackMessageReceived as (payload: unknown) => void)
}

export const useUnifiedEventListeners = (): {
  registerUnifiedListeners: () => void
  unregisterUnifiedListeners: () => void
} => {
  return {
    registerUnifiedListeners,
    unregisterUnifiedListeners,
  }
}
