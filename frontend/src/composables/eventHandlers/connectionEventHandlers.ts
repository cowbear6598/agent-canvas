import { WebSocketResponseEvents } from '@/services/websocket'
import { useConnectionStore } from '@/stores/connectionStore'
import type { Connection } from '@/types'
import { createUnifiedHandler } from './sharedHandlerUtils'
import { t } from '@/i18n'
import type { BasePayload } from './sharedHandlerUtils'

type RawConnectionFromEvent = Omit<Connection, 'status'>

const handleConnectionCreated = createUnifiedHandler<BasePayload & { connection?: RawConnectionFromEvent; canvasId: string }>(
  (payload) => {
    if (payload.connection) {
      useConnectionStore().addConnectionFromEvent(payload.connection)
    }
  },
  { toastMessage: () => t('composable.eventHandler.connectionCreated') }
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
  { toastMessage: () => t('composable.eventHandler.connectionDeleted') }
)

export function getConnectionEventListeners(): Array<{ event: string; handler: (payload: unknown) => void }> {
  return [
    { event: WebSocketResponseEvents.CONNECTION_CREATED, handler: handleConnectionCreated as (payload: unknown) => void },
    { event: WebSocketResponseEvents.CONNECTION_UPDATED, handler: handleConnectionUpdated as (payload: unknown) => void },
    { event: WebSocketResponseEvents.CONNECTION_DELETED, handler: handleConnectionDeleted as (payload: unknown) => void },
  ]
}
