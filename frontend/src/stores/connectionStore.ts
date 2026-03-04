import {defineStore} from 'pinia'
import type {AnchorPosition, Connection, ConnectionStatus, DraggingConnection, TriggerMode, WorkflowRole} from '@/types/connection'
import {usePodStore} from '@/stores/pod/podStore'
import {
    createWebSocketRequest,
    websocketClient,
    WebSocketRequestEvents,
    WebSocketResponseEvents
} from '@/services/websocket'
import {useToast} from '@/composables/useToast'
import {useCanvasWebSocketAction} from '@/composables/useCanvasWebSocketAction'
import {getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'
import {DEFAULT_TOAST_DURATION_MS} from '@/lib/constants'
import {createWorkflowEventHandlers} from './workflowEventHandlers'
import {removeById} from '@/lib/arrayHelpers'
import type {
    ConnectionCreatedPayload,
    ConnectionCreatePayload,
    ConnectionDeletedPayload,
    ConnectionDeletePayload,
    ConnectionListPayload,
    ConnectionListResultPayload,
    ConnectionUpdatePayload,
} from '@/types/websocket'

interface RawConnection {
    id: string
    sourcePodId?: string
    sourceAnchor: AnchorPosition
    targetPodId: string
    targetAnchor: AnchorPosition
    triggerMode?: 'auto' | 'ai-decide' | 'direct'
    connectionStatus?: string
    decideReason?: string | null
}

type WorkflowHandlers = ReturnType<typeof createWorkflowEventHandlers>
type WorkflowHandlerPayload<K extends keyof WorkflowHandlers> = Parameters<WorkflowHandlers[K]>[0]

function castHandler<T>(handler: (payload: T) => void): (payload: unknown) => void {
    return handler as (payload: unknown) => void
}

function normalizeConnection(raw: RawConnection): Connection {
    return {
        ...raw,
        triggerMode: (raw.triggerMode ?? 'auto') as TriggerMode,
        status: (raw.connectionStatus as ConnectionStatus) ?? 'idle',
        decideReason: raw.decideReason ?? undefined,
    }
}

const RUNNING_CONNECTION_STATUSES = new Set<ConnectionStatus>([
    'active', 'queued', 'waiting', 'ai-deciding', 'ai-approved'
])

const RUNNING_POD_STATUSES = new Set(['chatting', 'summarizing'])

function shouldUpdateConnection(connection: Connection, targetPodId: string, status: ConnectionStatus): boolean {
    if (connection.targetPodId !== targetPodId) return false
    if (connection.triggerMode !== 'auto' && connection.triggerMode !== 'ai-decide') return false
    // ai-deciding 表示 AI 仍在判斷中，不應被強制設為 active（事件亂序保護）
    if (connection.status === 'ai-deciding' && status === 'active') return false
    return true
}

/**
 * 使用 BFS 而非 DFS，確保在循環或極長鏈中不會發生堆疊溢位，
 * 並能在找到第一個執行中節點時提前返回，避免遍歷整條鏈。
 */
function isAnyNeighborRunning(
    neighbors: { neighborId: string; connection: Connection }[],
    visited: Set<string>,
    queue: string[],
): boolean {
    for (const { neighborId, connection } of neighbors) {
        if (connection.status && RUNNING_CONNECTION_STATUSES.has(connection.status)) return true
        if (!visited.has(neighborId)) {
            visited.add(neighborId)
            queue.push(neighborId)
        }
    }
    return false
}

function processBfsNode(
    currentId: string,
    getNeighbors: (podId: string) => { neighborId: string; connection: Connection }[],
    isRunningPod: (podId: string) => boolean,
    visited: Set<string>,
    queue: string[],
): boolean {
    if (isRunningPod(currentId)) return true
    return isAnyNeighborRunning(getNeighbors(currentId), visited, queue)
}

function runBFS(
    startId: string,
    getNeighbors: (podId: string) => { neighborId: string; connection: Connection }[],
    isRunningPod: (podId: string) => boolean,
): boolean {
    const visited = new Set<string>([startId])
    const queue: string[] = [startId]

    while (queue.length > 0) {
        const currentId = queue.shift()
        if (!currentId) break
        if (processBfsNode(currentId, getNeighbors, isRunningPod, visited, queue)) return true
    }
    return false
}

interface ConnectionState {
    connections: Connection[]
    selectedConnectionId: string | null
    draggingConnection: DraggingConnection | null
}

export const useConnectionStore = defineStore('connection', {
    state: (): ConnectionState => ({
        connections: [],
        selectedConnectionId: null,
        draggingConnection: null,
    }),

    getters: {
        getConnectionsByPodId: (state) => (podId: string): Connection[] => {
            return state.connections.filter(
                connection => connection.sourcePodId === podId || connection.targetPodId === podId
            )
        },

        getOutgoingConnections: (state) => (podId: string): Connection[] => {
            return state.connections.filter(connection => connection.sourcePodId === podId)
        },

        getConnectionsByTargetPodId: (state) => (podId: string): Connection[] => {
            return state.connections.filter(connection => connection.targetPodId === podId)
        },

        selectedConnection: (state): Connection | null => {
            if (!state.selectedConnectionId) return null
            return state.connections.find(connection => connection.id === state.selectedConnectionId) || null
        },

        isSourcePod: (state) => (podId: string): boolean => {
            return !state.connections.some(connection => connection.targetPodId === podId)
        },

        hasUpstreamConnections: (state) => (podId: string): boolean => {
            return state.connections.some(connection => connection.targetPodId === podId)
        },

        getAiDecideConnections: (state): Connection[] => {
            return state.connections.filter(connection => connection.triggerMode === 'ai-decide')
        },

        getAiDecideConnectionsBySourcePodId: (state) => (sourcePodId: string): Connection[] => {
            return state.connections.filter(
                connection => connection.sourcePodId === sourcePodId && connection.triggerMode === 'ai-decide'
            )
        },

        getDirectConnections: (state): Connection[] => {
            return state.connections.filter(connection => connection.triggerMode === 'direct')
        },

        getDirectConnectionsBySourcePodId: (state) => (sourcePodId: string): Connection[] => {
            return state.connections.filter(
                connection => connection.sourcePodId === sourcePodId && connection.triggerMode === 'direct'
            )
        },

        getPodWorkflowRole: (state) => (podId: string): WorkflowRole => {
            const hasUpstream = state.connections.some(connection => connection.targetPodId === podId)
            const hasDownstream = state.connections.some(connection => connection.sourcePodId === podId)

            if (!hasUpstream && !hasDownstream) return 'independent'
            if (!hasUpstream && hasDownstream) return 'head'
            if (hasUpstream && !hasDownstream) return 'tail'
            return 'middle'
        },

        /**
         * 雙向 BFS 遍歷整條 Workflow 鏈（上游 + 下游），
         * 讓 head、tail 或任何連線中的 Pod 都能感知整條鏈的執行狀態，
         * 用於在 Workflow 執行中時封鎖對應 Pod 的輸入。
         */
        isPartOfRunningWorkflow: (state) => (podId: string): boolean => {
            const podStore = usePodStore()

            return runBFS(
                podId,
                (currentId) => {
                    const neighbors: { neighborId: string; connection: Connection }[] = []
                    for (const connection of state.connections) {
                        if (connection.sourcePodId === currentId) {
                            neighbors.push({ neighborId: connection.targetPodId, connection })
                        }
                        if (connection.targetPodId === currentId && connection.sourcePodId) {
                            neighbors.push({ neighborId: connection.sourcePodId, connection })
                        }
                    }
                    return neighbors
                },
                (currentId) => {
                    const pod = podStore.getPodById(currentId)
                    return pod !== undefined && RUNNING_POD_STATUSES.has(pod.status ?? '')
                },
            )
        },

        /**
         * 單向下游 BFS，從指定 Pod 出發往下游遍歷，
         * 用於判斷從某個 head Pod 觸發的 Workflow 是否仍在執行中，
         * 以決定是否允許再次觸發。
         */
        isWorkflowRunning: (state) => (sourcePodId: string): boolean => {
            const podStore = usePodStore()

            return runBFS(
                sourcePodId,
                (currentId) => {
                    return state.connections
                        .filter(connection => connection.sourcePodId === currentId)
                        .map(connection => ({ neighborId: connection.targetPodId, connection }))
                },
                (currentId) => {
                    const pod = podStore.getPodById(currentId)
                    return pod !== undefined && RUNNING_POD_STATUSES.has(pod.status ?? '')
                },
            )
        },
    },

    actions: {
        findConnectionById(connectionId: string): Connection | undefined {
            return this.connections.find(connection => connection.id === connectionId)
        },

        getWorkflowEventMap(): Array<[string, (payload: unknown) => void]> {
            return [
                [WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED, castHandler(this.handleWorkflowAutoTriggered)],
                [WebSocketResponseEvents.WORKFLOW_COMPLETE, castHandler(this.handleWorkflowComplete)],
                [WebSocketResponseEvents.WORKFLOW_AI_DECIDE_PENDING, castHandler(this.handleAiDecidePending)],
                [WebSocketResponseEvents.WORKFLOW_AI_DECIDE_RESULT, castHandler(this.handleAiDecideResult)],
                [WebSocketResponseEvents.WORKFLOW_AI_DECIDE_ERROR, castHandler(this.handleAiDecideError)],
                [WebSocketResponseEvents.WORKFLOW_AI_DECIDE_CLEAR, castHandler(this.handleAiDecideClear)],
                [WebSocketResponseEvents.WORKFLOW_AI_DECIDE_TRIGGERED, castHandler(this.handleWorkflowAiDecideTriggered)],
                [WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED, castHandler(this.handleWorkflowDirectTriggered)],
                [WebSocketResponseEvents.WORKFLOW_DIRECT_WAITING, castHandler(this.handleWorkflowDirectWaiting)],
                [WebSocketResponseEvents.WORKFLOW_QUEUED, castHandler(this.handleWorkflowQueued)],
                [WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED, castHandler(this.handleWorkflowQueueProcessed)],
            ]
        },

        async loadConnectionsFromBackend(): Promise<void> {
            const canvasId = getActiveCanvasIdOrWarn('ConnectionStore')
            if (!canvasId) return

            const response = await createWebSocketRequest<ConnectionListPayload, ConnectionListResultPayload>({
                requestEvent: WebSocketRequestEvents.CONNECTION_LIST,
                responseEvent: WebSocketResponseEvents.CONNECTION_LIST_RESULT,
                payload: {
                    canvasId
                }
            })

            if (response.connections) {
                this.connections = response.connections.map(connection => normalizeConnection(connection))
            }
        },

        validateNewConnection(sourcePodId: string | undefined | null, targetPodId: string): boolean {
            if (sourcePodId === targetPodId) {
                console.warn('[ConnectionStore] 無法將 Pod 連接到自身')
                return false
            }

            if (!sourcePodId) return true

            const alreadyConnected = this.connections.some(
                connection => connection.sourcePodId === sourcePodId && connection.targetPodId === targetPodId
            )
            if (alreadyConnected) {
                const {toast} = useToast()
                toast({
                    title: '連線已存在',
                    description: '這兩個 Pod 之間已經有連線了',
                    duration: DEFAULT_TOAST_DURATION_MS
                })
                return false
            }

            return true
        },

        async createConnection(
            sourcePodId: string | undefined | null,
            sourceAnchor: AnchorPosition,
            targetPodId: string,
            targetAnchor: AnchorPosition
        ): Promise<Connection | null> {
            if (!this.validateNewConnection(sourcePodId, targetPodId)) return null

            const { executeAction } = useCanvasWebSocketAction()

            const basePayload: {
                sourceAnchor: AnchorPosition
                targetPodId: string
                targetAnchor: AnchorPosition
                sourcePodId?: string
            } = {
                sourceAnchor,
                targetPodId,
                targetAnchor,
            }
            if (sourcePodId) {
                basePayload.sourcePodId = sourcePodId
            }

            const result = await executeAction<ConnectionCreatePayload, ConnectionCreatedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.CONNECTION_CREATE,
                    responseEvent: WebSocketResponseEvents.CONNECTION_CREATED,
                    payload: basePayload,
                },
                { errorCategory: 'Connection', errorAction: '建立失敗', errorMessage: '連線建立失敗' }
            )

            if (!result.success || !result.data.connection) return null

            return normalizeConnection(result.data.connection)
        },

        async deleteConnection(connectionId: string): Promise<void> {
            const { executeAction } = useCanvasWebSocketAction()

            await executeAction<ConnectionDeletePayload, ConnectionDeletedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.CONNECTION_DELETE,
                    responseEvent: WebSocketResponseEvents.CONNECTION_DELETED,
                    payload: { connectionId },
                },
                { errorCategory: 'Connection', errorAction: '刪除失敗', errorMessage: '連線刪除失敗' }
            )
        },

        deleteConnectionsByPodId(podId: string): void {
            this.connections = this.connections.filter(
                connection => connection.sourcePodId !== podId && connection.targetPodId !== podId
            )

            if (this.selectedConnectionId) {
                const stillExists = this.connections.some(connection => connection.id === this.selectedConnectionId)
                if (!stillExists) {
                    this.selectedConnectionId = null
                }
            }
        },

        selectConnection(connectionId: string | null): void {
            this.selectedConnectionId = connectionId
        },

        startDragging(
            sourcePodId: string | undefined | null,
            sourceAnchor: AnchorPosition,
            startPoint: { x: number; y: number }
        ): void {
            this.draggingConnection = {
                sourcePodId: sourcePodId ?? undefined,
                sourceAnchor,
                startPoint,
                currentPoint: startPoint
            }
        },

        updateDraggingPosition(currentPoint: { x: number; y: number }): void {
            if (this.draggingConnection) {
                this.draggingConnection.currentPoint = currentPoint
            }
        },

        endDragging(): void {
            this.draggingConnection = null
        },

        updateAutoGroupStatus(targetPodId: string, status: ConnectionStatus): void {
            this.connections.forEach(connection => {
                if (shouldUpdateConnection(connection, targetPodId, status)) {
                    connection.status = status
                }
            })
        },

        updateConnectionStatusByTargetPod(targetPodId: string, status: ConnectionStatus): void {
            this.updateAutoGroupStatus(targetPodId, status)
        },

        setConnectionStatus(connectionId: string, status: ConnectionStatus): void {
            const connection = this.findConnectionById(connectionId)
            if (connection) {
                connection.status = status
            }
        },

        async updateConnectionTriggerMode(connectionId: string, triggerMode: TriggerMode): Promise<Connection | null> {
            const { executeAction } = useCanvasWebSocketAction()

            const result = await executeAction<ConnectionUpdatePayload, ConnectionCreatedPayload>(
                {
                    requestEvent: WebSocketRequestEvents.CONNECTION_UPDATE,
                    responseEvent: WebSocketResponseEvents.CONNECTION_UPDATED,
                    payload: { connectionId, triggerMode },
                },
                { errorCategory: 'Connection', errorAction: '更新失敗', errorMessage: '連線更新失敗' }
            )

            if (!result.success || !result.data.connection) return null

            return normalizeConnection(result.data.connection)
        },

        getWorkflowHandlers() {
            return createWorkflowEventHandlers(this)
        },

        setupWorkflowListeners(): void {
            this.getWorkflowEventMap().forEach(([event, handler]) => {
                websocketClient.on(event, handler)
            })
        },

        cleanupWorkflowListeners(): void {
            this.getWorkflowEventMap().forEach(([event, handler]) => {
                websocketClient.off(event, handler)
            })
        },

        handleWorkflowAutoTriggered(payload: WorkflowHandlerPayload<'handleWorkflowAutoTriggered'>): void {
            this.getWorkflowHandlers().handleWorkflowAutoTriggered(payload)
        },

        handleWorkflowAiDecideTriggered(payload: WorkflowHandlerPayload<'handleWorkflowAiDecideTriggered'>): void {
            this.getWorkflowHandlers().handleWorkflowAiDecideTriggered(payload)
        },

        handleWorkflowComplete(payload: WorkflowHandlerPayload<'handleWorkflowComplete'>): void {
            this.getWorkflowHandlers().handleWorkflowComplete(payload)
        },

        handleWorkflowDirectTriggered(payload: WorkflowHandlerPayload<'handleWorkflowDirectTriggered'>): void {
            this.getWorkflowHandlers().handleWorkflowDirectTriggered(payload)
        },

        handleWorkflowDirectWaiting(payload: WorkflowHandlerPayload<'handleWorkflowDirectWaiting'>): void {
            this.getWorkflowHandlers().handleWorkflowDirectWaiting(payload)
        },

        handleWorkflowQueued(payload: WorkflowHandlerPayload<'handleWorkflowQueued'>): void {
            this.getWorkflowHandlers().handleWorkflowQueued(payload)
        },

        handleWorkflowQueueProcessed(payload: WorkflowHandlerPayload<'handleWorkflowQueueProcessed'>): void {
            this.getWorkflowHandlers().handleWorkflowQueueProcessed(payload)
        },

        handleAiDecidePending(payload: WorkflowHandlerPayload<'handleAiDecidePending'>): void {
            this.getWorkflowHandlers().handleAiDecidePending(payload)
        },

        handleAiDecideResult(payload: WorkflowHandlerPayload<'handleAiDecideResult'>): void {
            this.getWorkflowHandlers().handleAiDecideResult(payload)
        },

        handleAiDecideError(payload: WorkflowHandlerPayload<'handleAiDecideError'>): void {
            this.getWorkflowHandlers().handleAiDecideError(payload)
        },

        handleAiDecideClear(payload: WorkflowHandlerPayload<'handleAiDecideClear'>): void {
            this.getWorkflowHandlers().handleAiDecideClear(payload)
        },

        clearAiDecideStatusByConnectionIds(connectionIds: string[]): void {
            this.getWorkflowHandlers().clearAiDecideStatusByConnectionIds(connectionIds)
        },

        addConnectionFromEvent(connection: Omit<Connection, 'status'>): void {
            const enrichedConnection: Connection = {
                ...connection,
                triggerMode: connection.triggerMode ?? 'auto',
                status: 'idle' as ConnectionStatus
            }

            const exists = this.connections.some(existingConnection => existingConnection.id === enrichedConnection.id)
            if (!exists) {
                this.connections.push(enrichedConnection)
            }
        },

        updateConnectionFromEvent(connection: Omit<Connection, 'status'>): void {
            const index = this.connections.findIndex(existing => existing.id === connection.id)
            if (index === -1) return

            const existingConnection = this.connections[index]
            const enrichedConnection: Connection = {
                ...connection,
                triggerMode: connection.triggerMode ?? 'auto',
                status: existingConnection?.status ?? ('idle' as ConnectionStatus),
                decideReason: connection.decideReason ?? existingConnection?.decideReason
            }

            this.connections.splice(index, 1, enrichedConnection)
        },

        removeConnectionFromEvent(connectionId: string): void {
            this.connections = removeById(this.connections, connectionId)
        },
    },
})
