import {websocketClient} from '@/services/websocket'
import {useToast} from '@/composables/useToast'
import type {ConnectionReadyPayload, HeartbeatPingPayload, PodErrorPayload} from '@/types/websocket'
import type {ChatStoreInstance} from './chatStore'

const DISCONNECT_REASON_MAP: Record<string, string> = {
    'transport close': '連線已關閉',
    'transport error': '連線傳輸錯誤',
    'ping timeout': '心跳超時',
    'io server disconnect': '伺服器主動斷開',
    'io client disconnect': '客戶端主動斷開',
}

const getDisconnectMessage = (reason: string): string => {
    return DISCONNECT_REASON_MAP[reason] || '未知原因'
}

const HEARTBEAT_CHECK_INTERVAL_MS = 5000
const HEARTBEAT_TIMEOUT_MS = 20000

export function createConnectionActions(store: ChatStoreInstance): {
    initWebSocket: () => void
    disconnectWebSocket: () => void
    handleConnectionReady: (payload: ConnectionReadyPayload) => Promise<void>
    handleHeartbeatPing: (payload: HeartbeatPingPayload, ack: (response?: unknown) => void) => void
    startHeartbeatCheck: () => void
    stopHeartbeatCheck: () => void
    handleSocketDisconnect: (reason: string) => void
    handleError: (payload: PodErrorPayload) => void
} {
    const initWebSocket = (): void => {
        store.connectionStatus = 'connecting'
        websocketClient.connect()
    }

    const disconnectWebSocket = (): void => {
        stopHeartbeatCheck()
        store.unregisterListeners()
        websocketClient.disconnect()

        store.connectionStatus = 'disconnected'
        store.socketId = null
    }

    const handleConnectionReady = async (payload: ConnectionReadyPayload): Promise<void> => {
        store.connectionStatus = 'connected'
        store.socketId = payload.socketId

        startHeartbeatCheck()
    }

    const handleHeartbeatPing = (_: HeartbeatPingPayload, ack: (response?: unknown) => void): void => {
        store.lastHeartbeatAt = Date.now()

        ack({timestamp: Date.now()})

        if (store.connectionStatus !== 'connected') {
            store.connectionStatus = 'connected'
        }
    }

    const startHeartbeatCheck = (): void => {
        if (store.heartbeatCheckTimer !== null) {
            clearInterval(store.heartbeatCheckTimer)
        }

        store.lastHeartbeatAt = null

        store.heartbeatCheckTimer = window.setInterval(() => {
            if (store.lastHeartbeatAt === null) {
                return
            }

            const now = Date.now()
            const elapsed = now - store.lastHeartbeatAt

            if (elapsed > HEARTBEAT_TIMEOUT_MS) {
                stopHeartbeatCheck()
                store.connectionStatus = 'disconnected'

                const {toast} = useToast()
                toast({
                    title: '連線逾時',
                    description: '未收到伺服器心跳回應',
                })
            }
        }, HEARTBEAT_CHECK_INTERVAL_MS)
    }

    const stopHeartbeatCheck = (): void => {
        if (store.heartbeatCheckTimer !== null) {
            clearInterval(store.heartbeatCheckTimer)
            store.heartbeatCheckTimer = null
        }
    }

    const resetConnectionState = (): void => {
        store.socketId = null
        store.lastHeartbeatAt = null
        store.allHistoryLoaded = false
        store.historyLoadingStatus.clear()
        store.historyLoadingError.clear()
    }

    const handleSocketDisconnect = (reason: string): void => {
        store.disconnectReason = reason
        store.connectionStatus = 'disconnected'
        stopHeartbeatCheck()
        resetConnectionState()

        store.isTypingByPodId.clear()

        const {toast} = useToast()
        toast({
            title: '連線中斷',
            description: getDisconnectMessage(reason),
        })
    }

    const handleError = (payload: PodErrorPayload): void => {
        if (!websocketClient.isConnected.value) {
            store.connectionStatus = 'error'
        }

        if (payload.podId) {
            store.setTyping(payload.podId, false)
        }
    }

    return {
        initWebSocket,
        disconnectWebSocket,
        handleConnectionReady,
        handleHeartbeatPing,
        startHeartbeatCheck,
        stopHeartbeatCheck,
        handleSocketDisconnect,
        handleError
    }
}
