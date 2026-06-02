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
import BranchEditModal from "./BranchEditModal.vue";
import RepositoryMemoryConfirmModal from "./RepositoryMemoryConfirmModal.vue";
import PodMemoryConfirmModal from "./PodMemoryConfirmModal.vue";
import MemoryViewerModal from "./MemoryViewerModal.vue";
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
  connectionStore,
} = useCanvasContext();
const { t } = useI18n();

useDeleteSelection();
useRemoteCursors();

const viewportRef = ref<InstanceType<typeof CanvasViewport> | null>(null);
const viewportContainerRef = computed(() => viewportRef.value?.el ?? null);
useCursorTracker(viewportContainerRef);

const trashZoneRef = ref<InstanceType<typeof TrashZone> | null>(null);

const showCreateRepositoryModal = ref(false);
const showCloneRepositoryModal = ref(false);
const lastMenuPosition = ref<Position | null>(null);
const podMemoryConfirmModal = ref<{
  visible: boolean;
  podId: string;
  podName: string;
}>({
  visible: false,
  podId: "",
  podName: "",
});
const repoMemoryConfirmModal = ref<{
  visible: boolean;
  repositoryId: string;
  repositoryName: string;
}>({
  visible: false,
  repositoryId: "",
  repositoryName: "",
});
const memoryViewerModal = ref<{
  visible: boolean;
  title: string;
  summary: string | null;
  summaryUpdatedAt: string | null;
  emptyMessage: string;
}>({
  visible: false,
  title: "",
  summary: null,
  summaryUpdatedAt: null,
  emptyMessage: "",
});

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
    rotation: Math.round(rotation * 10) / 10,
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

const handleSwitchPodProvider = async (
  podId: string,
  provider: PodProvider,
  providerConfig: ProviderConfig,
): Promise<void> => {
  await podStore.updatePodProvider(podId, provider, providerConfig);
};

const handleSetPodMemoryEnabled = async (
  podId: string,
  memoryEnabled: boolean,
): Promise<void> => {
  await podStore.setPodMemoryEnabledWithBackend(podId, memoryEnabled);
};

const handleSetRepoMemoryEnabled = async (
  repositoryId: string,
  memoryEnabled: boolean,
): Promise<void> => {
  await repositoryStore.setRepoMemoryEnabled(repositoryId, memoryEnabled);
};

const handleClearPodMemory = async (podId: string): Promise<void> => {
  const pod = podStore.getPodById(podId);
  if (!pod) return;

  podMemoryConfirmModal.value = {
    visible: true,
    podId,
    podName: pod.name,
  };
};

const handleViewPodMemory = async (podId: string): Promise<void> => {
  const pod = podStore.getPodById(podId);
  if (!pod) return;

  const result = await podStore.getPodMemory(podId);
  if (!result.success) return;

  memoryViewerModal.value = {
    visible: true,
    title: `${pod.name} · ${t("canvas.memoryViewer.podTitle")}`,
    summary: result.summary ?? null,
    summaryUpdatedAt: result.summaryUpdatedAt ?? null,
    emptyMessage: t("canvas.memoryViewer.emptyPod"),
  };
};

const handleViewRepoMemory = async (repositoryId: string): Promise<void> => {
  const repository = repositoryStore.typedAvailableItems.find(
    (item) => item.id === repositoryId,
  );
  if (!repository) return;

  const result = await repositoryStore.getRepoMemory(repositoryId);
  if (!result.success) return;

  memoryViewerModal.value = {
    visible: true,
    title: `${repository.name} · ${t("canvas.memoryViewer.repoTitle")}`,
    summary: result.summary ?? null,
    summaryUpdatedAt: result.summaryUpdatedAt ?? null,
    emptyMessage: t("canvas.memoryViewer.emptyRepo"),
  };
};

const handleMemoryViewerModalOpenChange = (open: boolean): void => {
  if (open) {
    memoryViewerModal.value.visible = true;
    return;
  }

  memoryViewerModal.value = {
    visible: false,
    title: "",
    summary: null,
    summaryUpdatedAt: null,
    emptyMessage: "",
  };
};

const handlePodMemoryConfirmModalOpenChange = (open: boolean): void => {
  if (open) {
    podMemoryConfirmModal.value.visible = true;
    return;
  }

  podMemoryConfirmModal.value = {
    visible: false,
    podId: "",
    podName: "",
  };
};

const handleConfirmClearPodMemory = async (): Promise<void> => {
  const podId = podMemoryConfirmModal.value.podId;
  if (!podId) return;

  await podStore.clearPodMemoryWithBackend(podId);
  handlePodMemoryConfirmModalOpenChange(false);
};

const handleClearRepoMemory = (repositoryId: string): void => {
  const repository = repositoryStore.typedAvailableItems.find(
    (item) => item.id === repositoryId,
  );
  if (!repository) return;

  repoMemoryConfirmModal.value = {
    visible: true,
    repositoryId,
    repositoryName: repository.name,
  };
};

const handleRepoMemoryConfirmModalOpenChange = (open: boolean): void => {
  if (open) {
    repoMemoryConfirmModal.value.visible = true;
    return;
  }

  repoMemoryConfirmModal.value = {
    visible: false,
    repositoryId: "",
    repositoryName: "",
  };
};

const handleConfirmClearRepoMemory = async (): Promise<void> => {
  const repositoryId = repoMemoryConfirmModal.value.repositoryId;
  if (!repositoryId) return;

  await repositoryStore.clearRepoMemory(repositoryId);
  handleRepoMemoryConfirmModalOpenChange(false);
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

/** 處理 PodTypeMenu 的統一 create-note 事件，依 type 分派至對應的 note 建立函式 */
const handleCreateNote = (payload: { type: string; id: string }): void => {
  if (payload.type === "repository") {
    handleCreateRepositoryNote(payload.id);
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

// ─── BranchEditModal：點擊「Branch」項目時開啟 ──────────────────────────────

const branchEditModal = ref<{
  visible: boolean;
  connectionId: string;
  sourcePodId: string;
  isAlreadyBranch: boolean;
  initialLabel: string;
  initialDescription: string;
}>({
  visible: false,
  connectionId: "",
  sourcePodId: "",
  isAlreadyBranch: false,
  initialLabel: "",
  initialDescription: "",
});

/** ConnectionContextMenu 點擊 Branch 項目時觸發；用 menu data 為 modal 預填初始值 */
const handleBranchModeClicked = (): void => {
  const data = connectionContextMenu.value.data;
  if (!data?.connectionId) return;

  // sourcePodId 從 connection store 取（context menu data 沒帶）
  const connection = connectionStore.connections.find(
    (c) => c.id === data.connectionId,
  );
  if (!connection?.sourcePodId) return;

  branchEditModal.value = {
    visible: true,
    connectionId: data.connectionId,
    sourcePodId: connection.sourcePodId,
    isAlreadyBranch: data.triggerMode === "branch",
    initialLabel: data.label ?? "",
    initialDescription: data.description ?? "",
  };
};

const handleBranchModalUpdateOpen = (open: boolean): void => {
  branchEditModal.value.visible = open;
};

/** Modal Save：呼叫合併 store action 一次更新 triggerMode + label + description */
const handleBranchModalSubmit = async (payload: {
  label: string;
  description: string;
}): Promise<void> => {
  const { connectionId, sourcePodId, isAlreadyBranch } = branchEditModal.value;
  const result = await connectionStore.updateConnectionBranchSettings(
    connectionId,
    sourcePodId,
    {
      switchToBranch: !isAlreadyBranch,
      label: payload.label,
      description: payload.description,
    },
  );

  // 失敗時 store 已顯示 toast，保持 modal 開啟讓使用者重試
  if (result) {
    branchEditModal.value.visible = false;
  }
};

const handleBranchProviderChanged = (): void => {
  // store action 已完成；host 不需額外行為
};

const handleBranchModelChanged = (): void => {
  // store action 已完成；host 不需額外行為
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
    @pull-started="handlePullStarted"
  />

  <ConnectionContextMenu
    v-if="connectionContextMenu.visible"
    :position="connectionContextMenu.position"
    :connection-id="connectionContextMenu.data.connectionId"
    :current-trigger-mode="connectionContextMenu.data.triggerMode"
    :current-summary-model="connectionContextMenu.data.summaryModel"
    :current-summary-provider="connectionContextMenu.data.summaryProvider"
    :current-branch-provider="connectionContextMenu.data.branchProvider"
    :current-branch-model="connectionContextMenu.data.branchModel"
    @close="closeConnectionContextMenu"
    @trigger-mode-changed="closeConnectionContextMenu"
    @branch-mode-clicked="handleBranchModeClicked"
    @branch-provider-changed="handleBranchProviderChanged"
    @branch-model-changed="handleBranchModelChanged"
  />

  <BranchEditModal
    :open="branchEditModal.visible"
    :connection-id="branchEditModal.connectionId"
    :source-pod-id="branchEditModal.sourcePodId"
    :is-already-branch="branchEditModal.isAlreadyBranch"
    :initial-label="branchEditModal.initialLabel"
    :initial-description="branchEditModal.initialDescription"
    @update:open="handleBranchModalUpdateOpen"
    @submit="handleBranchModalSubmit"
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
    :open="showDeleteModal"
    :item-name="deleteTarget?.name ?? ''"
    :is-in-use="isDeleteTargetInUse"
    :item-type="deleteTarget?.type ?? 'repository'"
    @update:open="(open) => !open && closeDeleteModal()"
    @confirm="handleDeleteConfirm"
  />

  <RepositoryMemoryConfirmModal
    :open="showDeleteMemoryModal"
    :repository-name="deleteTarget?.name ?? ''"
    mode="delete"
    @update:open="closeDeleteMemoryModal"
    @confirm="handleDeleteConfirmWithMemory"
  />

  <PodMemoryConfirmModal
    :open="podMemoryConfirmModal.visible"
    :pod-name="podMemoryConfirmModal.podName"
    @update:open="handlePodMemoryConfirmModalOpenChange"
    @confirm="handleConfirmClearPodMemory"
  />
  <RepositoryMemoryConfirmModal
    :open="repoMemoryConfirmModal.visible"
    :repository-name="repoMemoryConfirmModal.repositoryName"
    mode="clear"
    @update:open="handleRepoMemoryConfirmModalOpenChange"
    @confirm="handleConfirmClearRepoMemory"
  />
  <MemoryViewerModal
    :open="memoryViewerModal.visible"
    :title="memoryViewerModal.title"
    :summary="memoryViewerModal.summary"
    :summary-updated-at="memoryViewerModal.summaryUpdatedAt"
    :empty-message="memoryViewerModal.emptyMessage"
    @update:open="handleMemoryViewerModalOpenChange"
  />
  <IntegrationConnectModal
    v-model:open="integrationConnectModal.visible"
    :pod-id="integrationConnectModal.podId"
    :provider="integrationConnectModal.provider"
  />
</template>
