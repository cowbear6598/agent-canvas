import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { createWebSocketRequest } from '@/services/websocket'
import { useToast } from '@/composables/useToast'
import { getActiveCanvasIdOrWarn } from '@/utils/canvasGuard'
import type { ToastCategory } from '@/composables/useToast'
import { handleNullResponse } from './noteStoreHelpers'
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

export function createGroupCRUDActions(config: GroupCRUDConfig): GroupCRUDActions {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler()
  const { showSuccessToast, showErrorToast } = useToast()

  return {
    async loadGroups(this: GroupCRUDStoreContext): Promise<void> {
      const canvasId = getActiveCanvasIdOrWarn(config.storeName)
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

      const nullResult = handleNullResponse(response, showErrorToast, config.toastCategory, '載入群組失敗')
      if (nullResult) return

      if (response!.groups) {
        this.groups = response!.groups
      }
    },

    async createGroup(this: GroupCRUDStoreContext, name: string): Promise<{ success: boolean; group?: Group; error?: string }> {
      if (!name?.trim()) {
        return { success: false, error: '群組名稱不能為空' }
      }

      const canvasId = getActiveCanvasIdOrWarn(config.storeName)
      if (!canvasId) {
        return { success: false, error: '無作用中的畫布' }
      }

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

      const nullResult = handleNullResponse(response, showErrorToast, config.toastCategory, '建立群組失敗')
      if (nullResult) return nullResult

      if (response!.group) {
        this.addGroupFromEvent(response!.group)
        showSuccessToast(config.toastCategory, '建立群組成功', name)
      }

      return {
        success: response!.success,
        group: response!.group as Group,
        error: response!.error
      }
    },

    async deleteGroup(this: GroupCRUDStoreContext, groupId: string): Promise<{ success: boolean; error?: string }> {
      if (!groupId?.trim()) {
        return { success: false, error: '無效的群組 ID' }
      }

      const canvasId = getActiveCanvasIdOrWarn(config.storeName)
      if (!canvasId) {
        return { success: false, error: '無作用中的畫布' }
      }

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

      const nullResult = handleNullResponse(response, showErrorToast, config.toastCategory, '刪除群組失敗')
      if (nullResult) return nullResult

      if (response!.success && response!.groupId) {
        this.removeGroupFromEvent(response!.groupId)
        showSuccessToast(config.toastCategory, '刪除群組成功')
      }

      return {
        success: response!.success,
        error: response!.error
      }
    },

    async moveItemToGroup(this: GroupCRUDStoreContext, itemId: string, groupId: string | null): Promise<{ success: boolean; error?: string }> {
      if (!itemId?.trim()) {
        return { success: false, error: '無效的項目 ID' }
      }

      const canvasId = getActiveCanvasIdOrWarn(config.storeName)
      if (!canvasId) {
        return { success: false, error: '無作用中的畫布' }
      }

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

      const nullResult = handleNullResponse(response, showErrorToast, config.toastCategory, '移動失敗')
      if (nullResult) return nullResult

      if (response!.success && response!.itemId) {
        this.updateItemGroupId(response!.itemId, response!.groupId ?? null)
        showSuccessToast(config.toastCategory, '移動成功')
      }

      return {
        success: response!.success,
        error: response!.error
      }
    },
  }
}
