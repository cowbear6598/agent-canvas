import type {Connection, ConnectionStatus} from '@/types/connection'
import {isAutoTriggerable} from '@/lib/workflowUtils'
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
    setConnectionStatus: (connectionId: string, status: ConnectionStatus) => void
}

function updateConnectionOrGroupStatus(
    store: WorkflowHandlerStore,
    connectionId: string,
    targetPodId: string,
    triggerMode: string | undefined,
    status: ConnectionStatus
): void {
    if (isAutoTriggerable(triggerMode)) {
        store.updateAutoGroupStatus(targetPodId, status)
    } else {
        store.setConnectionStatus(connectionId, status)
    }
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
        updateConnectionOrGroupStatus(store, payload.connectionId, payload.targetPodId, payload.triggerMode, 'idle')
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
        updateConnectionOrGroupStatus(store, payload.connectionId, payload.targetPodId, payload.triggerMode, 'queued')
    }

    const handleWorkflowQueueProcessed = (payload: WorkflowQueueProcessedPayload): void => {
        updateConnectionOrGroupStatus(store, payload.connectionId, payload.targetPodId, payload.triggerMode, 'active')
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
