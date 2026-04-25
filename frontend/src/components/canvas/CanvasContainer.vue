<script setup lang="ts">
import { computed, ref } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useDeleteSelection } from "@/composables/canvas";
import { useRemoteCursors } from "@/composables/canvas/useRemoteCursors";
import { useCursorTracker } from "@/composables/canvas/useCursorTracker";
import { useEditModal } from "@/composables/canvas/useEditModal";
import { useMcpServerModal } from "@/composables/canvas/useMcpServerModal";
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
import McpServerModal from "./McpServerModal.vue";
import IntegrationConnectModal from "@/components/integration/IntegrationConnectModal.vue";
import type { Pod, PodTypeConfig, Position, McpServerConfig } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import {
  POD_MENU_X_OFFSET,
  POD_MENU_Y_OFFSET,
  DEFAULT_POD_ROTATION_RANGE,
} from "@/lib/constants";
import { screenToCanvasPosition } from "@/lib/canvasCoordinateUtils";
import { useIntegrationStore } from "@/stores/integrationStore";

const {
  podStore,
  viewportStore,
  selectionStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
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
} = useEditModal(
  { subAgentStore, commandStore, viewportStore },
  lastMenuPosition,
);

const {
  mcpServerModal,
  handleOpenMcpServerModal: openMcpServerModal,
  handleMcpServerModalSubmit: submitMcpServerModal,
} = useMcpServerModal({ viewportStore, lastMenuPosition });

const {
  showDeleteModal,
  deleteTarget,
  isDeleteTargetInUse,
  handleOpenDeleteModal,
  handleOpenDeleteGroupModal,
  handleConfirmDelete: handleDeleteConfirm,
} = useDeleteResource({
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
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
  handleCreateSubAgentNote,
  handleCreateRepositoryNote,
  handleCreateCommandNote,
  handleCreateMcpServerNote,
  getRepositoryBranchName,
  handleNoteDoubleClick,
} = useCanvasNoteHandlers({
  podStore,
  viewportStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  trashZoneRef,
  handleOpenEditModal,
  mcpServerModal,
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
    ".subagent-note",
    ".repository-note",
    ".command-note",
    ".mcp-server-note",
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

const handleMcpServerModalSubmit = async (payload: {
  name: string;
  config: McpServerConfig;
}): Promise<void> => {
  await submitMcpServerModal(payload, mcpServerStore);
};

const wrappedHandleOpenCreateModal = withMenuPosition(handleOpenCreateModal);
const wrappedHandleOpenCreateGroupModal = withMenuPosition(
  handleOpenCreateGroupModal,
);
const wrappedHandleOpenEditModal = withMenuPosition(handleOpenEditModal);
const handleOpenMcpServerModal = withMenuPosition(openMcpServerModal);

/** 處理 PodTypeMenu 的統一 create-note 事件，依 type 分派至對應的 note 建立函式 */
const handleCreateNote = (payload: {
  type: "subAgent" | "repository" | "command" | "mcpServer";
  id: string;
}): void => {
  const handlerMap = {
    subAgent: handleCreateSubAgentNote,
    repository: handleCreateRepositoryNote,
    command: handleCreateCommandNote,
    mcpServer: handleCreateMcpServerNote,
  } as const;
  handlerMap[payload.type](payload.id);
};

/** 處理 PodTypeMenu 的統一 open-modal 事件，依 type 分派至對應的 Modal 開啟函式 */
const handleOpenModal = (payload: {
  type: "createRepository" | "cloneRepository" | "mcpServer";
  mode?: "create" | "edit";
  mcpServerId?: string;
}): void => {
  if (payload.type === "createRepository") {
    handleOpenCreateRepositoryModal();
  } else if (payload.type === "cloneRepository") {
    handleOpenCloneRepositoryModal();
  } else if (payload.type === "mcpServer") {
    handleOpenMcpServerModal(payload.mode ?? "create", payload.mcpServerId);
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

    <CanvasPod
      v-for="pod in podStore.pods"
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
      v-for="note in subAgentStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="subAgent"
      @drag-end="noteHandlerMap.subAgent.handleDragEnd"
      @drag-move="noteHandlerMap.subAgent.handleDragMove"
      @drag-complete="noteHandlerMap.subAgent.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
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

    <GenericNote
      v-for="note in mcpServerStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="mcpServer"
      @drag-end="noteHandlerMap.mcpServer.handleDragEnd"
      @drag-move="noteHandlerMap.mcpServer.handleDragMove"
      @drag-complete="noteHandlerMap.mcpServer.handleDragComplete"
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

  <McpServerModal
    v-model:open="mcpServerModal.visible"
    :mode="mcpServerModal.mode"
    :initial-name="mcpServerModal.initialName"
    :initial-config="mcpServerModal.initialConfig"
    @submit="handleMcpServerModalSubmit"
  />

  <IntegrationConnectModal
    v-model:open="integrationConnectModal.visible"
    :pod-id="integrationConnectModal.podId"
    :provider="integrationConnectModal.provider"
  />
</template>
