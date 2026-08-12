<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useDeleteSelection } from "@/composables/canvas";
import { useRemoteCursors } from "@/composables/canvas/useRemoteCursors";
import { useCursorTracker } from "@/composables/canvas/useCursorTracker";
import { useDeleteResource } from "@/composables/canvas/useDeleteResource";
import { useCanvasProgressTasks } from "@/composables/canvas/useCanvasProgressTasks";
import { useCanvasContextMenus } from "@/composables/canvas/useCanvasContextMenus";
import { useCanvasNoteHandlers } from "@/composables/canvas/useCanvasNoteHandlers";
import { useCanvasInteractionController } from "@/composables/canvas/useCanvasInteractionController";
import { useCanvasResourceActionController } from "@/composables/canvas/useCanvasResourceActionController";
import CanvasViewport from "./CanvasViewport.vue";
import RemoteCursorLayer from "./RemoteCursorLayer.vue";
import EmptyState from "./EmptyState.vue";
import PodTypeMenu from "./PodTypeMenu.vue";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import GenericNote from "./GenericNote.vue";
import ProgressNote from "./ProgressNote.vue";
import TrashZone from "./TrashZone.vue";
import ConnectionLayer from "./ConnectionLayer.vue";
import SelectionBox from "./SelectionBox.vue";
import CanvasModalHost from "./CanvasModalHost.vue";
import RepositoryContextMenu from "./RepositoryContextMenu.vue";
import ConnectionContextMenu from "./ConnectionContextMenu.vue";
import PodContextMenu from "./PodContextMenu.vue";
import CanvasContextActionToolbar from "./CanvasContextActionToolbar.vue";
import PodPackImportDialog from "./PodPackImportDialog.vue";
import { usePodPack } from "@/composables/canvas/usePodPack";
import { POD_WIDTH, POD_HEIGHT } from "@/lib/constants";

const {
  podStore,
  viewportStore,
  selectionStore,
  repositoryStore,
  connectionStore,
} = useCanvasContext();
const { t } = useI18n();

const {
  canExport,
  isExporting,
  isImporting,
  pendingImport,
  exportSelection,
  chooseImportFile,
  confirmImport,
  cancelImport,
} = usePodPack();

useDeleteSelection();
useRemoteCursors();

const viewportRef = ref<InstanceType<typeof CanvasViewport> | null>(null);
const viewportContainerRef = computed(() => viewportRef.value?.el ?? null);
useCursorTracker(viewportContainerRef);

const trashZoneRef = ref<InstanceType<typeof TrashZone> | null>(null);

const showCreateRepositoryModal = ref(false);
const showCloneRepositoryModal = ref(false);

const {
  showDeleteModal,
  showDeleteMemoryModal,
  deleteTarget,
  isDeleteTargetInUse,
  handleOpenDeleteModal,
  handleConfirmDelete: handleDeleteConfirm,
  handleConfirmDeleteWithMemory: handleDeleteConfirmWithMemory,
  closeDeleteModal,
  closeDeleteMemoryModal,
} = useDeleteResource({
  repositoryStore,
});

const modalDeleteTarget = computed(() =>
  deleteTarget.value
    ? {
        name: deleteTarget.value.name,
        type: deleteTarget.value.type,
      }
    : null,
);

const activeConnectionContextMenuConnection = computed(() =>
  connectionStore.connections.find(
    (connection) => connection.id === connectionContextMenu.value.data.connectionId,
  ),
);

const connectionContextMenuTriggerMode = computed(
  () =>
    activeConnectionContextMenuConnection.value?.triggerMode ??
    connectionContextMenu.value.data.triggerMode,
);

const connectionContextMenuDirectEnabled = computed(
  () =>
    activeConnectionContextMenuConnection.value?.direct ??
    connectionContextMenu.value.data.direct,
);

const { allProgressTasks, handleCloneStarted, handlePullStarted } =
  useCanvasProgressTasks();

const {
  repositoryContextMenu,
  connectionContextMenu,
  podContextMenu,
  closeRepositoryContextMenu,
  closeConnectionContextMenu,
  closePodContextMenu,
  handleRepositoryContextMenu,
  handleConnectionContextMenu,
  handlePodContextMenu,
} = useCanvasContextMenus({ repositoryStore, connectionStore, podStore });

const {
  noteHandlerMap,
  showTrashZone,
  isTrashHighlighted,
  isCanvasEmpty,
  handleCreateRepositoryNote,
  getRepositoryBranchName,
} = useCanvasNoteHandlers({
  podStore,
  viewportStore,
  repositoryStore,
  trashZoneRef,
});
const interactionController = useCanvasInteractionController({
  podStore,
  viewportStore,
  selectionStore,
  connectionStore,
  handleCreateRepositoryNote,
  handleOpenCreateRepositoryModal: () => {
    showCreateRepositoryModal.value = true;
  },
  handleOpenCloneRepositoryModal: () => {
    showCloneRepositoryModal.value = true;
  },
});

const {
  podMemoryConfirmModal,
  repoMemoryConfirmModal,
  memoryViewerModal,
  integrationConnectModal,
  branchEditModal,
  handleConnectIntegration,
  handleDisconnectIntegration,
  handleSwitchPodProvider,
  handleSetPodMemoryEnabled,
  handleSetRepoMemoryEnabled,
  handleClearPodMemory,
  handleViewPodMemory,
  handleViewRepoMemory,
  handleMemoryViewerModalOpenChange,
  handlePodMemoryConfirmModalOpenChange,
  handleConfirmClearPodMemory,
  handleClearRepoMemory,
  handleRepoMemoryConfirmModalOpenChange,
  handleConfirmClearRepoMemory,
  handleRepositoryCreated,
  handleBranchModeClicked,
  handleBranchModalUpdateOpen,
  handleBranchModalSubmit,
  setIntegrationConnectModalOpen,
} = useCanvasResourceActionController({
  podStore,
  viewportStore,
  repositoryStore,
  connectionStore,
  connectionContextMenu,
  t,
  lastMenuPosition: interactionController.lastMenuPosition,
});

const {
  handleContextMenu,
  handleCanvasClick,
  handleSelectType,
  handleSelectPod,
  handleUpdatePod,
  handleDeletePod,
  handleDragEnd,
  handlePodDragComplete,
  handleCreateNote,
  handleOpenModal,
} = interactionController;

/**
 * 視口虛擬化：只渲染當前視口範圍（含 buffer）內的 Pod，
 * 避免 50+ Pod 時全部保留在 DOM 耗用記憶體與 layout 資源。
 *
 * 選擇此方案（v-for 過濾）而非 v-show，原因：
 *   - ConnectionLine 的座標計算完全依賴 Pod 資料（pod.x, pod.y, pod.rotation），
 *     不依賴 DOM 元件實例，因此連線不受 Pod unmount 影響。
 *   - selection、minimap 等功能仍走 podStore.pods 全集，不受影響。
 *   - v-if 真正移除 DOM，可節省記憶體與渲染成本；v-show 僅隱藏，無法達到此效果。
 */
const VIEWPORT_BUFFER_RATIO = 0.5;

const visiblePods = computed(() => {
  const { offset, zoom } = viewportStore;

  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const bufferX = screenW * VIEWPORT_BUFFER_RATIO;
  const bufferY = screenH * VIEWPORT_BUFFER_RATIO;
  const canvasLeft = (-offset.x - bufferX) / zoom;
  const canvasTop = (-offset.y - bufferY) / zoom;
  const canvasRight = (-offset.x + screenW + bufferX) / zoom;
  const canvasBottom = (-offset.y + screenH + bufferY) / zoom;

  return podStore.pods.filter((pod) => {
    const podRight = pod.x + POD_WIDTH;
    const podBottom = pod.y + POD_HEIGHT;

    return (
      podRight >= canvasLeft &&
      pod.x <= canvasRight &&
      podBottom >= canvasTop &&
      pod.y <= canvasBottom
    );
  });
});
</script>

<template>
  <CanvasViewport
    ref="viewportRef"
    @contextmenu="handleContextMenu"
    @click="handleCanvasClick"
  >
    <ConnectionLayer @connection-context-menu="handleConnectionContextMenu" />

    <SelectionBox />

    <!-- 視口虛擬化：只渲染可見範圍（含 buffer）內的 Pod，詳見 visiblePods computed -->
    <CanvasPod
      v-for="pod in visiblePods"
      :key="pod.id"
      :pod="pod"
      @select="handleSelectPod"
      @update="handleUpdatePod"
      @delete="handleDeletePod"
      @drag-end="handleDragEnd"
      @drag-complete="handlePodDragComplete"
      @contextmenu="handlePodContextMenu"
    />

    <GenericNote
      v-for="note in repositoryStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      :branch-name="getRepositoryBranchName(note.repositoryId as string)"
      @drag-end="noteHandlerMap.repository.handleDragEnd"
      @drag-move="noteHandlerMap.repository.handleDragMove"
      @drag-complete="noteHandlerMap.repository.handleDragComplete"
      @contextmenu="handleRepositoryContextMenu"
    />

    <EmptyState v-if="isCanvasEmpty" />
  </CanvasViewport>

  <RemoteCursorLayer />

  <ProgressNote :tasks="allProgressTasks" />

  <PodTypeMenu
    v-if="podStore.typeMenu.visible && podStore.typeMenu.position"
    :position="podStore.typeMenu.position"
    @select="handleSelectType"
    @create-note="handleCreateNote"
    @open-modal="handleOpenModal"
    @clone-started="handleCloneStarted"
    @open-delete-modal="handleOpenDeleteModal"
    @import-pod-pack="chooseImportFile"
    @close="podStore.hideTypeMenu"
  />

  <TrashZone
    ref="trashZoneRef"
    :visible="showTrashZone"
    :is-highlighted="isTrashHighlighted"
  />

  <CanvasContextActionToolbar
    :visible="canExport"
    :busy="isExporting"
    @export="exportSelection"
  />

  <PodPackImportDialog
    v-if="pendingImport"
    :preview="pendingImport.preview"
    :busy="isImporting"
    @confirm="confirmImport"
    @cancel="cancelImport"
  />

  <PodContextMenu
    v-if="podContextMenu.visible"
    :position="podContextMenu.position"
    :pod-id="podContextMenu.data.podId"
    :memory-enabled="podContextMenu.data.memoryEnabled"
    :has-pod-memory="podContextMenu.data.hasPodMemory"
    @close="closePodContextMenu"
    @switch-provider="handleSwitchPodProvider"
    @set-memory-enabled="handleSetPodMemoryEnabled"
    @set-repo-memory-enabled="handleSetRepoMemoryEnabled"
    @view-pod-memory="handleViewPodMemory"
    @view-repo-memory="handleViewRepoMemory"
    @clear-memory="handleClearPodMemory"
    @clear-repo-memory="handleClearRepoMemory"
    @connect-integration="handleConnectIntegration"
    @disconnect-integration="handleDisconnectIntegration"
  />

  <RepositoryContextMenu
    v-if="repositoryContextMenu.visible"
    :position="repositoryContextMenu.position"
    :repository-id="repositoryContextMenu.data.repositoryId"
    :repository-name="repositoryContextMenu.data.repositoryName"
    :note-position="repositoryContextMenu.data.notePosition"
    @close="closeRepositoryContextMenu"
    @view-memory="handleViewRepoMemory"
    @clear-memory="handleClearRepoMemory"
    @pull-started="handlePullStarted"
  />

  <ConnectionContextMenu
    v-if="connectionContextMenu.visible"
    :position="connectionContextMenu.position"
    :connection-id="connectionContextMenu.data.connectionId"
    :current-trigger-mode="connectionContextMenuTriggerMode"
    :direct-enabled="connectionContextMenuDirectEnabled"
    @close="closeConnectionContextMenu"
    @trigger-mode-changed="closeConnectionContextMenu"
    @branch-mode-clicked="handleBranchModeClicked"
  />

  <CanvasModalHost
    :branch-edit-modal="branchEditModal"
    :show-create-repository-modal="showCreateRepositoryModal"
    :show-clone-repository-modal="showCloneRepositoryModal"
    :show-delete-modal="showDeleteModal"
    :show-delete-memory-modal="showDeleteMemoryModal"
    :delete-target="modalDeleteTarget"
    :is-delete-target-in-use="isDeleteTargetInUse"
    :pod-memory-confirm-modal="podMemoryConfirmModal"
    :repo-memory-confirm-modal="repoMemoryConfirmModal"
    :memory-viewer-modal="memoryViewerModal"
    :integration-connect-modal="integrationConnectModal"
    @update:branch-open="handleBranchModalUpdateOpen"
    @submit:branch="handleBranchModalSubmit"
    @update:create-repository-open="
      (open) => (showCreateRepositoryModal = open)
    "
    @created:repository="handleRepositoryCreated"
    @update:clone-repository-open="(open) => (showCloneRepositoryModal = open)"
    @clone-started="handleCloneStarted"
    @update:delete-open="(open) => !open && closeDeleteModal()"
    @confirm:delete="handleDeleteConfirm"
    @update:delete-memory-open="closeDeleteMemoryModal"
    @confirm:delete-memory="handleDeleteConfirmWithMemory"
    @update:pod-memory-open="handlePodMemoryConfirmModalOpenChange"
    @confirm:clear-pod-memory="handleConfirmClearPodMemory"
    @update:repo-memory-open="handleRepoMemoryConfirmModalOpenChange"
    @confirm:clear-repo-memory="handleConfirmClearRepoMemory"
    @update:memory-viewer-open="handleMemoryViewerModalOpenChange"
    @update:integration-connect-open="
      (open) => setIntegrationConnectModalOpen(open)
    "
  />
</template>
