import { defineStore } from 'pinia'
import { createWebSocketRequest, websocketClient, WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import { generateRequestId } from '@/services/utils'
import { getActiveCanvasIdOrWarn } from '@/utils/canvasGuard'
import { MAX_RUNS_PER_CANVAS } from '@/lib/constants'
import type { WorkflowRun, RunStatus, RunPodStatus } from '@/types/run'
import type { Message } from '@/types/chat'
import type {
    RunDeletePayload,
    RunLoadHistoryPayload,
    RunLoadPodMessagesPayload,
} from '@/types/websocket/requests'
import type {
    RunHistoryResultPayload,
    RunPodMessagesResultPayload,
    PersistedMessage,
} from '@/types/websocket/responses'

interface RunState {
    runs: WorkflowRun[]
    isHistoryPanelOpen: boolean
    expandedRunIds: Set<string>
    activeRunChatModal: { runId: string; podId: string } | null
    runChatMessages: Map<string, Message[]>
    isLoadingPodMessages: boolean
}

function toMessage(pm: PersistedMessage): Message {
    return {
        id: pm.id,
        role: pm.role,
        content: pm.content,
        isPartial: false,
        ...(pm.subMessages && {
            subMessages: pm.subMessages.map(sm => ({
                id: `${pm.id}-${sm.toolUse?.[0]?.toolUseId ?? 'sub'}`,
                content: sm.content,
                toolUse: sm.toolUse?.map(tu => ({
                    toolUseId: tu.toolUseId,
                    toolName: tu.toolName,
                    input: tu.input,
                    output: tu.output,
                    status: tu.status as 'pending' | 'running' | 'completed' | 'error',
                })),
            })),
        }),
    }
}

function findRunChatMessage(
    messages: Map<string, Message[]>,
    runId: string,
    podId: string,
    messageId: string
): Message | undefined {
    const key = `${runId}:${podId}`
    const msgs = messages.get(key)
    if (!msgs) return undefined
    return msgs.find(m => m.id === messageId)
}

export const useRunStore = defineStore('run', {
    state: (): RunState => ({
        runs: [],
        isHistoryPanelOpen: false,
        expandedRunIds: new Set(),
        activeRunChatModal: null,
        runChatMessages: new Map(),
        isLoadingPodMessages: false,
    }),

    getters: {
        sortedRuns: (state): WorkflowRun[] => {
            return [...state.runs]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, MAX_RUNS_PER_CANVAS)
        },

        runningRunsCount: (state): number => {
            return state.runs.filter(run => run.status === 'running').length
        },

        getRunById: (state) => (runId: string): WorkflowRun | undefined => {
            return state.runs.find(run => run.id === runId)
        },

        getActiveRunChatMessages(state): Message[] {
            if (!state.activeRunChatModal) return []
            const { runId, podId } = state.activeRunChatModal
            const key = `${runId}:${podId}`
            return state.runChatMessages.get(key) ?? []
        },
    },

    actions: {
        async loadRuns(): Promise<void> {
            const canvasId = getActiveCanvasIdOrWarn('RunStore')
            if (!canvasId) return

            try {
                const response = await createWebSocketRequest<RunLoadHistoryPayload, RunHistoryResultPayload>({
                    requestEvent: WebSocketRequestEvents.RUN_LOAD_HISTORY,
                    responseEvent: WebSocketResponseEvents.RUN_HISTORY_RESULT,
                    payload: { canvasId },
                })

                if (response.success && response.runs) {
                    this.runs = response.runs
                }
            } catch {
                // WebSocket 請求超時或失敗，靜默處理
            }
        },

        addRun(run: WorkflowRun): void {
            const exists = this.runs.some(r => r.id === run.id)
            if (exists) return

            this.runs.unshift(run)

            if (this.runs.length > MAX_RUNS_PER_CANVAS) {
                this.runs = this.runs.slice(0, MAX_RUNS_PER_CANVAS)
            }
        },

        updateRunStatus(runId: string, status: RunStatus, completedAt?: string): void {
            const run = this.runs.find(r => r.id === runId)
            if (!run) return

            run.status = status
            if (completedAt) {
                run.completedAt = completedAt
            }
        },

        updatePodInstanceStatus(payload: {
            runId: string
            podId: string
            status: RunPodStatus
            lastResponseSummary?: string
            errorMessage?: string
            triggeredAt?: string
            completedAt?: string
            autoPathwaySettled?: boolean | null
            directPathwaySettled?: boolean | null
        }): void {
            const run = this.runs.find(r => r.id === payload.runId)
            if (!run) return

            const podInstance = run.podInstances.find(p => p.podId === payload.podId)
            if (!podInstance) return

            podInstance.status = payload.status
            if (payload.lastResponseSummary !== undefined) {
                podInstance.lastResponseSummary = payload.lastResponseSummary
            }
            if (payload.errorMessage !== undefined) {
                podInstance.errorMessage = payload.errorMessage
            }
            if (payload.triggeredAt !== undefined) {
                podInstance.triggeredAt = payload.triggeredAt
            }
            if (payload.completedAt !== undefined) {
                podInstance.completedAt = payload.completedAt
            }
            if (payload.autoPathwaySettled !== undefined) {
                podInstance.autoPathwaySettled = payload.autoPathwaySettled
            }
            if (payload.directPathwaySettled !== undefined) {
                podInstance.directPathwaySettled = payload.directPathwaySettled
            }
        },

        removeRun(runId: string): void {
            this.runs = this.runs.filter(r => r.id !== runId)
            this.expandedRunIds.delete(runId)

            if (this.activeRunChatModal?.runId === runId) {
                this.activeRunChatModal = null
            }

            for (const key of this.runChatMessages.keys()) {
                if (key.startsWith(`${runId}:`)) {
                    this.runChatMessages.delete(key)
                }
            }
        },

        deleteRun(runId: string): void {
            const canvasId = getActiveCanvasIdOrWarn('RunStore')
            if (!canvasId) return

            websocketClient.emit<RunDeletePayload>(WebSocketRequestEvents.RUN_DELETE, {
                requestId: generateRequestId(),
                canvasId,
                runId,
            })

            this.removeRun(runId)
        },

        toggleHistoryPanel(): void {
            this.isHistoryPanelOpen = !this.isHistoryPanelOpen
        },

        openHistoryPanel(): void {
            this.isHistoryPanelOpen = true
        },

        toggleRunExpanded(runId: string): void {
            if (this.expandedRunIds.has(runId)) {
                this.expandedRunIds.delete(runId)
            } else {
                this.expandedRunIds.add(runId)
            }
        },

        async openRunChatModal(runId: string, podId: string): Promise<void> {
            this.activeRunChatModal = { runId, podId }
            this.isLoadingPodMessages = true

            const canvasId = getActiveCanvasIdOrWarn('RunStore')
            if (!canvasId) {
                this.isLoadingPodMessages = false
                return
            }

            try {
                const response = await createWebSocketRequest<RunLoadPodMessagesPayload, RunPodMessagesResultPayload>({
                    requestEvent: WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES,
                    responseEvent: WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
                    payload: { canvasId, runId, podId },
                })

                if (response.success && response.messages) {
                    const key = `${runId}:${podId}`
                    this.runChatMessages.set(key, response.messages.map(toMessage))
                }
            } finally {
                this.isLoadingPodMessages = false
            }
        },

        closeRunChatModal(): void {
            this.activeRunChatModal = null
        },

        appendRunChatMessage(
            runId: string,
            podId: string,
            messageId: string,
            content: string,
            isPartial: boolean,
            role: 'user' | 'assistant'
        ): void {
            const key = `${runId}:${podId}`
            const messages = this.runChatMessages.get(key) ?? []

            const existingIndex = messages.findIndex(m => m.id === messageId)
            if (existingIndex !== -1) {
                const existing = messages[existingIndex]
                if (existing) {
                    messages[existingIndex] = { ...existing, content, isPartial: isPartial }
                }
            } else {
                messages.push({
                    id: messageId,
                    role,
                    content,
                    isPartial: isPartial,
                })
            }

            this.runChatMessages.set(key, messages)
        },

        handleRunChatToolUse(payload: {
            runId: string
            podId: string
            messageId: string
            toolUseId: string
            toolName: string
            input: Record<string, unknown>
        }): void {
            const message = findRunChatMessage(this.runChatMessages, payload.runId, payload.podId, payload.messageId)
            if (!message) return

            const subMessages = message.subMessages ?? []
            subMessages.push({
                id: payload.toolUseId,
                content: '',
                toolUse: [{
                    toolUseId: payload.toolUseId,
                    toolName: payload.toolName,
                    input: payload.input,
                    status: 'running',
                }],
            })
            message.subMessages = subMessages
        },

        handleRunChatToolResult(payload: {
            runId: string
            podId: string
            messageId: string
            toolUseId: string
            toolName: string
            output: string
        }): void {
            const message = findRunChatMessage(this.runChatMessages, payload.runId, payload.podId, payload.messageId)
            if (!message?.subMessages) return

            for (const subMessage of message.subMessages) {
                if (!subMessage.toolUse) continue
                const toolUseEntry = subMessage.toolUse.find(t => t.toolUseId === payload.toolUseId)
                if (toolUseEntry) {
                    toolUseEntry.output = payload.output
                    toolUseEntry.status = 'completed'
                    return
                }
            }
        },

        handleRunChatComplete(
            runId: string,
            podId: string,
            messageId: string,
            fullContent: string
        ): void {
            const key = `${runId}:${podId}`
            const messages = this.runChatMessages.get(key)
            if (!messages) return

            const message = messages.find(m => m.id === messageId)
            if (!message) return

            message.isPartial = false
            message.content = fullContent
        },

        resetOnCanvasSwitch(): void {
            this.runs = []
            this.expandedRunIds = new Set()
            this.activeRunChatModal = null
            this.runChatMessages = new Map()
            this.isHistoryPanelOpen = false
        },
    },
})
