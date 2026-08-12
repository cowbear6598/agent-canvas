import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import { collectRelatedConnections, collectSelectedPods } from "./copyPaste/collectCopyData";
import { exportPodPack, importPodPack, previewPodPack } from "@/services/podPackApi";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import type { PasteConnectionItem, PastePodItem, PodPackPreview } from "@/types";

interface PendingPodPackImport {
  file: File;
  target: { x: number; y: number };
  preview: PodPackPreview;
}

export interface UsePodPackResult {
  canExport: ComputedRef<boolean>;
  isExporting: Ref<boolean>;
  isImporting: Ref<boolean>;
  pendingImport: Ref<PendingPodPackImport | null>;
  exportSelection: () => Promise<void>;
  chooseImportFile: (screenPosition: { x: number; y: number }) => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function choosePodPack(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".podpack,application/zip,application/vnd.agent-canvas.podpack+zip";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export function usePodPack(): UsePodPackResult {
  const { podStore, viewportStore, selectionStore, connectionStore } = useCanvasContext();
  const isExporting = ref(false);
  const isImporting = ref(false);
  const pendingImport = ref<PendingPodPackImport | null>(null);
  const canExport = computed(() => selectionStore.selectedPodIds.length > 0);
  const { showErrorToast, showSuccessToast } = useToast();

  const exportSelection = async (): Promise<void> => {
    if (!canExport.value || isExporting.value) return;
    isExporting.value = true;
    try {
      const selectedPodIds = new Set(selectionStore.selectedPodIds);
      const copiedPods = collectSelectedPods(selectionStore.selectedElements, podStore.pods);
      const connections = collectRelatedConnections(selectedPodIds, connectionStore.connections);
      const pods: PastePodItem[] = copiedPods.map(({ id, ...pod }) => ({ ...pod, originalId: id, repositoryId: null }));
      const pasteConnections: PasteConnectionItem[] = connections.map((connection) => ({
        originalSourcePodId: connection.sourcePodId,
        sourceAnchor: connection.sourceAnchor,
        originalTargetPodId: connection.targetPodId,
        targetAnchor: connection.targetAnchor,
        triggerMode: connection.triggerMode,
        direct: connection.direct,
        summaryProvider: connection.summaryProvider,
        summaryModel: connection.summaryModel,
        summaryThinkingLevel: connection.summaryThinkingLevel,
        label: connection.label,
        description: connection.description,
        branchProvider: connection.branchProvider,
        branchModel: connection.branchModel,
        branchThinkingLevel: connection.branchThinkingLevel,
      }));
      const result = await exportPodPack({ pods, connections: pasteConnections });
      downloadBlob(result.blob, result.filename);
      showSuccessToast("Canvas", t("podPack.export.success", { count: pods.length }));
    } catch (error) {
      showErrorToast("Canvas", t("podPack.export.failed"), error instanceof Error ? error.message : undefined);
    } finally { isExporting.value = false; }
  };

  const chooseImportFile = async (screenPosition: { x: number; y: number }): Promise<void> => {
    try {
      const file = await choosePodPack();
      if (!file) return;
      const target = viewportStore.screenToCanvas(screenPosition.x, screenPosition.y);
      pendingImport.value = { file, target, preview: await previewPodPack(file) };
    } catch (error) {
      showErrorToast("Canvas", t("podPack.import.previewFailed"), error instanceof Error ? error.message : undefined);
    }
  };

  const confirmImport = async (): Promise<void> => {
    const pending = pendingImport.value;
    if (!pending || isImporting.value) return;
    isImporting.value = true;
    try {
      const result = await importPodPack(pending.file, requireActiveCanvas(), pending.target);
      for (const pod of result.createdPods) podStore.addPodFromEvent(pod);
      for (const connection of result.createdConnections) connectionStore.addConnectionFromEvent(connection);
      selectionStore.setSelectedElements(result.createdPods.map((pod) => ({ type: "pod" as const, id: pod.id })));
      pendingImport.value = null;
      const dependencies = [...result.preview.plugins, ...result.preview.managedMcps];
      showSuccessToast(
        "Canvas",
        t("podPack.import.success", { pods: result.createdPods.length, connections: result.createdConnections.length }),
        t("podPack.import.result", {
          installed: dependencies.filter((item) => item.action === "install").length,
          reused: dependencies.filter((item) => item.action === "reuse").length,
          renamed: dependencies.filter((item) => item.action === "rename").length,
        }),
      );
    } catch (error) {
      showErrorToast("Canvas", t("podPack.import.failed"), error instanceof Error ? error.message : undefined);
    } finally { isImporting.value = false; }
  };

  const cancelImport = (): void => {
    pendingImport.value = null;
  };

  return {
    canExport,
    isExporting,
    isImporting,
    pendingImport,
    exportSelection,
    chooseImportFile,
    confirmImport,
    cancelImport,
  };
}
