import { onMounted, onUnmounted } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import { useToast } from "@/composables/useToast";
import { isEditingElement } from "@/utils/domHelpers";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { t } from "@/i18n";

async function deleteSelectedElements(
  canvasContext: ReturnType<typeof useCanvasContext>,
  toast: ReturnType<typeof useToast>["toast"],
): Promise<void> {
  const {
    podStore,
    selectionStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
  } = canvasContext;

  const selectedElements = selectionStore.selectedElements;
  if (selectedElements.length === 0) return;

  const storeMap: Record<string, (id: string) => Promise<void>> = {
    pod: (id) => podStore.deletePodWithBackend(id),
    repositoryNote: (id) => repositoryStore.deleteNote(id),
    commandNote: (id) => commandStore.deleteNote(id),
    mcpServerNote: (id) => mcpServerStore.deleteNote(id),
  };

  const deletePromises: Promise<void>[] = [];

  for (const element of selectedElements) {
    const deleteFunction = storeMap[element.type];
    if (deleteFunction) {
      deletePromises.push(deleteFunction(element.id));
    }
  }

  const results = await Promise.allSettled(deletePromises);

  const failedResults = results.filter((r) => r.status === "rejected");
  const failedCount = failedResults.length;

  if (failedCount > 0) {
    failedResults.forEach((result) => {
      if (result.status === "rejected") {
        if (import.meta.env.DEV) {
          console.error("刪除元素失敗:", result.reason);
        }
      }
    });

    toast({
      title: t("composable.deleteSelection.partialFailed"),
      description: t("composable.deleteSelection.partialFailedDesc", {
        count: failedCount,
      }),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }

  selectionStore.clearSelection();
}

export function useDeleteSelection(): {
  deleteSelectedElements: () => Promise<void>;
} {
  const canvasContext = useCanvasContext();
  const { toast } = useToast();

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Delete") return;
    if (isEditingElement()) return;

    if (!canvasContext.selectionStore.hasSelection) return;

    deleteSelectedElements(canvasContext, toast);
  }

  onMounted(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return {
    deleteSelectedElements: () => deleteSelectedElements(canvasContext, toast),
  };
}
