import { useWebSocketErrorHandler } from '@/composables/useWebSocketErrorHandler'
import { createWebSocketRequest } from '@/services/websocket'
import { requireActiveCanvas } from '@/utils/canvasGuard'
import { useToast } from '@/composables/useToast'
import type { WebSocketRequestEvents, WebSocketResponseEvents } from '@/types/websocket'
import type { ToastCategory } from '@/composables/useToast'

export function defaultReplaceItemInList<TItem extends { id: string }>(
  items: TItem[],
  itemId: string,
  newItem: { id: string; name: string }
): void {
  const index = items.findIndex(item => item.id === itemId)
  if (index !== -1) {
    items[index] = newItem as unknown as TItem
  }
}

export function defaultMergeItemInList<TItem extends { id: string }>(
  items: TItem[],
  itemId: string,
  newItem: { id: string; name: string }
): void {
  const index = items.findIndex(item => item.id === itemId)
  if (index !== -1) {
    items[index] = { ...items[index], ...newItem } as unknown as TItem
  }
}

export interface CRUDEventsConfig {
  create: {
    request: WebSocketRequestEvents
    response: WebSocketResponseEvents
  }
  update: {
    request: WebSocketRequestEvents
    response: WebSocketResponseEvents
  }
  read: {
    request: WebSocketRequestEvents
    response: WebSocketResponseEvents
  }
}

export interface CRUDPayloadConfig<
  TItem,
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = { id: string; name: string; content: string }
> {
  getCreatePayload?: (name: string, input: TCreateInput) => Record<string, unknown>
  getUpdatePayload: (itemId: string, input: TUpdateInput) => Record<string, unknown>
  getReadPayload: (itemId: string) => Record<string, unknown>
  extractItemFromResponse: {
    create: (response: unknown) => { id: string; name: string } | undefined
    update: (response: unknown) => { id: string; name: string } | undefined
    read: (response: unknown) => TReadResult | undefined
  }
  updateItemsList?: (items: TItem[], itemId: string, newItem: { id: string; name: string }) => void
}

export interface ResourceCRUDActions<
  TItem,
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = { id: string; name: string; content: string }
> {
  create: (
    items: TItem[],
    name: string,
    input: TCreateInput
  ) => Promise<{ success: boolean; item?: { id: string; name: string }; error?: string }>
  update: (
    items: TItem[],
    itemId: string,
    input: TUpdateInput
  ) => Promise<{ success: boolean; item?: { id: string; name: string }; error?: string }>
  read: (itemId: string) => Promise<TReadResult | null>
}

export function createResourceCRUDActions<
  TItem extends { id: string; name: string },
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = { id: string; name: string; content: string }
>(
  resourceType: string,
  events: CRUDEventsConfig,
  config: CRUDPayloadConfig<TItem, TCreateInput, TUpdateInput, TReadResult>,
  toastCategory?: ToastCategory
): ResourceCRUDActions<TItem, TCreateInput, TUpdateInput, TReadResult> {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler()
  const { showSuccessToast, showErrorToast } = useToast()

  return {
    async create(
      items: TItem[],
      name: string,
      input: TCreateInput
    ): Promise<{ success: boolean; item?: { id: string; name: string }; error?: string }> {
      const canvasId = requireActiveCanvas()

      const createPayload = config.getCreatePayload
        ? config.getCreatePayload(name, input)
        : { name, content: input }

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.create.request,
          responseEvent: events.create.response,
          payload: {
            canvasId,
            ...createPayload
          }
        })
      )

      if (!response) {
        if (toastCategory) {
          showErrorToast(toastCategory, '建立失敗', `建立 ${resourceType} 失敗`)
        }
        return { success: false, error: `建立 ${resourceType} 失敗` }
      }

      const item = config.extractItemFromResponse.create(response)
      if (!item) {
        const error = (response as { error?: string }).error || `建立 ${resourceType} 失敗`
        if (toastCategory) {
          showErrorToast(toastCategory, '建立失敗', error)
        }
        return {
          success: false,
          error
        }
      }

      items.push(item as TItem)
      if (toastCategory) {
        showSuccessToast(toastCategory, '建立成功', name)
      }
      return { success: true, item }
    },

    async update(
      items: TItem[],
      itemId: string,
      input: TUpdateInput
    ): Promise<{ success: boolean; item?: { id: string; name: string }; error?: string }> {
      const canvasId = requireActiveCanvas()

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.update.request,
          responseEvent: events.update.response,
          payload: {
            canvasId,
            ...config.getUpdatePayload(itemId, input)
          }
        })
      )

      if (!response) {
        if (toastCategory) {
          showErrorToast(toastCategory, '更新失敗', `更新 ${resourceType} 失敗`)
        }
        return { success: false, error: `更新 ${resourceType} 失敗` }
      }

      const item = config.extractItemFromResponse.update(response)
      if (!item) {
        const error = (response as { error?: string }).error || `更新 ${resourceType} 失敗`
        if (toastCategory) {
          showErrorToast(toastCategory, '更新失敗', error)
        }
        return {
          success: false,
          error
        }
      }

      const updateFn = config.updateItemsList ?? defaultReplaceItemInList
      updateFn(items, itemId, item)
      if (toastCategory) {
        showSuccessToast(toastCategory, '更新成功', item.name)
      }
      return { success: true, item }
    },

    async read(
      itemId: string
    ): Promise<TReadResult | null> {
      const canvasId = requireActiveCanvas()

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.read.request,
          responseEvent: events.read.response,
          payload: {
            canvasId,
            ...config.getReadPayload(itemId)
          }
        })
      )

      if (!response) {
        return null
      }

      return config.extractItemFromResponse.read(response) || null
    }
  }
}
