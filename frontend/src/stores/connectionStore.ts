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
import {requireActiveCanvas, getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'
import {DEFAULT_TOAST_DURATION_MS} from '@/lib/constants'
import {createWorkflowEventHandlers} from './workflowEventHandlers'
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

function shouldUpdateConnection(conn: Connection, targetPodId: string, status: ConnectionStatus): boolean {
    if (conn.targetPodId !== targetPodId) return false
    if (conn.triggerMode !== 'auto' && conn.triggerMode !== 'ai-decide') return false
    // ai-deciding 表示 AI 仍在判斷中，不應被強制設為 active（事件亂序保護）
    if (conn.status === 'ai-deciding' && status === 'active') return false
    return true
}

/**
 * 通用 BFS 遍歷，檢查 Workflow 鏈中是否有正在執行的節點或連線。
 *
 * @param startId - 起始 Pod 的 ID
 * @param getNeighbors - 根據 podId 回傳鄰居清單（包含鄰居 ID 及對應連線）
 * @param isRunningPod - 判斷特定 podId 的 Pod 是否正在執行中
 */
function isAnyNeighborRunning(
    neighbors: { neighborId: string; conn: Connection }[],
    visited: Set<string>,
    queue: string[],
): boolean {
    for (const { neighborId, conn } of neighbors) {
        if (conn.status && RUNNING_CONNECTION_STATUSES.has(conn.status)) return true
        if (!visited.has(neighborId)) {
            visited.add(neighborId)
            queue.push(neighborId)
        }
    }
    return false
}

function runBFS(
    startId: string,
    getNeighbors: (podId: string) => { neighborId: string; conn: Connection }[],
    isRunningPod: (podId: string) => boolean,
): boolean {
    const visited = new Set<string>([startId])
    const queue: string[] = [startId]

    while (queue.length > 0) {
        const currentId = queue.shift()!
        if (isRunningPod(currentId)) return true
        if (isAnyNeighborRunning(getNeighbors(currentId), visited, queue)) return true
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
                conn => conn.sourcePodId === podId || conn.targetPodId === podId
            )
        },

        getOutgoingConnections: (state) => (podId: string): Connection[] => {
            return state.connections.filter(conn => conn.sourcePodId === podId)
        },

        getConnectionsByTargetPodId: (state) => (podId: string): Connection[] => {
            return state.connections.filter(conn => conn.targetPodId === podId)
        },

        selectedConnection: (state): Connection | null => {
            if (!state.selectedConnectionId) return null
            return state.connections.find(connection => connection.id === state.selectedConnectionId) || null
        },

        isSourcePod: (state) => (podId: string): boolean => {
            return !state.connections.some(conn => conn.targetPodId === podId)
        },

        hasUpstreamConnections: (state) => (podId: string): boolean => {
            return state.connections.some(conn => conn.targetPodId === podId)
        },

        getAiDecideConnections: (state): Connection[] => {
            return state.connections.filter(conn => conn.triggerMode === 'ai-decide')
        },

        getAiDecideConnectionsBySourcePodId: (state) => (sourcePodId: string): Connection[] => {
            return state.connections.filter(
                conn => conn.sourcePodId === sourcePodId && conn.triggerMode === 'ai-decide'
            )
        },

        getDirectConnections: (state): Connection[] => {
            return state.connections.filter(conn => conn.triggerMode === 'direct')
        },

        getDirectConnectionsBySourcePodId: (state) => (sourcePodId: string): Connection[] => {
            return state.connections.filter(
                conn => conn.sourcePodId === sourcePodId && conn.triggerMode === 'direct'
            )
        },

        getPodWorkflowRole: (state) => (podId: string): WorkflowRole => {
            const hasUpstream = state.connections.some(conn => conn.targetPodId === podId)
            const hasDownstream = state.connections.some(conn => conn.sourcePodId === podId)

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
                    const neighbors: { neighborId: string; conn: Connection }[] = []
                    for (const conn of state.connections) {
                        if (conn.sourcePodId === currentId) {
                            neighbors.push({ neighborId: conn.targetPodId, conn })
                        }
                        if (conn.targetPodId === currentId && conn.sourcePodId) {
                            neighbors.push({ neighborId: conn.sourcePodId, conn })
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
                        .filter(conn => conn.sourcePodId === currentId)
                        .map(conn => ({ neighborId: conn.targetPodId, conn }))
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
                this.connections = response.connections.map(conn => normalizeConnection(conn))
            }
        },

        validateNewConnection(sourcePodId: string | undefined | null, targetPodId: string): boolean {
            if (sourcePodId === targetPodId) {
                console.warn('[ConnectionStore] 無法將 Pod 連接到自身')
                return false
            }

            if (!sourcePodId) return true

            const alreadyConnected = this.connections.some(
                conn => conn.sourcePodId === sourcePodId && conn.targetPodId === targetPodId
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

            const canvasId = requireActiveCanvas()

            const payload: ConnectionCreatePayload = {
                requestId: '',
                canvasId,
                sourceAnchor,
                targetPodId,
                targetAnchor,
            }

            if (sourcePodId) {
                payload.sourcePodId = sourcePodId
            }

            const response = await createWebSocketRequest<ConnectionCreatePayload, ConnectionCreatedPayload>({
                requestEvent: WebSocketRequestEvents.CONNECTION_CREATE,
                responseEvent: WebSocketResponseEvents.CONNECTION_CREATED,
                payload
            })

            if (!response.connection) {
                return null
            }

            return normalizeConnection(response.connection)
        },

        async deleteConnection(connectionId: string): Promise<void> {
            const canvasId = requireActiveCanvas()

            await createWebSocketRequest<ConnectionDeletePayload, ConnectionDeletedPayload>({
                requestEvent: WebSocketRequestEvents.CONNECTION_DELETE,
                responseEvent: WebSocketResponseEvents.CONNECTION_DELETED,
                payload: {
                    canvasId,
                    connectionId
                }
            })
        },

        deleteConnectionsByPodId(podId: string): void {
            this.connections = this.connections.filter(
                conn => conn.sourcePodId !== podId && conn.targetPodId !== podId
            )

            if (this.selectedConnectionId) {
                const stillExists = this.connections.some(conn => conn.id === this.selectedConnectionId)
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

        updateConnectionStatusByTargetPod(targetPodId: string, status: ConnectionStatus): void {
            this.connections.forEach(conn => {
                if (conn.targetPodId === targetPodId) {
                    // ai-deciding 表示 AI 仍在判斷中，不應被強制設為 active（事件亂序保護）
                    if (conn.status === 'ai-deciding' && status === 'active') {
                        return
                    }
                    conn.status = status
                }
            })
        },

        updateAutoGroupStatus(targetPodId: string, status: ConnectionStatus): void {
            this.connections.forEach(conn => {
                if (shouldUpdateConnection(conn, targetPodId, status)) {
                    conn.status = status
                }
            })
        },

        async updateConnectionTriggerMode(connectionId: string, triggerMode: TriggerMode): Promise<Connection | null> {
            const canvasId = requireActiveCanvas()

            const response = await createWebSocketRequest<ConnectionUpdatePayload, ConnectionCreatedPayload>({
                requestEvent: WebSocketRequestEvents.CONNECTION_UPDATE,
                responseEvent: WebSocketResponseEvents.CONNECTION_UPDATED,
                payload: {
                    canvasId,
                    connectionId,
                    triggerMode
                }
            })

            if (!response.connection) {
                return null
            }

            return normalizeConnection(response.connection)
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

        handleWorkflowAutoTriggered(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowAutoTriggered']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowAutoTriggered(payload)
        },

        handleWorkflowAiDecideTriggered(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowAiDecideTriggered']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowAiDecideTriggered(payload)
        },

        handleWorkflowComplete(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowComplete']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowComplete(payload)
        },

        handleWorkflowDirectTriggered(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowDirectTriggered']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowDirectTriggered(payload)
        },

        handleWorkflowDirectWaiting(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowDirectWaiting']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowDirectWaiting(payload)
        },

        handleWorkflowQueued(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowQueued']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowQueued(payload)
        },

        handleWorkflowQueueProcessed(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleWorkflowQueueProcessed']>[0]): void {
            this.getWorkflowHandlers().handleWorkflowQueueProcessed(payload)
        },

        handleAiDecidePending(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleAiDecidePending']>[0]): void {
            this.getWorkflowHandlers().handleAiDecidePending(payload)
        },

        handleAiDecideResult(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleAiDecideResult']>[0]): void {
            this.getWorkflowHandlers().handleAiDecideResult(payload)
        },

        handleAiDecideError(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleAiDecideError']>[0]): void {
            this.getWorkflowHandlers().handleAiDecideError(payload)
        },

        handleAiDecideClear(payload: Parameters<ReturnType<typeof createWorkflowEventHandlers>['handleAiDecideClear']>[0]): void {
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

            const exists = this.connections.some(conn => conn.id === enrichedConnection.id)
            if (!exists) {
                this.connections.push(enrichedConnection)
            }
        },

        updateConnectionFromEvent(connection: Omit<Connection, 'status'>): void {
            const existingConnection = this.connections.find(conn => conn.id === connection.id)
            const enrichedConnection: Connection = {
                ...connection,
                triggerMode: connection.triggerMode ?? 'auto',
                status: existingConnection?.status ?? 'idle' as ConnectionStatus,
                decideReason: connection.decideReason ?? existingConnection?.decideReason
            }

            const index = this.connections.findIndex(conn => conn.id === enrichedConnection.id)
            if (index !== -1) {
                this.connections.splice(index, 1, enrichedConnection)
            }
        },

        removeConnectionFromEvent(connectionId: string): void {
            this.connections = this.connections.filter(connection => connection.id !== connectionId)
        },
    },
})
