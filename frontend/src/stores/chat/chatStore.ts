import {defineStore} from 'pinia'
import {websocketClient, WebSocketRequestEvents, WebSocketResponseEvents} from '@/services/websocket'
import {generateRequestId} from '@/services/utils'
import type {HistoryLoadingStatus, Message} from '@/types/chat'
import type {
    ConnectionReadyPayload,
    ContentBlock,
    HeartbeatPingPayload,
    PodChatAbortedPayload,
    PodChatAbortPayload,
    PodChatCompletePayload,
    PodChatMessagePayload,
    PodChatSendPayload,
    PodChatToolResultPayload,
    PodChatToolUsePayload,
    PodErrorPayload,
    PodMessagesClearedPayload,
    WorkflowAutoClearedPayload
} from '@/types/websocket'
import type {Command} from '@/types/command'
import {createMessageActions} from './chatMessageActions'
import {createConnectionActions} from './chatConnectionActions'
import {createHistoryActions} from './chatHistoryActions'
import {abortSafetyTimers} from './abortSafetyTimers'
import {usePodStore} from '../pod/podStore'
import {useCommandStore} from '../note/commandStore'
import {getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'

const ABORT_SAFETY_TIMEOUT_MS = 10_000

function buildMessagePayload(
    content: string,
    contentBlocks: ContentBlock[] | undefined,
    command: Command | null | undefined
): string | ContentBlock[] {
    if (!contentBlocks || contentBlocks.length === 0) {
        return command ? `/${command.name} ${content}` : content
    }

    let prefixApplied = false
    const blocks = contentBlocks.map(block => {
        if (block.type === 'text' && command && !prefixApplied) {
            prefixApplied = true
            return { ...block, text: `/${command.name} ${block.text}` }
        }
        return block
    })

    return blocks
}

export type ChatStoreInstance = ReturnType<typeof useChatStore>

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ChatState {
    messagesByPodId: Map<string, Message[]>
    isTypingByPodId: Map<string, boolean>
    currentStreamingMessageId: string | null
    connectionStatus: ConnectionStatus
    socketId: string | null
    historyLoadingStatus: Map<string, HistoryLoadingStatus>
    historyLoadingError: Map<string, string>
    allHistoryLoaded: boolean
    autoClearAnimationPodId: string | null
    disconnectReason: string | null
    lastHeartbeatAt: number | null
    heartbeatCheckTimer: number | null
    accumulatedLengthByMessageId: Map<string, number>
}

export const useChatStore = defineStore('chat', {
    state: (): ChatState => ({
        messagesByPodId: new Map(),
        isTypingByPodId: new Map(),
        currentStreamingMessageId: null,
        connectionStatus: 'disconnected',
        socketId: null,
        historyLoadingStatus: new Map(),
        historyLoadingError: new Map(),
        allHistoryLoaded: false,
        autoClearAnimationPodId: null,
        disconnectReason: null,
        lastHeartbeatAt: null,
        heartbeatCheckTimer: null,
        accumulatedLengthByMessageId: new Map()
    }),

    getters: {
        getMessages: (state) => {
            return (podId: string): Message[] => {
                return state.messagesByPodId.get(podId) || []
            }
        },

        isTyping: (state) => {
            return (podId: string): boolean => {
                return state.isTypingByPodId.get(podId) || false
            }
        },

        isConnected: (state): boolean => {
            return state.connectionStatus === 'connected'
        },

        getHistoryLoadingStatus: (state) => {
            return (podId: string): HistoryLoadingStatus => {
                return state.historyLoadingStatus.get(podId) || 'idle'
            }
        },

        isHistoryLoading: (state) => {
            return (podId: string): boolean => {
                return state.historyLoadingStatus.get(podId) === 'loading'
            }
        },

        isAllHistoryLoaded: (state): boolean => {
            return state.allHistoryLoaded
        },

        getDisconnectReason: (state): string | null => {
            return state.disconnectReason
        }
    },

    actions: {
        initWebSocket(): void {
            const connectionActions = this.getConnectionActions()
            connectionActions.initWebSocket()
        },

        disconnectWebSocket(): void {
            const connectionActions = this.getConnectionActions()
            connectionActions.disconnectWebSocket()
        },

        registerListeners(): void {
            this.unregisterListeners()
            websocketClient.on<ConnectionReadyPayload>(WebSocketResponseEvents.CONNECTION_READY, this.handleConnectionReady)
            websocketClient.on<PodChatMessagePayload>(WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE, this.handleChatMessage)
            websocketClient.on<PodChatToolUsePayload>(WebSocketResponseEvents.POD_CHAT_TOOL_USE, this.handleChatToolUse)
            websocketClient.on<PodChatToolResultPayload>(WebSocketResponseEvents.POD_CHAT_TOOL_RESULT, this.handleChatToolResult)
            websocketClient.on<PodChatCompletePayload>(WebSocketResponseEvents.POD_CHAT_COMPLETE, this.handleChatComplete)
            websocketClient.on<PodChatAbortedPayload>(WebSocketResponseEvents.POD_CHAT_ABORTED, this.handleChatAborted)
            websocketClient.on<PodErrorPayload>(WebSocketResponseEvents.POD_ERROR, this.handleError)
            websocketClient.on<PodMessagesClearedPayload>(WebSocketResponseEvents.POD_MESSAGES_CLEARED, this.handleMessagesClearedEvent)
            websocketClient.on<WorkflowAutoClearedPayload>(WebSocketResponseEvents.WORKFLOW_AUTO_CLEARED, this.handleWorkflowAutoCleared)
            websocketClient.onWithAck<HeartbeatPingPayload>(WebSocketResponseEvents.HEARTBEAT_PING, this.handleHeartbeatPing)
            websocketClient.onDisconnect(this.handleSocketDisconnect)
        },

        unregisterListeners(): void {
            websocketClient.off<ConnectionReadyPayload>(WebSocketResponseEvents.CONNECTION_READY, this.handleConnectionReady)
            websocketClient.off<PodChatMessagePayload>(WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE, this.handleChatMessage)
            websocketClient.off<PodChatToolUsePayload>(WebSocketResponseEvents.POD_CHAT_TOOL_USE, this.handleChatToolUse)
            websocketClient.off<PodChatToolResultPayload>(WebSocketResponseEvents.POD_CHAT_TOOL_RESULT, this.handleChatToolResult)
            websocketClient.off<PodChatCompletePayload>(WebSocketResponseEvents.POD_CHAT_COMPLETE, this.handleChatComplete)
            websocketClient.off<PodChatAbortedPayload>(WebSocketResponseEvents.POD_CHAT_ABORTED, this.handleChatAborted)
            websocketClient.off<PodErrorPayload>(WebSocketResponseEvents.POD_ERROR, this.handleError)
            websocketClient.off<PodMessagesClearedPayload>(WebSocketResponseEvents.POD_MESSAGES_CLEARED, this.handleMessagesClearedEvent)
            websocketClient.off<WorkflowAutoClearedPayload>(WebSocketResponseEvents.WORKFLOW_AUTO_CLEARED, this.handleWorkflowAutoCleared)
            websocketClient.offWithAck<HeartbeatPingPayload>(WebSocketResponseEvents.HEARTBEAT_PING, this.handleHeartbeatPing)
            websocketClient.offDisconnect(this.handleSocketDisconnect)
        },

        handleConnectionReady(payload: ConnectionReadyPayload): Promise<void> {
            const connectionActions = this.getConnectionActions()
            return connectionActions.handleConnectionReady(payload)
        },

        handleHeartbeatPing(payload: HeartbeatPingPayload, ack: (response?: unknown) => void): void {
            const connectionActions = this.getConnectionActions()
            connectionActions.handleHeartbeatPing(payload, ack)
        },

        handleSocketDisconnect(reason: string): void {
            const connectionActions = this.getConnectionActions()
            connectionActions.handleSocketDisconnect(reason)
        },

        handleError(payload: PodErrorPayload): void {
            const connectionActions = this.getConnectionActions()
            connectionActions.handleError(payload)
        },

        async sendMessage(podId: string, content: string, contentBlocks?: ContentBlock[]): Promise<void> {
            if (!this.isConnected) {
                throw new Error('WebSocket 尚未連線')
            }

            const podStore = usePodStore()
            const commandStore = useCommandStore()

            const pod = podStore.pods.find(pod => pod.id === podId)
            const command = pod?.commandId
                ? commandStore.typedAvailableItems.find(command => command.id === pod.commandId)
                : null

            const hasContentBlocks = contentBlocks && contentBlocks.length > 0
            const hasTextContent = content.trim().length > 0
            if (!hasContentBlocks && !hasTextContent) return

            const messagePayload = buildMessagePayload(content, contentBlocks, command)

            const canvasId = getActiveCanvasIdOrWarn('ChatStore')
            if (!canvasId) return

            websocketClient.emit<PodChatSendPayload>(WebSocketRequestEvents.POD_CHAT_SEND, {
                requestId: generateRequestId(),
                canvasId,
                podId,
                message: messagePayload
            })

            this.setTyping(podId, true)
        },

        addUserMessage(podId: string, content: string): Promise<void> {
            const messageActions = this.getMessageActions()
            return messageActions.addUserMessage(podId, content)
        },

        handleChatMessage(payload: PodChatMessagePayload): void {
            const messageActions = this.getMessageActions()
            messageActions.handleChatMessage(payload)
        },

        handleChatToolUse(payload: PodChatToolUsePayload): void {
            const messageActions = this.getMessageActions()
            messageActions.handleChatToolUse(payload)
        },

        handleChatToolResult(payload: PodChatToolResultPayload): void {
            const messageActions = this.getMessageActions()
            messageActions.handleChatToolResult(payload)
        },

        handleChatComplete(payload: PodChatCompletePayload): void {
            const messageActions = this.getMessageActions()
            messageActions.handleChatComplete(payload)
        },

        async abortChat(podId: string): Promise<void> {
            if (!this.isConnected) {
                this.setTyping(podId, false)
                return
            }

            const canvasId = getActiveCanvasIdOrWarn('ChatStore')
            if (!canvasId) return

            websocketClient.emit<PodChatAbortPayload>(WebSocketRequestEvents.POD_CHAT_ABORT, {
                requestId: generateRequestId(),
                canvasId,
                podId
            })

            const existingTimer = abortSafetyTimers.get(podId)
            if (existingTimer) {
                clearTimeout(existingTimer)
            }

            const timer = setTimeout(() => {
                abortSafetyTimers.delete(podId)
                if (this.isTypingByPodId.get(podId)) {
                    this.setTyping(podId, false)
                }
            }, ABORT_SAFETY_TIMEOUT_MS)
            abortSafetyTimers.set(podId, timer)
        },

        handleChatAborted(payload: PodChatAbortedPayload): void {
            const messageActions = this.getMessageActions()
            messageActions.handleChatAborted(payload)
        },

        setTyping(podId: string, isTyping: boolean): void {
            const messageActions = this.getMessageActions()
            messageActions.setTyping(podId, isTyping)
        },

        clearMessagesByPodIds(podIds: string[]): void {
            const messageActions = this.getMessageActions()
            messageActions.clearMessagesByPodIds(podIds)

            podIds.forEach(podId => {
                this.historyLoadingStatus.delete(podId)
                this.historyLoadingError.delete(podId)
            })
        },

        handleMessagesClearedEvent(payload: PodMessagesClearedPayload): Promise<void> {
            const messageActions = this.getMessageActions()
            return messageActions.handleMessagesClearedEvent(payload)
        },

        handleWorkflowAutoCleared(payload: WorkflowAutoClearedPayload): Promise<void> {
            const messageActions = this.getMessageActions()
            return messageActions.handleWorkflowAutoCleared(payload)
        },

        clearAutoClearAnimation(): void {
            this.autoClearAnimationPodId = null
        },

        loadPodChatHistory(podId: string): Promise<void> {
            const historyActions = this.getHistoryActions()
            return historyActions.loadPodChatHistory(podId)
        },

        loadAllPodsHistory(podIds: string[]): Promise<void> {
            const historyActions = this.getHistoryActions()
            return historyActions.loadAllPodsHistory(podIds)
        },

        getConnectionActions() {
            return createConnectionActions(this)
        },

        getMessageActions() {
            return createMessageActions(this)
        },

        getHistoryActions() {
            const messageActions = this.getMessageActions()
            return createHistoryActions(this, messageActions)
        }
    }
})
