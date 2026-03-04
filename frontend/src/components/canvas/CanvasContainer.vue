<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue'
import {useCanvasContext} from '@/composables/canvas/useCanvasContext'
import {useDeleteSelection, useGitCloneProgress, useCheckoutProgress, usePullProgress, useNoteEventHandlers} from '@/composables/canvas'
import {useRemoteCursors} from '@/composables/canvas/useRemoteCursors'
import {useCursorTracker} from '@/composables/canvas/useCursorTracker'
import {useContextMenu} from '@/composables/canvas/useContextMenu'
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
import type {Pod, PodTypeConfig, Position, Group, TriggerMode, McpServerConfig} from '@/types'
import {
  POD_MENU_X_OFFSET,
  POD_MENU_Y_OFFSET,
  DEFAULT_POD_ROTATION_RANGE,
} from '@/lib/constants'
import { useSlackStore } from '@/stores/slackStore'

type ItemType = 'outputStyle' | 'skill' | 'repository' | 'subAgent' | 'command' | 'mcpServer'
type ResourceType = 'outputStyle' | 'subAgent' | 'command'
type GroupType = 'outputStyleGroup' | 'subAgentGroup' | 'commandGroup'
type ExtendedResourceType = ResourceType | GroupType
type ExtendedItemType = ItemType | GroupType

interface DeleteTarget {
  type: ExtendedItemType
  id: string
  name: string
}

interface EditModalState {
  visible: boolean
  mode: 'create' | 'edit'
  title: string
  initialName: string
  initialContent: string
  resourceType: ExtendedResourceType
  itemId: string
  showContent: boolean
}

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
const showDeleteModal = ref(false)
const deleteTarget = ref<DeleteTarget | null>(null)
const lastMenuPosition = ref<Position | null>(null)

const editModal = ref<EditModalState>({
  visible: false,
  mode: 'create',
  title: '',
  initialName: '',
  initialContent: '',
  resourceType: 'outputStyle',
  itemId: '',
  showContent: true
})

interface McpServerModalState {
  visible: boolean
  mode: 'create' | 'edit'
  mcpServerId: string
  initialName: string
  initialConfig: McpServerConfig | undefined
}

const mcpServerModal = ref<McpServerModalState>({
  visible: false,
  mode: 'create',
  mcpServerId: '',
  initialName: '',
  initialConfig: undefined
})

const slackConnectModal = ref<{ visible: boolean; podId: string }>({
  visible: false,
  podId: ''
})

const isDeleteTargetInUse = computed(() => {
  if (!deleteTarget.value) return false

  const {type, id} = deleteTarget.value

  const inUseChecks: Record<ExtendedItemType, () => boolean> = {
    outputStyle: (): boolean => outputStyleStore.isItemInUse(id),
    skill: (): boolean => skillStore.isItemInUse(id),
    subAgent: (): boolean => subAgentStore.isItemInUse(id),
    repository: (): boolean => repositoryStore.isItemInUse(id),
    command: (): boolean => commandStore.isItemInUse(id),
    mcpServer: (): boolean => mcpServerStore.isItemInUse(id),
    outputStyleGroup: (): boolean => false,
    subAgentGroup: (): boolean => false,
    commandGroup: (): boolean => false,
  }

  return inUseChecks[type]()
})

/**
 * 檢查所有 Store 是否有任何屬性為 true
 * @param property - Store 屬性名稱（例如 'isDraggingNote' 或 'isOverTrash'）
 * @returns 是否有任何 Store 的該屬性為 true
 */
const checkAnyStoreProperty = (property: 'isDraggingNote' | 'isOverTrash'): boolean => {
  const stores = [outputStyleStore, skillStore, subAgentStore, repositoryStore, commandStore, mcpServerStore]
  return stores.some(store => store[property])
}

const showTrashZone = computed(() => checkAnyStoreProperty('isDraggingNote'))
const isTrashHighlighted = computed(() => checkAnyStoreProperty('isOverTrash'))

const isCanvasEmpty = computed(() =>
    podStore.podCount === 0 &&
    outputStyleStore.notes.length === 0 &&
    skillStore.notes.length === 0 &&
    subAgentStore.notes.length === 0 &&
    repositoryStore.notes.length === 0 &&
    commandStore.notes.length === 0 &&
    mcpServerStore.notes.length === 0
)

const resourceTitleMap = {
  outputStyle: 'Output Style',
  subAgent: 'SubAgent',
  command: 'Command'
} as const

const readActions: Record<ResourceType, (id: string) => Promise<{
  id: string;
  name: string;
  content: string
} | null>> = {
  outputStyle: (id) => outputStyleStore.readOutputStyle(id),
  subAgent: (id) => subAgentStore.readSubAgent(id),
  command: (id) => commandStore.readCommand(id)
}

const CANVAS_COORDINATE_MIN = -100000
const CANVAS_COORDINATE_MAX = 100000

/**
 * 驗證並限制座標值在有效範圍內
 * @param value - 原始座標值
 * @returns 有效的座標值（限制在 -100000 ~ 100000 之間）
 */
const validateCoordinate = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(CANVAS_COORDINATE_MIN, Math.min(CANVAS_COORDINATE_MAX, value))
}

/**
 * 將螢幕座標轉換為畫布座標
 * @param screenPos - 螢幕座標（例如滑鼠點擊位置）
 * @returns 畫布座標（考慮 offset 和 zoom）
 */
const screenToCanvasPosition = (screenPos: Position): Position => {
  return {
    x: validateCoordinate((screenPos.x - viewportStore.offset.x) / viewportStore.zoom),
    y: validateCoordinate((screenPos.y - viewportStore.offset.y) / viewportStore.zoom)
  }
}

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

  const { x: canvasX, y: canvasY } = screenToCanvasPosition(podStore.typeMenu.position)

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

    const canvasX = validateCoordinate((podStore.typeMenu.position.x - viewportStore.offset.x) / viewportStore.zoom)
    const canvasY = validateCoordinate((podStore.typeMenu.position.y - viewportStore.offset.y) / viewportStore.zoom)

    store.createNote(itemId, canvasX, canvasY)
  }
}

const handleCreateOutputStyleNote = createNoteHandler(outputStyleStore)
const handleCreateSkillNote = createNoteHandler(skillStore)
const handleCreateSubAgentNote = createNoteHandler(subAgentStore)
const handleCreateRepositoryNote = createNoteHandler(repositoryStore)
const handleCreateCommandNote = createNoteHandler(commandStore)
const handleCreateMcpServerNote = createNoteHandler(mcpServerStore)

const outputStyleHandlers = useNoteEventHandlers({store: outputStyleStore, trashZoneRef})
const skillHandlers = useNoteEventHandlers({store: skillStore, trashZoneRef})
const subAgentHandlers = useNoteEventHandlers({store: subAgentStore, trashZoneRef})
const repositoryHandlers = useNoteEventHandlers({store: repositoryStore, trashZoneRef})
const commandHandlers = useNoteEventHandlers({store: commandStore, trashZoneRef})
const mcpServerHandlers = useNoteEventHandlers({store: mcpServerStore, trashZoneRef})

const getRepositoryBranchName = (repositoryId: string): string | undefined => {
  const repository = repositoryStore.typedAvailableItems.find(r => r.id === repositoryId)
  return repository?.currentBranch || repository?.branchName
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
    isWorktree: !!repository.parentRepoId,
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

const handleOpenCreateModal = (resourceType: ResourceType, title: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  editModal.value = {
    visible: true,
    mode: 'create',
    title,
    initialName: '',
    initialContent: '',
    resourceType,
    itemId: '',
    showContent: true
  }
}

const handleOpenCreateGroupModal = (groupType: GroupType, title: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  editModal.value = {
    visible: true,
    mode: 'create',
    title,
    initialName: '',
    initialContent: '',
    resourceType: groupType,
    itemId: '',
    showContent: false
  }
}

const handleOpenEditModal = async (resourceType: ResourceType, id: string): Promise<void> => {
  lastMenuPosition.value = podStore.typeMenu.position

  const data = await readActions[resourceType](id)

  if (!data) {
    console.error(`無法讀取 ${resourceTitleMap[resourceType]} (id: ${id})，請確認後端是否正常運作`)
    return
  }

  editModal.value = {
    visible: true,
    mode: 'edit',
    title: `編輯 ${resourceTitleMap[resourceType]}`,
    initialName: data.name,
    initialContent: data.content,
    resourceType,
    itemId: id,
    showContent: true
  }
}

const handleOpenDeleteModal = (type: ExtendedItemType, id: string, name: string): void => {
  deleteTarget.value = {type, id, name}
  showDeleteModal.value = true
}

const handleOpenDeleteGroupModal = (groupType: GroupType, groupId: string, name: string): void => {
  deleteTarget.value = {type: groupType, id: groupId, name}
  showDeleteModal.value = true
}

const handleOpenCreateRepositoryModal = (): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  showCreateRepositoryModal.value = true
}

const handleOpenCloneRepositoryModal = (): void => {
  showCloneRepositoryModal.value = true
}

const handleDeleteConfirm = async (): Promise<void> => {
  if (!deleteTarget.value) return

  const {type, id} = deleteTarget.value

  const deleteActions: Record<ExtendedItemType, () => Promise<void | { success: boolean; error?: string }>> = {
    outputStyle: (): Promise<void> => outputStyleStore.deleteOutputStyle(id),
    skill: (): Promise<void> => skillStore.deleteSkill(id),
    subAgent: (): Promise<void> => subAgentStore.deleteSubAgent(id),
    repository: (): Promise<void> => repositoryStore.deleteRepository(id),
    command: (): Promise<void> => commandStore.deleteCommand(id),
    mcpServer: (): Promise<void> => mcpServerStore.deleteMcpServer(id),
    outputStyleGroup: () => outputStyleStore.deleteGroup(id),
    subAgentGroup: () => subAgentStore.deleteGroup(id),
    commandGroup: () => commandStore.deleteGroup(id),
  }

  const result = await deleteActions[type]()

  if (result && typeof result === 'object' && !result.success) {
    console.error('刪除失敗:', result.error)
    return
  }

  showDeleteModal.value = false
  deleteTarget.value = null
}

const createResourceWithNote = async (
  name: string,
  content: string,
  createFn: (name: string, content: string) => Promise<{ success: boolean; [key: string]: unknown }>,
  storeName: string
): Promise<void> => {
  const result = await createFn(name, content)

  if (!result.success || !lastMenuPosition.value) return

  const resource = result[storeName]
  if (!resource || typeof resource !== 'object' || !('id' in resource)) return

  const {x, y} = screenToCanvasPosition(lastMenuPosition.value)
  const store = {
    outputStyle: outputStyleStore,
    subAgent: subAgentStore,
    command: commandStore
  }[storeName]

  if (store && 'createNote' in store) {
    await store.createNote(resource.id as string, x, y)
  }
}

const handleCreateEditSubmit = async (payload: { name: string; content: string }): Promise<void> => {
  const {name, content} = payload
  const {mode, resourceType, itemId} = editModal.value

  if (mode === 'edit') {
    const updateActions: Partial<Record<ExtendedResourceType, () => Promise<unknown>>> = {
      outputStyle: () => outputStyleStore.updateOutputStyle(itemId, content),
      subAgent: () => subAgentStore.updateSubAgent(itemId, content),
      command: () => commandStore.updateCommand(itemId, content)
    }

    const action = updateActions[resourceType]
    if (action) {
      await action()
    }

    editModal.value.visible = false
    return
  }

  const createActions: Record<ExtendedResourceType, () => Promise<void | { success: boolean; group?: Group; error?: string }>> = {
    outputStyle: () => createResourceWithNote(
      name,
      content,
      (n, c) => outputStyleStore.createOutputStyle(n, c),
      'outputStyle'
    ),
    subAgent: () => createResourceWithNote(
      name,
      content,
      (n, c) => subAgentStore.createSubAgent(n, c),
      'subAgent'
    ),
    command: () => createResourceWithNote(
      name,
      content,
      (n, c) => commandStore.createCommand(n, c),
      'command'
    ),
    outputStyleGroup: () => outputStyleStore.createGroup(name),
    subAgentGroup: () => subAgentStore.createGroup(name),
    commandGroup: () => commandStore.createGroup(name)
  }

  await createActions[resourceType]()
  editModal.value.visible = false
}

const handleRepositoryCreated = (repository: { id: string; name: string }): void => {
  if (!lastMenuPosition.value) return

  const {x, y} = screenToCanvasPosition(lastMenuPosition.value)

  repositoryStore.createNote(repository.id, x, y)
}

type EditableNoteType = 'outputStyle' | 'subAgent' | 'command'

const editableNoteResourceIdGetters: Record<EditableNoteType, (noteId: string) => string | undefined> = {
  outputStyle: (noteId) => outputStyleStore.typedNotes.find(note => note.id === noteId)?.outputStyleId,
  subAgent: (noteId) => subAgentStore.typedNotes.find(note => note.id === noteId)?.subAgentId,
  command: (noteId) => commandStore.typedNotes.find(note => note.id === noteId)?.commandId,
}

const handleOpenMcpServerModal = (mode: 'create' | 'edit', mcpServerId?: string): void => {
  lastMenuPosition.value = podStore.typeMenu.position
  mcpServerModal.value = {
    visible: true,
    mode,
    mcpServerId: mcpServerId ?? '',
    initialName: '',
    initialConfig: undefined
  }
}

const handleMcpServerModalSubmit = async (payload: { name: string; config: McpServerConfig }): Promise<void> => {
  const { name, config } = payload
  const { mode, mcpServerId } = mcpServerModal.value

  if (mode === 'edit') {
    await mcpServerStore.updateMcpServer(mcpServerId, name, config)
    mcpServerModal.value.visible = false
    return
  }

  const result = await mcpServerStore.createMcpServer(name, config)

  if (!result.success || !lastMenuPosition.value) {
    mcpServerModal.value.visible = false
    return
  }

  if (result.mcpServer) {
    const { x, y } = screenToCanvasPosition(lastMenuPosition.value)
    await mcpServerStore.createNote(result.mcpServer.id, x, y)
  }

  mcpServerModal.value.visible = false
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
      @drag-end="outputStyleHandlers.handleDragEnd"
      @drag-move="outputStyleHandlers.handleDragMove"
      @drag-complete="outputStyleHandlers.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
    />

    <GenericNote
      v-for="note in skillStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="skill"
      @drag-end="skillHandlers.handleDragEnd"
      @drag-move="skillHandlers.handleDragMove"
      @drag-complete="skillHandlers.handleDragComplete"
    />

    <GenericNote
      v-for="note in subAgentStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="subAgent"
      @drag-end="subAgentHandlers.handleDragEnd"
      @drag-move="subAgentHandlers.handleDragMove"
      @drag-complete="subAgentHandlers.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
    />

    <GenericNote
      v-for="note in repositoryStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="repository"
      :branch-name="getRepositoryBranchName(note.repositoryId as string)"
      @drag-end="repositoryHandlers.handleDragEnd"
      @drag-move="repositoryHandlers.handleDragMove"
      @drag-complete="repositoryHandlers.handleDragComplete"
      @contextmenu="handleRepositoryContextMenu"
    />

    <GenericNote
      v-for="note in commandStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="command"
      @drag-end="commandHandlers.handleDragEnd"
      @drag-move="commandHandlers.handleDragMove"
      @drag-complete="commandHandlers.handleDragComplete"
      @dblclick="handleNoteDoubleClick"
    />

    <GenericNote
      v-for="note in mcpServerStore.getUnboundNotes"
      :key="note.id"
      :note="note"
      note-type="mcpServer"
      @drag-end="mcpServerHandlers.handleDragEnd"
      @drag-move="mcpServerHandlers.handleDragMove"
      @drag-complete="mcpServerHandlers.handleDragComplete"
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
    @open-create-modal="handleOpenCreateModal"
    @open-create-group-modal="handleOpenCreateGroupModal"
    @open-edit-modal="handleOpenEditModal"
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
