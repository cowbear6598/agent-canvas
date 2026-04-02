import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { createWebSocketRequest } from '@/services/websocket'
import { useToast } from '@/composables/useToast'
import { t } from '@/i18n'
import { getActiveCanvasIdOrWarn } from '@/utils/canvasGuard'
import type { ToastCategory } from '@/composables/useToast'
import { isNullResponse } from './noteStoreHelpers'
import { WebSocketRequestEvents, WebSocketResponseEvents } from '@/services/websocket'
import type {
  GroupListPayload,
  GroupListResultPayload,
  GroupCreatePayload,
  GroupCreatedPayload,
  GroupDeletePayload,
  GroupDeletedPayload,
  MoveToGroupPayload,
  MovedToGroupPayload,
} from '@/types/websocket'
import type { Group } from '@/types'

export interface GroupCRUDConfig {
  storeName: string
  groupType: string
  toastCategory: ToastCategory
  moveItemToGroupEvents: {
    request: WebSocketRequestEvents
    response: WebSocketResponseEvents
  }
}

export interface GroupCRUDStoreContext {
  groups: Group[]
  addGroupFromEvent: (group: Group) => void
  removeGroupFromEvent: (groupId: string) => void
  updateItemGroupId: (itemId: string, groupId: string | null) => void
}

export interface GroupCRUDActions {
  loadGroups(this: GroupCRUDStoreContext): Promise<void>
  createGroup(this: GroupCRUDStoreContext, name: string): Promise<{ success: boolean; group?: Group; error?: string }>
  deleteGroup(this: GroupCRUDStoreContext, groupId: string): Promise<{ success: boolean; error?: string }>
  moveItemToGroup(this: GroupCRUDStoreContext, itemId: string, groupId: string | null): Promise<{ success: boolean; error?: string }>
}

type CanvasGuardResult =
  | { canvasId: string; failure: null }
  | { canvasId: null; failure: { success: false; error: string } }

function guardActiveCanvas(storeName: string): CanvasGuardResult {
  const canvasId = getActiveCanvasIdOrWarn(storeName)
  if (!canvasId) return { canvasId: null, failure: { success: false, error: t('store.group.noActiveCanvas') } }
  return { canvasId, failure: null }
}

export function createGroupCRUDActions(config: GroupCRUDConfig): GroupCRUDActions {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler()
  const { showSuccessToast, showErrorToast } = useToast()

  return {
    async loadGroups(this: GroupCRUDStoreContext): Promise<void> {
      const { canvasId } = guardActiveCanvas(config.storeName)
      if (!canvasId) return

      const response = await wrapWebSocketRequest(
        createWebSocketRequest<GroupListPayload, GroupListResultPayload>({
          requestEvent: WebSocketRequestEvents.GROUP_LIST,
          responseEvent: WebSocketResponseEvents.GROUP_LIST_RESULT,
          payload: {
            canvasId,
            type: config.groupType as GroupListPayload['type']
          }
        })
      )

      if (isNullResponse(response, showErrorToast, config.toastCategory, t('store.group.loadFailed'))) return

      if (response.groups) {
        this.groups = response.groups
      }
    },

    async createGroup(this: GroupCRUDStoreContext, name: string): Promise<{ success: boolean; group?: Group; error?: string }> {
      if (!name?.trim()) {
        return { success: false, error: t('store.group.createNameRequired') }
      }

      const { canvasId, failure } = guardActiveCanvas(config.storeName)
      if (failure) return failure

      const response = await wrapWebSocketRequest(
        createWebSocketRequest<GroupCreatePayload, GroupCreatedPayload>({
          requestEvent: WebSocketRequestEvents.GROUP_CREATE,
          responseEvent: WebSocketResponseEvents.GROUP_CREATED,
          payload: {
            canvasId,
            name,
            type: config.groupType as GroupCreatePayload['type']
          }
        })
      )

      if (isNullResponse(response, showErrorToast, config.toastCategory, t('store.group.createFailed'))) return { success: false, error: t('store.group.createFailed') }

      if (response.group) {
        this.addGroupFromEvent(response.group)
        showSuccessToast(config.toastCategory, t('store.group.createSuccess'), name)
      }

      return {
        success: response.success,
        group: response.group as Group,
        error: response.error
      }
    },

    async deleteGroup(this: GroupCRUDStoreContext, groupId: string): Promise<{ success: boolean; error?: string }> {
      if (!groupId?.trim()) {
        return { success: false, error: t('store.group.invalidGroupId') }
      }

      const { canvasId, failure } = guardActiveCanvas(config.storeName)
      if (failure) return failure

      const response = await wrapWebSocketRequest(
        createWebSocketRequest<GroupDeletePayload, GroupDeletedPayload>({
          requestEvent: WebSocketRequestEvents.GROUP_DELETE,
          responseEvent: WebSocketResponseEvents.GROUP_DELETED,
          payload: {
            canvasId,
            groupId
          }
        })
      )

      if (isNullResponse(response, showErrorToast, config.toastCategory, t('store.group.deleteFailed'))) return { success: false, error: t('store.group.deleteFailed') }

      if (response.success && response.groupId) {
        this.removeGroupFromEvent(response.groupId)
        showSuccessToast(config.toastCategory, t('store.group.deleteSuccess'))
      }

      return {
        success: response.success,
        error: response.error
      }
    },

    async moveItemToGroup(this: GroupCRUDStoreContext, itemId: string, groupId: string | null): Promise<{ success: boolean; error?: string }> {
      if (!itemId?.trim()) {
        return { success: false, error: t('store.group.invalidItemId') }
      }

      const { canvasId, failure } = guardActiveCanvas(config.storeName)
      if (failure) return failure

      const response = await wrapWebSocketRequest(
        createWebSocketRequest<MoveToGroupPayload, MovedToGroupPayload>({
          requestEvent: config.moveItemToGroupEvents.request,
          responseEvent: config.moveItemToGroupEvents.response,
          payload: {
            canvasId,
            itemId,
            groupId
          }
        })
      )

      if (isNullResponse(response, showErrorToast, config.toastCategory, t('store.group.moveFailed'))) return { success: false, error: t('store.group.moveFailed') }

      if (response.success && response.itemId) {
        this.updateItemGroupId(response.itemId, response.groupId ?? null)
        showSuccessToast(config.toastCategory, t('store.group.moveSuccess'))
      }

      return {
        success: response.success,
        error: response.error
      }
    },
  }
}
