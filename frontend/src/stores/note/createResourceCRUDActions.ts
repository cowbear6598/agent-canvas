import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { createWebSocketRequest } from "@/services/websocket";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import type {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket";
import type { ToastCategory } from "@/composables/useToast";

// 各資源的 WebSocket payload 欄位不同，無法以單一靜態型別表達
export type ResourcePayload = Record<string, unknown>;

// TItem 可能包含比 { id, name } 更多的欄位，因此需要 as unknown as TItem 斷言。
// 後端回傳的 newItem 結構已涵蓋所有必要欄位，類型上的差異是泛型設計的限制。
export function defaultReplaceItemInList<TItem extends { id: string }>(
  items: TItem[],
  itemId: string,
  newItem: { id: string; name: string },
): void {
  const index = items.findIndex((item) => item.id === itemId);
  if (index !== -1) {
    items[index] = newItem as unknown as TItem;
  }
}

export function defaultMergeItemInList<TItem extends { id: string }>(
  items: TItem[],
  itemId: string,
  newItem: { id: string; name: string },
): void {
  const index = items.findIndex((item) => item.id === itemId);
  if (index !== -1) {
    items[index] = { ...items[index], ...newItem } as unknown as TItem;
  }
}

export interface CRUDEventsConfig {
  create: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
  update: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
  read: {
    request: WebSocketRequestEvents;
    response: WebSocketResponseEvents;
  };
}

export interface CRUDPayloadConfig<
  TItem,
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = {
    id: string;
    name: string;
    content: string;
  },
> {
  getCreatePayload?: (name: string, input: TCreateInput) => ResourcePayload;
  getUpdatePayload: (itemId: string, input: TUpdateInput) => ResourcePayload;
  getReadPayload: (itemId: string) => ResourcePayload;
  extractItemFromResponse: {
    create: (response: unknown) => { id: string; name: string } | undefined;
    update: (response: unknown) => { id: string; name: string } | undefined;
    read: (response: unknown) => TReadResult | undefined;
  };
  updateItemsList?: (
    items: TItem[],
    itemId: string,
    newItem: { id: string; name: string },
  ) => void;
}

export interface ResourceCRUDActions<
  TItem,
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = {
    id: string;
    name: string;
    content: string;
  },
> {
  create: (
    items: TItem[],
    name: string,
    input: TCreateInput,
  ) => Promise<{
    success: boolean;
    item?: { id: string; name: string };
    error?: string;
  }>;
  update: (
    items: TItem[],
    itemId: string,
    input: TUpdateInput,
  ) => Promise<{
    success: boolean;
    item?: { id: string; name: string };
    error?: string;
  }>;
  read: (itemId: string) => Promise<TReadResult | null>;
}

/**
 * 通用 CRUD response 處理 helper。
 * 封裝「檢查 response → 提取 item → toast → 回傳結果」的重複骨架。
 */
function handleCRUDResponse<T extends { id: string; name: string }>(
  response: unknown,
  extractor: (resp: unknown) => T | undefined,
  onSuccess: (item: T) => void,
  onError: (error: string) => void,
  fallbackError: string,
): { success: boolean; item?: T; error?: string } {
  if (!response) {
    onError(fallbackError);
    return { success: false, error: fallbackError };
  }

  const item = extractor(response);
  if (!item) {
    const error = (response as { error?: string }).error || fallbackError;
    onError(error);
    return { success: false, error };
  }

  onSuccess(item);
  return { success: true, item };
}

export function createResourceCRUDActions<
  TItem extends { id: string; name: string },
  TCreateInput = string,
  TUpdateInput = string,
  TReadResult extends { id: string; name: string } = {
    id: string;
    name: string;
    content: string;
  },
>(
  resourceType: string,
  events: CRUDEventsConfig,
  config: CRUDPayloadConfig<TItem, TCreateInput, TUpdateInput, TReadResult>,
  toastCategory?: ToastCategory,
): ResourceCRUDActions<TItem, TCreateInput, TUpdateInput, TReadResult> {
  const { wrapWebSocketRequest } = useWebSocketErrorHandler();
  const { showSuccessToast, showErrorToast } = useToast();

  return {
    async create(
      items: TItem[],
      name: string,
      input: TCreateInput,
    ): Promise<{
      success: boolean;
      item?: { id: string; name: string };
      error?: string;
    }> {
      const canvasId = requireActiveCanvas();

      const createPayload = config.getCreatePayload
        ? config.getCreatePayload(name, input)
        : { name, content: input };

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.create.request,
          responseEvent: events.create.response,
          payload: {
            canvasId,
            ...createPayload,
          },
        }),
      );

      return handleCRUDResponse(
        response,
        config.extractItemFromResponse.create,
        (item) => {
          items.push(item as TItem);
          if (toastCategory) {
            showSuccessToast(toastCategory, t("common.success.create"), name);
          }
        },
        (error) => {
          if (toastCategory) {
            showErrorToast(toastCategory, t("common.error.create"), error);
          }
        },
        t("store.resource.createFailed"),
      );
    },

    async update(
      items: TItem[],
      itemId: string,
      input: TUpdateInput,
    ): Promise<{
      success: boolean;
      item?: { id: string; name: string };
      error?: string;
    }> {
      const canvasId = requireActiveCanvas();

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.update.request,
          responseEvent: events.update.response,
          payload: {
            canvasId,
            ...config.getUpdatePayload(itemId, input),
          },
        }),
      );

      return handleCRUDResponse(
        response,
        config.extractItemFromResponse.update,
        (item) => {
          const updateFn = config.updateItemsList ?? defaultReplaceItemInList;
          updateFn(items, itemId, item);
          if (toastCategory) {
            showSuccessToast(
              toastCategory,
              t("common.success.update"),
              item.name,
            );
          }
        },
        (error) => {
          if (toastCategory) {
            showErrorToast(toastCategory, t("common.error.update"), error);
          }
        },
        t("store.resource.updateFailed"),
      );
    },

    async read(itemId: string): Promise<TReadResult | null> {
      const canvasId = requireActiveCanvas();

      const response = await wrapWebSocketRequest(
        createWebSocketRequest({
          requestEvent: events.read.request,
          responseEvent: events.read.response,
          payload: {
            canvasId,
            ...config.getReadPayload(itemId),
          },
        }),
      );

      if (!response) {
        return null;
      }

      return config.extractItemFromResponse.read(response) || null;
    },
  };
}
