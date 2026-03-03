import type {Connection, ConnectionStatus} from '@/types/connection'
import type {
    WorkflowAutoTriggeredPayload,
    WorkflowCompletePayload,
    WorkflowAiDecidePendingPayload,
    WorkflowAiDecideResultPayload,
    WorkflowAiDecideErrorPayload,
    WorkflowAiDecideClearPayload,
    WorkflowAiDecideTriggeredPayload,
    WorkflowDirectTriggeredPayload,
    WorkflowDirectWaitingPayload,
    WorkflowQueuedPayload,
    WorkflowQueueProcessedPayload
} from '@/types/websocket'

interface WorkflowHandlerStore {
    connections: Connection[]
    findConnectionById: (connectionId: string) => Connection | undefined
    updateAutoGroupStatus: (targetPodId: string, status: ConnectionStatus) => void
}

export function createWorkflowEventHandlers(store: WorkflowHandlerStore): {
    handleWorkflowAutoTriggered: (payload: WorkflowAutoTriggeredPayload) => void
    handleWorkflowAiDecideTriggered: (payload: WorkflowAiDecideTriggeredPayload) => void
    handleWorkflowComplete: (payload: WorkflowCompletePayload) => void
    handleWorkflowDirectTriggered: (payload: WorkflowDirectTriggeredPayload) => void
    handleWorkflowDirectWaiting: (payload: WorkflowDirectWaitingPayload) => void
    handleWorkflowQueued: (payload: WorkflowQueuedPayload) => void
    handleWorkflowQueueProcessed: (payload: WorkflowQueueProcessedPayload) => void
    handleAiDecidePending: (payload: WorkflowAiDecidePendingPayload) => void
    handleAiDecideResult: (payload: WorkflowAiDecideResultPayload) => void
    handleAiDecideError: (payload: WorkflowAiDecideErrorPayload) => void
    handleAiDecideClear: (payload: WorkflowAiDecideClearPayload) => void
    clearAiDecideStatusByConnectionIds: (connectionIds: string[]) => void
} {
    const handleWorkflowAutoTriggered = (payload: WorkflowAutoTriggeredPayload): void => {
        store.updateAutoGroupStatus(payload.targetPodId, 'active')
    }

    const handleWorkflowAiDecideTriggered = (payload: WorkflowAiDecideTriggeredPayload): void => {
        store.updateAutoGroupStatus(payload.targetPodId, 'active')
    }

    const handleWorkflowComplete = (payload: WorkflowCompletePayload): void => {
        const triggerMode = payload.triggerMode
        if (triggerMode === 'auto' || triggerMode === 'ai-decide') {
            store.updateAutoGroupStatus(payload.targetPodId, 'idle')
        } else {
            const connection = store.findConnectionById(payload.connectionId)
            if (connection) {
                connection.status = 'idle'
            }
        }
    }

    const handleWorkflowDirectTriggered = (payload: WorkflowDirectTriggeredPayload): void => {
        const connection = store.findConnectionById(payload.connectionId)
        if (connection) {
            connection.status = 'active'
        }
    }

    const handleWorkflowDirectWaiting = (payload: WorkflowDirectWaitingPayload): void => {
        const connection = store.findConnectionById(payload.connectionId)
        if (connection) {
            connection.status = 'waiting'
        }
    }

    const handleWorkflowQueued = (payload: WorkflowQueuedPayload): void => {
        if (payload.triggerMode === 'auto' || payload.triggerMode === 'ai-decide') {
            store.updateAutoGroupStatus(payload.targetPodId, 'queued')
        } else {
            const connection = store.findConnectionById(payload.connectionId)
            if (connection) {
                connection.status = 'queued'
            }
        }
    }

    const handleWorkflowQueueProcessed = (payload: WorkflowQueueProcessedPayload): void => {
        if (payload.triggerMode === 'auto' || payload.triggerMode === 'ai-decide') {
            store.updateAutoGroupStatus(payload.targetPodId, 'active')
        } else {
            const connection = store.findConnectionById(payload.connectionId)
            if (connection) {
                connection.status = 'active'
            }
        }
    }

    function updateConnectionStatuses(
        connectionIds: string[],
        status: ConnectionStatus,
        decideReason?: string
    ): void {
        for (const connectionId of connectionIds) {
            const connection = store.findConnectionById(connectionId)
            if (!connection) continue
            connection.status = status
            connection.decideReason = decideReason
        }
    }

    const handleAiDecidePending = (payload: WorkflowAiDecidePendingPayload): void => {
        updateConnectionStatuses(payload.connectionIds, 'ai-deciding', undefined)
    }

    const handleAiDecideResult = (payload: WorkflowAiDecideResultPayload): void => {
        const connection = store.findConnectionById(payload.connectionId)
        if (connection) {
            connection.status = payload.shouldTrigger ? 'ai-approved' : 'ai-rejected'
            connection.decideReason = payload.shouldTrigger ? undefined : payload.reason
        }
    }

    const handleAiDecideError = (payload: WorkflowAiDecideErrorPayload): void => {
        const connection = store.findConnectionById(payload.connectionId)
        if (connection) {
            connection.status = 'ai-error'
            connection.decideReason = payload.error
        }
    }

    const handleAiDecideClear = (payload: WorkflowAiDecideClearPayload): void => {
        clearAiDecideStatusByConnectionIds(payload.connectionIds)
    }

    const clearAiDecideStatusByConnectionIds = (connectionIds: string[]): void => {
        updateConnectionStatuses(connectionIds, 'idle', undefined)
    }

    return {
        handleWorkflowAutoTriggered,
        handleWorkflowAiDecideTriggered,
        handleWorkflowComplete,
        handleWorkflowDirectTriggered,
        handleWorkflowDirectWaiting,
        handleWorkflowQueued,
        handleWorkflowQueueProcessed,
        handleAiDecidePending,
        handleAiDecideResult,
        handleAiDecideError,
        handleAiDecideClear,
        clearAiDecideStatusByConnectionIds,
    }
}
