import { defineStore } from "pinia";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { removeById } from "@/lib/arrayHelpers";
import { t } from "@/i18n";
import { getApiBaseUrl } from "@/services/utils";

import type {
  Canvas,
  CanvasCreatePayload,
  CanvasCreatedPayload,
  CanvasListPayload,
  CanvasListResultPayload,
  CanvasRenamePayload,
  CanvasRenamedPayload,
  CanvasDeletePayload,
  CanvasDeletedPayload,
  CanvasSwitchPayload,
  CanvasSwitchedPayload,
  CanvasReorderPayload,
  CanvasReorderedPayload,
} from "@/types/canvas";

// 需要密碼才能切換的標記錯誤
export interface CanvasPasswordRequiredError {
  type: "CANVAS_PASSWORD_REQUIRED";
  canvasId: string;
}

export function isCanvasPasswordRequiredError(
  err: unknown,
): err is CanvasPasswordRequiredError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as CanvasPasswordRequiredError).type === "CANVAS_PASSWORD_REQUIRED"
  );
}

/**
 * 呼叫密碼相關 API 的通用 helper，統一處理 fetch + 錯誤解析 + toast 通知
 * @returns 成功時回傳 true，失敗時顯示 toast 並回傳 false
 */
async function callPasswordApi(
  url: string,
  method: string,
  body: Record<string, string>,
  errorToastKey: string,
): Promise<boolean> {
  const { showErrorToast } = useToast();

  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let reason: string | undefined;
    try {
      const responseBody = await response.json();
      if (responseBody?.error) reason = responseBody.error;
    } catch {
      // 無法解析回應，使用預設錯誤訊息
    }
    showErrorToast("Canvas", t(errorToastKey), reason);
    return false;
  }

  return true;
}

interface CanvasState {
  canvases: Canvas[];
  activeCanvasId: string | null;
  isSidebarOpen: boolean;
  isLoading: boolean;
  isDragging: boolean;
  draggedCanvasId: string | null;
  verifiedPasswords: Map<string, string>;
}

export const useCanvasStore = defineStore("canvas", {
  state: (): CanvasState => ({
    canvases: [],
    activeCanvasId: null,
    isSidebarOpen: false,
    isLoading: false,
    isDragging: false,
    draggedCanvasId: null,
    verifiedPasswords: new Map(),
  }),

  getters: {
    activeCanvas: (state): Canvas | null => {
      if (!state.activeCanvasId) return null;
      return (
        state.canvases.find((canvas) => canvas.id === state.activeCanvasId) ||
        null
      );
    },

    getCanvasPassword:
      (state) =>
      (canvasId: string): string | undefined => {
        return state.verifiedPasswords.get(canvasId);
      },
  },

  actions: {
    toggleSidebar(): void {
      this.isSidebarOpen = !this.isSidebarOpen;
    },

    setSidebarOpen(open: boolean): void {
      this.isSidebarOpen = open;
    },

    async loadCanvases(): Promise<void> {
      this.isLoading = true;

      const response = await createWebSocketRequest<
        CanvasListPayload,
        CanvasListResultPayload
      >({
        requestEvent: WebSocketRequestEvents.CANVAS_LIST,
        responseEvent: WebSocketResponseEvents.CANVAS_LIST_RESULT,
        payload: {},
      }).catch((error) => {
        this.isLoading = false;
        throw error;
      });

      if (!response.canvases) {
        console.warn("[CanvasStore] 後端未回傳任何 Canvas");
        this.isLoading = false;
        return;
      }

      this.canvases = response.canvases.sort(
        (a, b) => a.sortIndex - b.sortIndex,
      );

      if (this.canvases.length > 0 && !this.activeCanvasId) {
        await this.switchToFirstCanvas();
      }

      this.isLoading = false;
    },

    async switchToFirstCanvas(): Promise<void> {
      const firstCanvas = this.canvases[0];
      if (!firstCanvas) return;

      try {
        await createWebSocketRequest<
          CanvasSwitchPayload,
          CanvasSwitchedPayload
        >({
          requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
          responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
          payload: { canvasId: firstCanvas.id },
        });
      } catch (error) {
        console.error("[CanvasStore] 切換 Canvas 失敗", error);
        return;
      }

      this.activeCanvasId = firstCanvas.id;
    },

    async createCanvas(name: string): Promise<Canvas | null> {
      const { showSuccessToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();

      const response = await withErrorToast(
        createWebSocketRequest<CanvasCreatePayload, CanvasCreatedPayload>({
          requestEvent: WebSocketRequestEvents.CANVAS_CREATE,
          responseEvent: WebSocketResponseEvents.CANVAS_CREATED,
          payload: {
            name,
          },
        }),
        "Canvas",
        t("common.error.create"),
      );

      if (!response?.canvas) return null;

      await createWebSocketRequest<CanvasSwitchPayload, CanvasSwitchedPayload>({
        requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
        responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
        payload: { canvasId: response.canvas.id },
      });
      this.activeCanvasId = response.canvas.id;
      showSuccessToast("Canvas", t("common.success.create"), name);
      return response.canvas;
    },

    async renameCanvas(canvasId: string, newName: string): Promise<void> {
      const { showSuccessToast } = useToast();
      const { withErrorToast } = useWebSocketErrorHandler();

      const response = await withErrorToast(
        createWebSocketRequest<CanvasRenamePayload, CanvasRenamedPayload>({
          requestEvent: WebSocketRequestEvents.CANVAS_RENAME,
          responseEvent: WebSocketResponseEvents.CANVAS_RENAMED,
          payload: {
            canvasId,
            newName,
          },
        }),
        "Canvas",
        t("store.canvas.renameFailed"),
      );

      if (!response) return;

      showSuccessToast("Canvas", t("store.canvas.renamed"), newName);
    },

    async deleteCanvas(canvasId: string): Promise<void> {
      const { showSuccessToast } = useToast();

      if (this.activeCanvasId === canvasId) {
        const otherCanvas = this.canvases.find(
          (canvas) => canvas.id !== canvasId,
        );
        if (otherCanvas) {
          await this.switchCanvas(otherCanvas.id);
        }
      }

      await createWebSocketRequest<CanvasDeletePayload, CanvasDeletedPayload>({
        requestEvent: WebSocketRequestEvents.CANVAS_DELETE,
        responseEvent: WebSocketResponseEvents.CANVAS_DELETED,
        payload: {
          canvasId,
        },
      });

      showSuccessToast("Canvas", t("common.success.delete"));
    },

    async setPassword(canvasId: string, password: string): Promise<void> {
      const { showSuccessToast } = useToast();
      const baseUrl = getApiBaseUrl();

      const ok = await callPasswordApi(
        `${baseUrl}/api/canvas/${canvasId}/password`,
        "POST",
        { password },
        "store.canvas.setPasswordFailed",
      );
      if (!ok) return;

      const canvas = this.canvases.find((c) => c.id === canvasId);
      if (canvas) {
        canvas.isPasswordProtected = true;
      }
      this.verifiedPasswords.set(canvasId, password);
      showSuccessToast("Canvas", t("store.canvas.passwordSet"));
    },

    async changePassword(
      canvasId: string,
      oldPassword: string,
      newPassword: string,
    ): Promise<void> {
      const { showSuccessToast } = useToast();
      const baseUrl = getApiBaseUrl();

      const ok = await callPasswordApi(
        `${baseUrl}/api/canvas/${canvasId}/password`,
        "PUT",
        { oldPassword, newPassword },
        "store.canvas.changePasswordFailed",
      );
      if (!ok) return;

      this.verifiedPasswords.set(canvasId, newPassword);
      showSuccessToast("Canvas", t("store.canvas.passwordChanged"));
    },

    async removePassword(canvasId: string, password: string): Promise<void> {
      const { showSuccessToast } = useToast();
      const baseUrl = getApiBaseUrl();

      const ok = await callPasswordApi(
        `${baseUrl}/api/canvas/${canvasId}/password`,
        "DELETE",
        { password },
        "store.canvas.removePasswordFailed",
      );
      if (!ok) return;

      const canvas = this.canvases.find((c) => c.id === canvasId);
      if (canvas) {
        canvas.isPasswordProtected = false;
      }
      this.verifiedPasswords.delete(canvasId);
      showSuccessToast("Canvas", t("store.canvas.passwordRemoved"));
    },

    async verifyPassword(canvasId: string, password: string): Promise<boolean> {
      const baseUrl = getApiBaseUrl();

      const response = await fetch(
        `${baseUrl}/api/canvas/${canvasId}/verify-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );

      if (!response.ok) {
        return false;
      }

      this.verifiedPasswords.set(canvasId, password);
      return true;
    },

    clearVerifiedPassword(canvasId: string): void {
      this.verifiedPasswords.delete(canvasId);
    },

    async switchCanvas(canvasId: string): Promise<void> {
      if (this.activeCanvasId === canvasId) return;

      const targetCanvas = this.canvases.find((c) => c.id === canvasId);

      if (targetCanvas?.isPasswordProtected) {
        const verifiedPassword = this.verifiedPasswords.get(canvasId);
        if (!verifiedPassword) {
          // 尚未驗證密碼，拋出標記錯誤讓呼叫端處理
          throw {
            type: "CANVAS_PASSWORD_REQUIRED",
            canvasId,
          } as CanvasPasswordRequiredError;
        }
      }

      // 組合 payload，有已驗證密碼時一併帶入
      const password = this.verifiedPasswords.get(canvasId);
      const payload: Omit<CanvasSwitchPayload, "requestId"> = { canvasId };
      if (password) payload.password = password;

      const response = await createWebSocketRequest<
        CanvasSwitchPayload,
        CanvasSwitchedPayload
      >({
        requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
        responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
        payload,
      });

      if (response.success && response.canvasId) {
        this.activeCanvasId = canvasId;
      }
    },

    reset(): void {
      this.canvases = [];
      this.activeCanvasId = null;
      this.isSidebarOpen = false;
      this.isLoading = false;
      this.verifiedPasswords = new Map();
    },

    addCanvasFromEvent(canvas: Canvas): void {
      const existingCanvas = this.canvases.find(
        (existingItem) => existingItem.id === canvas.id,
      );
      if (!existingCanvas) {
        this.canvases.push(canvas);
      }
    },

    reorderCanvasesFromEvent(canvasIds: string[]): void {
      const canvasMap = new Map(
        this.canvases.map((canvas) => [canvas.id, canvas]),
      );
      const reorderedCanvases: Canvas[] = [];

      for (const id of canvasIds) {
        const canvas = canvasMap.get(id);
        if (canvas) {
          reorderedCanvases.push(canvas);
        }
      }

      this.canvases = reorderedCanvases;
    },

    renameCanvasFromEvent(canvasId: string, newName: string): void {
      const canvas = this.canvases.find((item) => item.id === canvasId);
      if (canvas) {
        canvas.name = newName;
      }
    },

    updateLockFromEvent(canvasId: string, isLocked: boolean): void {
      const canvas = this.canvases.find((item) => item.id === canvasId);
      if (canvas) {
        canvas.isPasswordProtected = isLocked;
      }
    },

    async removeCanvasFromEvent(canvasId: string): Promise<void> {
      if (this.activeCanvasId === canvasId) {
        const deletedCanvas = this.canvases.find(
          (canvas) => canvas.id === canvasId,
        );
        const { toast } = useToast();
        if (deletedCanvas) {
          toast({
            title: t("store.canvas.deleted", { name: deletedCanvas.name }),
            variant: "destructive",
          });
        }
      }

      this.canvases = removeById(this.canvases, canvasId);

      if (this.activeCanvasId === canvasId) {
        await this.handleActiveCanvasDeletion();
      }
    },

    async handleActiveCanvasDeletion(): Promise<void> {
      if (this.canvases.length > 0) {
        const firstCanvas = this.canvases[0];
        if (!firstCanvas) return;
        await this.switchCanvas(firstCanvas.id);
        return;
      }

      const defaultCanvas = await this.createCanvas("Default");
      if (defaultCanvas) {
        await this.switchCanvas(defaultCanvas.id);
      }
    },

    setDragging(isDragging: boolean, canvasId: string | null): void {
      this.isDragging = isDragging;
      this.draggedCanvasId = canvasId;
    },

    reorderCanvases(fromIndex: number, toIndex: number): void {
      const canvas = this.canvases[fromIndex];
      if (!canvas) {
        console.warn("[CanvasStore] 找不到索引位置的 Canvas:", fromIndex);
        return;
      }

      this.canvases.splice(fromIndex, 1);
      this.canvases.splice(toIndex, 0, canvas);

      this.syncCanvasOrder();
    },

    async syncCanvasOrder(): Promise<void> {
      const originalOrder = [...this.canvases];
      const canvasIds = this.canvases.map((canvas) => canvas.id);
      const { showErrorToast } = useToast();

      const response = await createWebSocketRequest<
        CanvasReorderPayload,
        CanvasReorderedPayload
      >({
        requestEvent: WebSocketRequestEvents.CANVAS_REORDER,
        responseEvent: WebSocketResponseEvents.CANVAS_REORDERED,
        payload: { canvasIds },
      });

      if (!response.success) {
        showErrorToast("Canvas", t("store.canvas.orderSaveFailed"));
        this.canvases = originalOrder;
      }
    },

    revertCanvasOrder(originalCanvases: Canvas[]): void {
      this.canvases = [...originalCanvases];
    },
  },
});
