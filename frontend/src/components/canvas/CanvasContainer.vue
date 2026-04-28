<script setup lang="ts">
import { computed, ref } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useDeleteSelection } from "@/composables/canvas";
import { useRemoteCursors } from "@/composables/canvas/useRemoteCursors";
import { useCursorTracker } from "@/composables/canvas/useCursorTracker";
import { useEditModal } from "@/composables/canvas/useEditModal";
import { useDeleteResource } from "@/composables/canvas/useDeleteResource";
import { useCanvasProgressTasks } from "@/composables/canvas/useCanvasProgressTasks";
import { useCanvasContextMenus } from "@/composables/canvas/useCanvasContextMenus";
import { useCanvasNoteHandlers } from "@/composables/canvas/useCanvasNoteHandlers";
import { isCtrlOrCmdPressed } from "@/utils/keyboardHelpers";
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
import RepositoryContextMenu from "./RepositoryContextMenu.vue";
import ConnectionContextMenu from "./ConnectionContextMenu.vue";
import PodContextMenu from "./PodContextMenu.vue";
import CreateRepositoryModal from "./CreateRepositoryModal.vue";
import CloneRepositoryModal from "./CloneRepositoryModal.vue";
import ConfirmDeleteModal from "./ConfirmDeleteModal.vue";
import CreateEditModal from "./CreateEditModal.vue";
import IntegrationConnectModal from "@/components/integration/IntegrationConnectModal.vue";
import type { Pod, PodTypeConfig, Position } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import {
  POD_MENU_X_OFFSET,
  POD_MENU_Y_OFFSET,
  DEFAULT_POD_ROTATION_RANGE,
  POD_WIDTH,
  POD_HEIGHT,
} from "@/lib/constants";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import { useIntegrationStore } from "@/stores/integrationStore";

const {
  podStore,
  viewportStore,
  selectionStore,
  repositoryStore,
  commandStore,
  connectionStore,
} = useCanvasContext();

useDeleteSelection();
useRemoteCursors();

const viewportRef = ref<InstanceType<typeof CanvasViewport> | null>(null);
const viewportContainerRef = computed(() => viewportRef.value?.el ?? null);
useCursorTracker(viewportContainerRef);

const trashZoneRef = ref<InstanceType<typeof TrashZone> | null>(null);

const showCreateRepositoryModal = ref(false);
const showCloneRepositoryModal = ref(false);
const lastMenuPosition = ref<Position | null>(null);

const integrationConnectModal = ref<{
  visible: boolean;
  podId: string;
  provider: string;
}>({
  visible: false,
  podId: "",
  provider: "",
});

const {
  editModal,
  handleOpenCreateModal,
  handleOpenCreateGroupModal,
  handleOpenEditModal,
  handleCreateEditSubmit,
} = useEditModal({ commandStore, viewportStore }, lastMenuPosition);

const {
  showDeleteModal,
  deleteTarget,
  isDeleteTargetInUse,
  handleOpenDeleteModal,
  handleOpenDeleteGroupModal,
  handleConfirmDelete: handleDeleteConfirm,
} = useDeleteResource({
  repositoryStore,
  commandStore,
});

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
  handleCreateCommandNote,
  getRepositoryBranchName,
  handleNoteDoubleClick,
} = useCanvasNoteHandlers({
  podStore,
  viewportStore,
  repositoryStore,
  commandStore,
  trashZoneRef,
  handleOpenEditModal,
});

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

  // 視窗尺寸（螢幕座標）
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  // 加上 buffer，避免 Pod 剛進入邊緣時閃爍
  const bufferX = screenW * VIEWPORT_BUFFER_RATIO;
  const bufferY = screenH * VIEWPORT_BUFFER_RATIO;

  // 將帶有 buffer 的螢幕邊界轉換為 canvas 座標系
  const canvasLeft = (-offset.x - bufferX) / zoom;
  const canvasTop = (-offset.y - bufferY) / zoom;
  const canvasRight = (-offset.x + screenW + bufferX) / zoom;
  const canvasBottom = (-offset.y + screenH + bufferY) / zoom;

  return podStore.pods.filter((pod) => {
    // 使用 Pod 的 AABB（忽略旋轉以求簡單，旋轉後邊界略大也在 buffer 容許範圍內）
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

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault();
  const target = e.target as HTMLElement;

  if (
    target.classList.contains("viewport") ||
    target.classList.contains("canvas-content")
  ) {
    podStore.showTypeMenu({ x: e.clientX, y: e.clientY });
  }
};

const handleCanvasClick = (e: MouseEvent): void => {
  if (selectionStore.boxSelectJustEnded) {
    return;
  }

  const target = e.target as HTMLElement;

  const ignoredSelectors = [
    ".connection-line",
    ".pod-doodle",
    ".repository-note",
    ".command-note",
  ];
  if (ignoredSelectors.some((selector) => target.closest(selector))) {
    return;
  }

  if (isCtrlOrCmdPressed(e)) {
    return;
  }

  selectionStore.clearSelection();
  connectionStore.selectConnection(null);
};

const handleSelectType = async (
  _config: PodTypeConfig,
  provider: PodProvider,
  providerConfig: ProviderConfig,
): Promise<void> => {
  if (!podStore.typeMenu.position) return;

  const { x: canvasX, y: canvasY } = screenToCanvasPosition(
    podStore.typeMenu.position,
    viewportStore,
  );

  const rotation =
    Math.random() * DEFAULT_POD_ROTATION_RANGE - DEFAULT_POD_ROTATION_RANGE / 2;
  const newPod = {
    name: podStore.getNextPodName(),
    x: canvasX - POD_MENU_X_OFFSET,
    y: canvasY - POD_MENU_Y_OFFSET,
    output: [],
    rotation: Math.round(rotation * 10) / 10,
    multiInstance: false,
    provider,
    providerConfig,
  };

  podStore.hideTypeMenu();

  await podStore.createPodWithBackend(newPod);
};

const handleSelectPod = (podId: string): void => {
  podStore.selectPod(podId);
};

const handleUpdatePod = async (pod: Pod): Promise<void> => {
  const oldPod = podStore.getPodById(pod.id);
  if (!oldPod) return;

  const oldName = oldPod.name;
  podStore.updatePod(pod);

  if (oldName !== pod.name) {
    const success = await podStore.renamePodWithBackend(pod.id, pod.name);
    if (!success) {
      podStore.updatePod({ ...pod, name: oldName });
    }
  }
};

const handleDeletePod = async (id: string): Promise<void> => {
  await podStore.deletePodWithBackend(id);
};

const handleDragEnd = (data: { id: string; x: number; y: number }): void => {
  podStore.movePod(data.id, data.x, data.y);
};

const handlePodDragComplete = (data: { id: string }): void => {
  podStore.syncPodPosition(data.id);
};

const handleConnectIntegration = (podId: string, provider: string): void => {
  integrationConnectModal.value = { visible: true, podId, provider };
};

const handleDisconnectIntegration = async (
  podId: string,
  provider: string,
): Promise<void> => {
  await useIntegrationStore().unbindFromPod(provider, podId);
};

const handleOpenCreateRepositoryModal = (): void => {
  lastMenuPosition.value = podStore.typeMenu.position;
  showCreateRepositoryModal.value = true;
};

const handleOpenCloneRepositoryModal = (): void => {
  showCloneRepositoryModal.value = true;
};

const handleRepositoryCreated = (repository: {
  id: string;
  name: string;
}): void => {
  if (!lastMenuPosition.value) return;

  const { x, y } = screenToCanvasPosition(
    lastMenuPosition.value,
    viewportStore,
  );

  repositoryStore.createNote(repository.id, x, y);
};

const withMenuPosition = <T extends (...args: never[]) => unknown>(
  fn: T,
): T => {
  return ((...args: Parameters<T>) => {
    lastMenuPosition.value = podStore.typeMenu.position;
    return fn(...args);
  }) as T;
};

const wrappedHandleOpenCreateModal = withMenuPosition(handleOpenCreateModal);
const wrappedHandleOpenCreateGroupModal = withMenuPosition(
  handleOpenCreateGroupModal,
);
const wrappedHandleOpenEditModal = withMenuPosition(handleOpenEditModal);

/** 處理 PodTypeMenu 的統一 create-note 事件，依 type 分派至對應的 note 建立函式 */
const handleCreateNote = (payload: { type: string; id: string }): void => {
  if (payload.type === "repository") {
    handleCreateRepositoryNote(payload.id);
  } else if (payload.type === "command") {
    handleCreateCommandNote(payload.id);
  }
};

/** 處理 PodTypeMenu 的統一 open-modal 事件，依 type 分派至對應的 Modal 開啟函式 */
const handleOpenModal = (payload: { type: string }): void => {
  if (payload.type === "createRepository") {
    handleOpenCreateRepositoryModal();
  } else if (payload.type === "cloneRepository") {
    handleOpenCloneRepositoryModal();
  }
};
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
      note-type="repository"
      :branch-name="getRepositoryBranchName(note.repositoryId as string)"
      @drag-end="noteHandlerMap.repository.handleDragEnd"
      @drag-move="noteHandlerMap.repository.handleDragMove"
      @drag-complete="noteHandlerMap.repository.handleDragComplete"
      @contextmenu="handleRepositoryContextMenu"
    />

    <GenericNote
      v-for="note in commandStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="command"
      @drag-end="noteHandlerMap.command.handleDragEnd"
      @drag-move="noteHandlerMap.command.handleDragMove"
      @drag-complete="noteHandlerMap.command.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
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
    @open-create-modal="wrappedHandleOpenCreateModal"
    @open-create-group-modal="wrappedHandleOpenCreateGroupModal"
    @open-edit-modal="wrappedHandleOpenEditModal"
    @open-delete-modal="handleOpenDeleteModal"
    @open-delete-group-modal="handleOpenDeleteGroupModal"
    @close="podStore.hideTypeMenu"
  />

  <TrashZone
    ref="trashZoneRef"
    :visible="showTrashZone"
    :is-highlighted="isTrashHighlighted"
  />

  <PodContextMenu
    v-if="podContextMenu.visible"
    :position="podContextMenu.position"
    :pod-id="podContextMenu.data.podId"
    @close="closePodContextMenu"
    @connect-integration="handleConnectIntegration"
    @disconnect-integration="handleDisconnectIntegration"
  />

  <RepositoryContextMenu
    v-if="repositoryContextMenu.visible"
    :position="repositoryContextMenu.position"
    :repository-id="repositoryContextMenu.data.repositoryId"
    :repository-name="repositoryContextMenu.data.repositoryName"
    :note-position="repositoryContextMenu.data.notePosition"
    :is-worktree="repositoryContextMenu.data.isWorktree"
    @close="closeRepositoryContextMenu"
    @worktree-created="closeRepositoryContextMenu"
    @pull-started="handlePullStarted"
  />

  <ConnectionContextMenu
    v-if="connectionContextMenu.visible"
    :position="connectionContextMenu.position"
    :connection-id="connectionContextMenu.data.connectionId"
    :current-trigger-mode="connectionContextMenu.data.triggerMode"
    :current-summary-model="connectionContextMenu.data.summaryModel"
    :current-ai-decide-model="connectionContextMenu.data.aiDecideModel"
    @close="closeConnectionContextMenu"
    @trigger-mode-changed="closeConnectionContextMenu"
    @ai-decide-model-changed="closeConnectionContextMenu"
  />

  <CreateRepositoryModal
    v-model:open="showCreateRepositoryModal"
    @created="handleRepositoryCreated"
  />

  <CloneRepositoryModal
    v-model:open="showCloneRepositoryModal"
    @clone-started="handleCloneStarted"
  />

  <ConfirmDeleteModal
    v-model:open="showDeleteModal"
    :item-name="deleteTarget?.name ?? ''"
    :is-in-use="isDeleteTargetInUse"
    :item-type="deleteTarget?.type ?? 'repository'"
    @confirm="handleDeleteConfirm"
  />

  <CreateEditModal
    v-model:open="editModal.visible"
    :mode="editModal.mode"
    :title="editModal.title"
    :initial-name="editModal.initialName"
    :initial-content="editModal.initialContent"
    :name-editable="editModal.mode === 'create'"
    :show-content="editModal.showContent"
    @submit="handleCreateEditSubmit"
  />

  <IntegrationConnectModal
    v-model:open="integrationConnectModal.visible"
    :pod-id="integrationConnectModal.podId"
    :provider="integrationConnectModal.provider"
  />
</template>
