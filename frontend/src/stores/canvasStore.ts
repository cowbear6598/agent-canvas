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

interface CanvasState {
  canvases: Canvas[];
  activeCanvasId: string | null;
  isSidebarOpen: boolean;
  isLoading: boolean;
  isDragging: boolean;
  draggedCanvasId: string | null;
}

export const useCanvasStore = defineStore("canvas", {
  state: (): CanvasState => ({
    canvases: [],
    activeCanvasId: null,
    isSidebarOpen: false,
    isLoading: false,
    isDragging: false,
    draggedCanvasId: null,
  }),

  getters: {
    activeCanvas: (state): Canvas | null => {
      if (!state.activeCanvasId) return null;
      return (
        state.canvases.find((canvas) => canvas.id === state.activeCanvasId) ||
        null
      );
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

    async switchCanvas(canvasId: string): Promise<void> {
      if (this.activeCanvasId === canvasId) return;

      const response = await createWebSocketRequest<
        CanvasSwitchPayload,
        CanvasSwitchedPayload
      >({
        requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
        responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
        payload: {
          canvasId,
        },
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
