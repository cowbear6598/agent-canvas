import { onMounted, onUnmounted, ref } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import {
  isEditingElement,
  isModifierKeyPressed,
  hasTextSelection,
} from "@/utils/domHelpers";
import { PASTE_TIMEOUT_MS } from "@/lib/constants";
import type {
  CanvasPasteResultPayload,
  CanvasPastePayload,
  SelectableElement,
} from "@/types";
import {
  collectSelectedPods,
  collectSelectedNotes,
  collectRelatedConnections,
} from "./copyPaste/collectCopyData";
import { calculatePastePositions } from "./copyPaste/calculatePaste";

function collectUnboundCreatedElements(
  noteType: SelectableElement["type"],
  notes: Array<{ id: string; boundToPodId: string | null }>,
): SelectableElement[] {
  return notes
    .filter((note) => note.boundToPodId === null)
    .map((note) => ({ type: noteType, id: note.id }));
}

export function useCopyPaste(): void {
  const {
    podStore,
    viewportStore,
    selectionStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
    clipboardStore,
    connectionStore,
  } = useCanvasContext();

  const mousePosition = ref({ x: 0, y: 0 });

  const updateMousePosition = (event: MouseEvent): void => {
    mousePosition.value = { x: event.clientX, y: event.clientY };
  };

  const handleCopy = (event: KeyboardEvent): boolean => {
    const selectedElements = selectionStore.selectedElements;
    if (selectedElements.length === 0) return false;

    event.preventDefault();

    const selectedPodIds = new Set(
      selectedElements.filter((el) => el.type === "pod").map((el) => el.id),
    );

    const copiedPods = collectSelectedPods(selectedElements, podStore.pods);
    const copiedNotes = collectSelectedNotes(selectedElements, selectedPodIds, {
      repositoryStore,
      commandStore,
      mcpServerStore,
    });
    const copiedConnections = collectRelatedConnections(
      selectedPodIds,
      connectionStore.connections,
    );

    clipboardStore.setCopy(
      copiedPods,
      copiedNotes.repositoryNotes,
      copiedNotes.commandNotes,
      copiedNotes.mcpServerNotes,
      copiedConnections,
    );

    return true;
  };

  const handlePaste = async (event: KeyboardEvent): Promise<boolean> => {
    if (clipboardStore.isEmpty) return false;

    event.preventDefault();

    const canvasPos = viewportStore.screenToCanvas(
      mousePosition.value.x,
      mousePosition.value.y,
    );
    const clipboardData = clipboardStore.getCopiedData();
    const existingNames = new Set(podStore.pods.map((p) => p.name));
    const { pods, repositoryNotes, commandNotes, mcpServerNotes, connections } =
      calculatePastePositions(canvasPos, clipboardData, existingNames);

    const { wrapWebSocketRequest } = useWebSocketErrorHandler();

    const response = await wrapWebSocketRequest(
      createWebSocketRequest<CanvasPastePayload, CanvasPasteResultPayload>({
        requestEvent: WebSocketRequestEvents.CANVAS_PASTE,
        responseEvent: WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload: {
          canvasId: requireActiveCanvas(),
          pods,
          repositoryNotes,
          commandNotes,
          mcpServerNotes,
          connections,
        },
        timeout: PASTE_TIMEOUT_MS,
      }),
    );

    if (!response) return false;

    const newSelectedElements: SelectableElement[] = [
      ...response.createdPods.map((pod) => ({
        type: "pod" as const,
        id: pod.id,
      })),
      ...collectUnboundCreatedElements(
        "repositoryNote",
        response.createdRepositoryNotes,
      ),
      ...collectUnboundCreatedElements(
        "commandNote",
        response.createdCommandNotes,
      ),
      ...collectUnboundCreatedElements(
        "mcpServerNote",
        response.createdMcpServerNotes,
      ),
    ];

    selectionStore.setSelectedElements(newSelectedElements);

    return true;
  };

  const COPY_PASTE_HANDLERS: Record<string, (event: KeyboardEvent) => void> = {
    c: (event) => {
      if (hasTextSelection()) return;
      handleCopy(event);
    },
    v: handlePaste,
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isModifierKeyPressed(event)) return;
    if (isEditingElement()) return;

    const handler = COPY_PASTE_HANDLERS[event.key.toLowerCase()];
    handler?.(event);
  };

  // 頁面卸載時清除 clipboardStore，防止敏感資料（如 providerConfig）殘留於記憶體
  const handleBeforeUnload = (): void => {
    clipboardStore.clear();
  };

  onMounted(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousemove", updateMousePosition);
    window.addEventListener("beforeunload", handleBeforeUnload);
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("mousemove", updateMousePosition);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  });
}
