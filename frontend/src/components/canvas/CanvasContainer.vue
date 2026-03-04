<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue'
import {useCanvasContext} from '@/composables/canvas/useCanvasContext'
import {useDeleteSelection, useGitCloneProgress, useCheckoutProgress, usePullProgress, useNoteEventHandlers} from '@/composables/canvas'
import {useRemoteCursors} from '@/composables/canvas/useRemoteCursors'
import {useCursorTracker} from '@/composables/canvas/useCursorTracker'
import {useContextMenu} from '@/composables/canvas/useContextMenu'
import {useEditModal} from '@/composables/canvas/useEditModal'
import {useDeleteResource} from '@/composables/canvas/useDeleteResource'
import {isCtrlOrCmdPressed} from '@/utils/keyboardHelpers'
import CanvasViewport from './CanvasViewport.vue'
import RemoteCursorLayer from './RemoteCursorLayer.vue'
import EmptyState from './EmptyState.vue'
import PodTypeMenu from './PodTypeMenu.vue'
import CanvasPod from '@/components/pod/CanvasPod.vue'
import GenericNote from './GenericNote.vue'
import ProgressNote from './ProgressNote.vue'
import type { ProgressTask } from './ProgressNote.vue'
import TrashZone from './TrashZone.vue'
import ConnectionLayer from './ConnectionLayer.vue'
import SelectionBox from './SelectionBox.vue'
import RepositoryContextMenu from './RepositoryContextMenu.vue'
import ConnectionContextMenu from './ConnectionContextMenu.vue'
import PodContextMenu from './PodContextMenu.vue'
import CreateRepositoryModal from './CreateRepositoryModal.vue'
import CloneRepositoryModal from './CloneRepositoryModal.vue'
import ConfirmDeleteModal from './ConfirmDeleteModal.vue'
import CreateEditModal from './CreateEditModal.vue'
import McpServerModal from './McpServerModal.vue'
import SlackConnectModal from '@/components/slack/SlackConnectModal.vue'
import type {Pod, PodTypeConfig, Position, McpServerConfig, TriggerMode} from '@/types'
import {
  POD_MENU_X_OFFSET,
  POD_MENU_Y_OFFSET,
  DEFAULT_POD_ROTATION_RANGE,
} from '@/lib/constants'
import { screenToCanvasPosition } from '@/lib/canvasCoordinateUtils'
import { useSlackStore } from '@/stores/slackStore'

type EditableNoteType = 'outputStyle' | 'subAgent' | 'command'

const {
  podStore,
  viewportStore,
  selectionStore,
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  connectionStore
} = useCanvasContext()

useDeleteSelection()
useRemoteCursors()

const viewportRef = ref<InstanceType<typeof CanvasViewport> | null>(null)
const viewportContainerRef = computed(() => viewportRef.value?.el ?? null)
useCursorTracker(viewportContainerRef)

const gitCloneProgress = useGitCloneProgress()
const checkoutProgress = useCheckoutProgress()
const pullProgress = usePullProgress()

const trashZoneRef = ref<InstanceType<typeof TrashZone> | null>(null)

const {
  state: repositoryContextMenu,
  open: openRepositoryContextMenu,
  close: closeRepositoryContextMenu,
} = useContextMenu({
  repositoryId: '',
  repositoryName: '',
  notePosition: {x: 0, y: 0},
  isWorktree: false,
})

const {
  state: connectionContextMenu,
  open: openConnectionContextMenu,
  close: closeConnectionContextMenu,
} = useContextMenu({
  connectionId: '',
  triggerMode: 'auto' as TriggerMode,
})

const {
  state: podContextMenu,
  open: openPodContextMenu,
  close: closePodContextMenu,
} = useContextMenu({
  podId: '',
})

const showCreateRepositoryModal = ref(false)
const showCloneRepositoryModal = ref(false)
const lastMenuPosition = ref<Position | null>(null)

const slackConnectModal = ref<{ visible: boolean; podId: string }>({
  visible: false,
  podId: ''
})

const {
  editModal,
  mcpServerModal,
  handleOpenCreateModal,
  handleOpenCreateGroupModal,
  handleOpenEditModal,
  handleCreateEditSubmit,
  handleOpenMcpServerModal: openMcpServerModal,
  handleMcpServerModalSubmit: submitMcpServerModal,
} = useEditModal(
  { outputStyleStore, subAgentStore, commandStore, viewportStore },
  lastMenuPosition
)

const {
  showDeleteModal,
  deleteTarget,
  isDeleteTargetInUse,
  handleOpenDeleteModal,
  handleOpenDeleteGroupModal,
  handleConfirmDelete: handleDeleteConfirm,
} = useDeleteResource({
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
})

const noteConfigs = [
  { store: outputStyleStore, type: 'outputStyle' as const },
  { store: skillStore, type: 'skill' as const },
  { store: subAgentStore, type: 'subAgent' as const },
  { store: repositoryStore, type: 'repository' as const },
  { store: commandStore, type: 'command' as const },
  { store: mcpServerStore, type: 'mcpServer' as const },
] as const

const allNoteStores = noteConfigs.map(config => config.store)

const checkAnyStoreProperty = (property: 'isDraggingNote' | 'isOverTrash'): boolean =>
  allNoteStores.some(store => store[property])

const showTrashZone = computed(() => checkAnyStoreProperty('isDraggingNote'))
const isTrashHighlighted = computed(() => checkAnyStoreProperty('isOverTrash'))

const isCanvasEmpty = computed(() =>
    podStore.podCount === 0 &&
    allNoteStores.every(store => store.notes.length === 0)
)

const noteHandlerMap = Object.fromEntries(
  noteConfigs.map(config => [config.type, useNoteEventHandlers({ store: config.store, trashZoneRef })])
) as Record<typeof noteConfigs[number]['type'], ReturnType<typeof useNoteEventHandlers>>

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault()
  const target = e.target as HTMLElement

  if (
      target.classList.contains('viewport') ||
      target.classList.contains('canvas-content')
  ) {
    podStore.showTypeMenu({x: e.clientX, y: e.clientY})
  }
}

const handleCanvasClick = (e: MouseEvent): void => {
  if (selectionStore.boxSelectJustEnded) {
    return
  }

  const target = e.target as HTMLElement

  const ignoredSelectors = [
    '.connection-line',
    '.pod-doodle',
    '.output-style-note',
    '.skill-note',
    '.subagent-note',
    '.repository-note',
    '.command-note',
    '.mcp-server-note'
  ]
  if (ignoredSelectors.some(selector => target.closest(selector))) {
    return
  }

  if (isCtrlOrCmdPressed(e)) {
    return
  }

  selectionStore.clearSelection()
  connectionStore.selectConnection(null)
}

const handleSelectType = async (_config: PodTypeConfig): Promise<void> => {
  if (!podStore.typeMenu.position) return

  const { x: canvasX, y: canvasY } = screenToCanvasPosition(podStore.typeMenu.position, viewportStore)

  const rotation = Math.random() * DEFAULT_POD_ROTATION_RANGE - (DEFAULT_POD_ROTATION_RANGE / 2)
  const newPod = {
    name: podStore.getNextPodName(),
    x: canvasX - POD_MENU_X_OFFSET,
    y: canvasY - POD_MENU_Y_OFFSET,
    output: [],
    rotation: Math.round(rotation * 10) / 10,
  }

  podStore.hideTypeMenu()

  await podStore.createPodWithBackend(newPod)
}

const handleSelectPod = (podId: string): void => {
  podStore.selectPod(podId)
}

const handleUpdatePod = async (pod: Pod): Promise<void> => {
  const oldPod = podStore.getPodById(pod.id)
  if (!oldPod) return

  const oldName = oldPod.name
  podStore.updatePod(pod)

  if (oldName !== pod.name) {
    try {
      await podStore.renamePodWithBackend(pod.id, pod.name)
    } catch {
      podStore.updatePod({ ...pod, name: oldName })
    }
  }
}

const handleDeletePod = async (id: string): Promise<void> => {
  await podStore.deletePodWithBackend(id)
}

const handleDragEnd = (data: { id: string; x: number; y: number }): void => {
  podStore.movePod(data.id, data.x, data.y)
}

const handlePodDragComplete = (data: { id: string }): void => {
  podStore.syncPodPosition(data.id)
}

const createNoteHandler = (store: { createNote: (id: string, x: number, y: number) => void }) => {
  return (itemId: string): void => {
    if (!podStore.typeMenu.position) return

    const { x, y } = screenToCanvasPosition(podStore.typeMenu.position, viewportStore)

    store.createNote(itemId, x, y)
  }
}

const handleCreateOutputStyleNote = createNoteHandler(outputStyleStore)
const handleCreateSkillNote = createNoteHandler(skillStore)
const handleCreateSubAgentNote = createNoteHandler(subAgentStore)
const handleCreateRepositoryNote = createNoteHandler(repositoryStore)
const handleCreateCommandNote = createNoteHandler(commandStore)
const handleCreateMcpServerNote = createNoteHandler(mcpServerStore)

const getRepositoryBranchName = (repositoryId: string): string | undefined => {
  const repository = repositoryStore.typedAvailableItems.find(r => r.id === repositoryId)
  return repository?.currentBranch ?? repository?.branchName
}

const handleRepositoryContextMenu = (data: { noteId: string; event: MouseEvent }): void => {
  const note = repositoryStore.typedNotes.find(note => note.id === data.noteId)
  if (!note) return

  const repository = repositoryStore.typedAvailableItems.find(r => r.id === note.repositoryId)
  if (!repository) return

  openRepositoryContextMenu(data.event, {
    repositoryId: repository.id,
    repositoryName: repository.name,
    notePosition: {x: note.x, y: note.y},
    isWorktree: repository.parentRepoId !== undefined && repository.parentRepoId !== null,
  })
}

const handleConnectionContextMenu = (data: { connectionId: string; event: MouseEvent }): void => {
  const connection = connectionStore.connections.find(connection => connection.id === data.connectionId)
  if (!connection) return

  openConnectionContextMenu(data.event, {
    connectionId: connection.id,
    triggerMode: connection.triggerMode,
  })
}

const handlePodContextMenu = (data: { podId: string; event: MouseEvent }): void => {
  const pod = podStore.getPodById(data.podId)
  if (!pod) return

  openPodContextMenu(data.event, {
    podId: pod.id,
  })
}

const handleConnectSlack = (podId: string): void => {
  slackConnectModal.value = { visible: true, podId }
}

const handleDisconnectSlack = async (podId: string): Promise<void> => {
  await useSlackStore().unbindSlackFromPod(podId)
}

const handleCloneStarted = (payload: { requestId: string; repoName: string }): void => {
  gitCloneProgress.addTask(payload.requestId, payload.repoName)
}

const handlePullStarted = (payload: { requestId: string; repositoryName: string; repositoryId: string }): void => {
  pullProgress.addTask(payload.requestId, payload.repositoryName, payload.repositoryId)
}

const allProgressTasks = computed<Map<string, ProgressTask>>(() => {
  const result = new Map<string, ProgressTask>()
  for (const [key, task] of gitCloneProgress.progressTasks.value) {
    result.set(key, task)
  }
  for (const [key, task] of checkoutProgress.progressTasks.value) {
    result.set(key, task)
  }
  for (const [key, task] of pullProgress.progressTasks.value) {
    result.set(key, task)
  }
  return result
})

const handleOpenCreateRepositoryModal = (): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  showCreateRepositoryModal.value = true
}

const handleOpenCloneRepositoryModal = (): void => {
  showCloneRepositoryModal.value = true
}

const handleRepositoryCreated = (repository: { id: string; name: string }): void => {
  if (!lastMenuPosition.value) return

  const {x, y} = screenToCanvasPosition(lastMenuPosition.value, viewportStore)

  repositoryStore.createNote(repository.id, x, y)
}

const editableNoteResourceIdGetters: Record<EditableNoteType, (noteId: string) => string | undefined> = {
  outputStyle: (noteId) => outputStyleStore.typedNotes.find(note => note.id === noteId)?.outputStyleId,
  subAgent: (noteId) => subAgentStore.typedNotes.find(note => note.id === noteId)?.subAgentId,
  command: (noteId) => commandStore.typedNotes.find(note => note.id === noteId)?.commandId,
}

const handleOpenMcpServerModal = (mode: 'create' | 'edit', mcpServerId?: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  openMcpServerModal(mode, mcpServerId)
}

const handleMcpServerModalSubmit = async (payload: { name: string; config: McpServerConfig }): Promise<void> => {
  await submitMcpServerModal(payload, mcpServerStore)
}

const handleMcpServerDoubleClick = async (noteId: string): Promise<void> => {
  const note = mcpServerStore.typedNotes.find(note => note.id === noteId)
  if (!note) return

  const mcpServerId = note.mcpServerId
  const mcpServerData = await mcpServerStore.readMcpServer(mcpServerId)

  if (!mcpServerData) {
    console.error(`無法讀取 MCP Server (id: ${mcpServerId})，請確認後端是否正常運作`)
    return
  }

  mcpServerModal.value = {
    visible: true,
    mode: 'edit',
    mcpServerId,
    initialName: mcpServerData.name,
    initialConfig: mcpServerData.config
  }
}

const handleNoteDoubleClick = async (data: {
  noteId: string;
  noteType: 'outputStyle' | 'skill' | 'subAgent' | 'repository' | 'command' | 'mcpServer'
}): Promise<void> => {
  const {noteId, noteType} = data

  if (noteType === 'mcpServer') {
    await handleMcpServerDoubleClick(noteId)
    return
  }

  const getResourceId = editableNoteResourceIdGetters[noteType as EditableNoteType]
  if (!getResourceId) return

  const resourceId = getResourceId(noteId)

  if (resourceId) {
    handleOpenEditModal(noteType as EditableNoteType, resourceId)
  } else {
    console.error(`無法找到 Note (id: ${noteId}, type: ${noteType}) 的資源 ID`)
  }
}

const wrappedHandleOpenCreateModal = (resourceType: 'outputStyle' | 'subAgent' | 'command', title: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  handleOpenCreateModal(resourceType, title)
}

const wrappedHandleOpenCreateGroupModal = (groupType: 'outputStyleGroup' | 'subAgentGroup' | 'commandGroup', title: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  handleOpenCreateGroupModal(groupType, title)
}

const wrappedHandleOpenEditModal = async (resourceType: 'outputStyle' | 'subAgent' | 'command', id: string): Promise<void> => {
  lastMenuPosition.value = podStore.typeMenu.position
  await handleOpenEditModal(resourceType, id)
}

onUnmounted(() => {
  gitCloneProgress.cleanupListeners()
  checkoutProgress.cleanupListeners()
  pullProgress.cleanupListeners()
})
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
      v-for="note in outputStyleStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="outputStyle"
      @drag-end="noteHandlerMap.outputStyle.handleDragEnd"
      @drag-move="noteHandlerMap.outputStyle.handleDragMove"
      @drag-complete="noteHandlerMap.outputStyle.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
    />

    <GenericNote
      v-for="note in skillStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="skill"
      @drag-end="noteHandlerMap.skill.handleDragEnd"
      @drag-move="noteHandlerMap.skill.handleDragMove"
      @drag-complete="noteHandlerMap.skill.handleDragComplete"
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
    @create-output-style-note="handleCreateOutputStyleNote"
    @create-skill-note="handleCreateSkillNote"
    @create-subagent-note="handleCreateSubAgentNote"
    @create-repository-note="handleCreateRepositoryNote"
    @create-command-note="handleCreateCommandNote"
    @create-mcp-server-note="handleCreateMcpServerNote"
    @open-mcp-server-modal="handleOpenMcpServerModal"
    @clone-started="handleCloneStarted"
    @open-create-modal="wrappedHandleOpenCreateModal"
    @open-create-group-modal="wrappedHandleOpenCreateGroupModal"
    @open-edit-modal="wrappedHandleOpenEditModal"
    @open-delete-modal="handleOpenDeleteModal"
    @open-delete-group-modal="handleOpenDeleteGroupModal"
    @open-create-repository-modal="handleOpenCreateRepositoryModal"
    @open-clone-repository-modal="handleOpenCloneRepositoryModal"
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
    @connect-slack="handleConnectSlack"
    @disconnect-slack="handleDisconnectSlack"
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
    @close="closeConnectionContextMenu"
    @trigger-mode-changed="closeConnectionContextMenu"
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
    :item-type="deleteTarget?.type ?? 'outputStyle'"
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

  <SlackConnectModal
    v-model:open="slackConnectModal.visible"
    :pod-id="slackConnectModal.podId"
  />
</template>
