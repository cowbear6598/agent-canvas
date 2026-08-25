import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useCanvasContext } from "./useCanvasContext";
import {
  collectAttachedRepositoryNotes,
  collectRelatedConnections,
  collectSelectedPods,
} from "./copyPaste/collectCopyData";
import {
  cancelPodPackTransfer,
  downloadPodPack,
  exportPodPack,
  importPodPack,
  previewPodPack,
} from "@/services/podPackApi";
import { requireActiveCanvas } from "@/utils/canvasGuard";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import { generateUUID } from "@/services/utils";
import type { PasteConnectionItem, PastePodItem, PodPackPreview } from "@/types";
import type { ProgressTask } from "@/components/canvas/ProgressNote.vue";

interface PendingPodPackImport {
  transferId: string;
  target: { x: number; y: number };
  preview: PodPackPreview;
}

export interface UsePodPackResult {
  canExport: ComputedRef<boolean>;
  isExporting: Ref<boolean>;
  isImporting: Ref<boolean>;
  pendingImport: Ref<PendingPodPackImport | null>;
  transferTask: Ref<ProgressTask | null>;
  exportSelection: () => Promise<void>;
  chooseImportFile: (screenPosition: { x: number; y: number }) => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  cancelActiveTransfer: () => void;
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function cancelTransferSilently(transferId: string | null | undefined): void {
  if (transferId) {
    void cancelPodPackTransfer(transferId).catch(() => undefined);
  }
}

export function usePodPack(): UsePodPackResult {
  const { podStore, viewportStore, selectionStore, repositoryStore, connectionStore } = useCanvasContext();
  const isExporting = ref(false);
  const isImporting = ref(false);
  const pendingImport = ref<PendingPodPackImport | null>(null);
  const transferTask = ref<ProgressTask | null>(null);
  const canExport = computed(() => selectionStore.selectedPodIds.length > 0);
  const { showErrorToast, showSuccessToast } = useToast();
  let activeController: AbortController | null = null;
  let activeTransferId: string | null = null;

  const setTask = (id: string, title: string, message: string, progress: number): void => {
    transferTask.value = {
      requestId: id,
      title,
      message,
      progress,
      status: "processing",
      cancelLabel: t("common.cancel"),
      onCancel: cancelActiveTransfer,
    };
  };

  const finishTask = (): void => {
    transferTask.value = null;
    activeController = null;
    activeTransferId = null;
  };

  const showTransferError = (error: unknown, title: string): void => {
    if (!isAbortError(error)) {
      showErrorToast("Canvas", title, errorMessage(error));
    }
  };

  const cancelActiveTransfer = (): void => {
    activeController?.abort();
    cancelTransferSilently(activeTransferId);
    pendingImport.value = null;
    isExporting.value = false;
    isImporting.value = false;
    finishTask();
  };

  const exportSelection = async (): Promise<void> => {
    if (!canExport.value || isExporting.value || activeController) return;
    isExporting.value = true;
    try {
      activeController = new AbortController();
      activeTransferId = generateUUID();
      setTask(activeTransferId, t("podPack.export.title"), t("podPack.progress.preparing"), 15);
      const selectedPodIds = new Set(selectionStore.selectedPodIds);
      const copiedPods = collectSelectedPods(selectionStore.selectedElements, podStore.pods);
      const connections = collectRelatedConnections(selectedPodIds, connectionStore.connections);
      const pods: PastePodItem[] = copiedPods.map(({ id, ...pod }) => ({ ...pod, originalId: id }));
      const repositoryNotes = collectAttachedRepositoryNotes(copiedPods, repositoryStore.notes);
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
      const transfer = await exportPodPack(
        { pods, connections: pasteConnections, repositoryNotes },
        { transferId: activeTransferId, signal: activeController.signal },
      );
      setTask(transfer.id, t("podPack.export.title"), t("podPack.progress.downloading"), 100);
      downloadPodPack(transfer);
      showSuccessToast("Canvas", t("podPack.export.success", { count: pods.length }));
    } catch (error) {
      showTransferError(error, t("podPack.export.failed"));
    } finally {
      isExporting.value = false;
      finishTask();
    }
  };

  const chooseImportFile = async (screenPosition: { x: number; y: number }): Promise<void> => {
    if (activeController) return;
    try {
      const file = await choosePodPack();
      if (!file) return;
      activeController = new AbortController();
      activeTransferId = generateUUID();
      setTask(activeTransferId, t("podPack.import.title"), t("podPack.progress.uploading"), 10);
      const target = viewportStore.screenToCanvas(screenPosition.x, screenPosition.y);
      const staged = await previewPodPack(file, {
        transferId: activeTransferId,
        signal: activeController.signal,
        onProgress: (value) => {
          if (transferTask.value) transferTask.value.progress = value ?? 60;
        },
      });
      pendingImport.value = { transferId: staged.transferId, target, preview: staged.preview };
      finishTask();
    } catch (error) {
      finishTask();
      showTransferError(error, t("podPack.import.previewFailed"));
    }
  };

  const confirmImport = async (): Promise<void> => {
    const pending = pendingImport.value;
    if (!pending || isImporting.value) return;
    isImporting.value = true;
    activeController = new AbortController();
    activeTransferId = pending.transferId;
    setTask(pending.transferId, t("podPack.import.title"), t("podPack.progress.importing"), 70);
    try {
      const result = await importPodPack(
        pending.transferId,
        requireActiveCanvas(),
        pending.target,
        { signal: activeController.signal },
      );
      for (const pod of result.createdPods) podStore.addPodFromEvent(pod);
      for (const note of result.createdRepositoryNotes) repositoryStore.addNoteFromEvent(note);
      for (const connection of result.createdConnections) connectionStore.addConnectionFromEvent(connection);
      selectionStore.setSelectedElements(result.createdPods.map((pod) => ({ type: "pod" as const, id: pod.id })));
      pendingImport.value = null;
      const dependencies = [...result.preview.repositories, ...result.preview.plugins, ...result.preview.managedMcps];
      showSuccessToast(
        "Canvas",
        t("podPack.import.success", { pods: result.createdPods.length, connections: result.createdConnections.length }),
        t("podPack.import.result", {
          installed: dependencies.filter((item) => item.action === "install").length,
          existing: dependencies.filter((item) => item.action === "existing").length,
          reused: dependencies.filter((item) => item.action === "reuse").length,
          renamed: dependencies.filter((item) => item.action === "rename").length,
        }),
      );
    } catch (error) {
      showTransferError(error, t("podPack.import.failed"));
    } finally {
      isImporting.value = false;
      finishTask();
    }
  };

  const cancelImport = (): void => {
    const id = pendingImport.value?.transferId;
    pendingImport.value = null;
    cancelTransferSilently(id);
  };

  return {
    canExport, isExporting, isImporting, pendingImport, transferTask,
    exportSelection, chooseImportFile, confirmImport, cancelImport, cancelActiveTransfer,
  };
}
