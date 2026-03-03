<script setup lang="ts">
import {ref, computed, onUnmounted} from 'vue'
import type {Pod, ModelType, Schedule} from '@/types'
import type {AnchorPosition} from '@/types/connection'
import {useCanvasContext} from '@/composables/canvas/useCanvasContext'
import {useAnchorDetection} from '@/composables/useAnchorDetection'
import {useBatchDrag} from '@/composables/canvas'
import {useWebSocketErrorHandler} from '@/composables/useWebSocketErrorHandler'
import {useToast} from '@/composables/useToast'
import {isCtrlOrCmdPressed} from '@/utils/keyboardHelpers'
import {createWebSocketRequest, WebSocketRequestEvents, WebSocketResponseEvents} from '@/services/websocket'
import type {
  WorkflowGetDownstreamPodsResultPayload,
  WorkflowClearResultPayload,
  PodSetModelPayload,
  PodModelSetPayload,
  WorkflowGetDownstreamPodsPayload,
  WorkflowClearPayload
} from '@/types/websocket'
import {formatScheduleTooltip} from '@/utils/scheduleUtils'
import {getActiveCanvasIdOrWarn} from '@/utils/canvasGuard'
import PodHeader from '@/components/pod/PodHeader.vue'
import PodMiniScreen from '@/components/pod/PodMiniScreen.vue'
import PodSlots from '@/components/pod/PodSlots.vue'
import PodAnchors from '@/components/pod/PodAnchors.vue'
import PodActions from '@/components/pod/PodActions.vue'
import PodModelSelector from '@/components/pod/PodModelSelector.vue'
import SlackStatusIcon from '@/components/pod/SlackStatusIcon.vue'
import ScheduleModal from '@/components/canvas/ScheduleModal.vue'

const props = defineProps<{
  pod: Pod
}>()

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
  connectionStore,
  chatStore,
} = useCanvasContext()
const {detectTargetAnchor} = useAnchorDetection()
const {toast} = useToast()
const {startBatchDrag, isElementSelected, isBatchDragging} = useBatchDrag()

const isActive = computed(() => props.pod.id === podStore.activePodId)
const boundNote = computed(() => outputStyleStore.getNotesByPodId(props.pod.id)[0])
const boundSkillNotes = computed(() => skillStore.getNotesByPodId(props.pod.id))
const boundSubAgentNotes = computed(() => subAgentStore.getNotesByPodId(props.pod.id))
const boundRepositoryNote = computed(() => repositoryStore.getNotesByPodId(props.pod.id)[0])
const boundCommandNote = computed(() => commandStore.getNotesByPodId(props.pod.id)[0])
const boundMcpServerNotes = computed(() => mcpServerStore.getNotesByPodId(props.pod.id))
const isSourcePod = computed(() => connectionStore.isSourcePod(props.pod.id))
const hasUpstreamConnection = computed(() => connectionStore.hasUpstreamConnections(props.pod.id))
const showScheduleButton = computed(() => isSourcePod.value || !hasUpstreamConnection.value)
const currentModel = computed(() => props.pod.model ?? 'opus')

const isSelected = computed(() =>
    selectionStore.selectedPodIds.includes(props.pod.id)
)

const podStatusClass = computed(() => {
  return props.pod.status ? `pod-status-${props.pod.status}` : ''
})

const emit = defineEmits<{
  select: [podId: string]
  update: [pod: Pod]
  delete: [id: string]
  'drag-end': [data: { id: string; x: number; y: number }]
  'drag-complete': [data: { id: string }]
  contextmenu: [data: { podId: string; event: MouseEvent }]
}>()

const isDragging = ref(false)
const isEditing = ref(false)
const dragRef = ref<{
  startX: number
  startY: number
  podX: number
  podY: number
} | null>(null)

const showClearDialog = ref(false)
const downstreamPods = ref<Array<{ id: string; name: string }>>([])
const isLoadingDownstream = ref(false)
const isClearing = ref(false)
const showDeleteDialog = ref(false)
const showScheduleModal = ref(false)

const isAutoClearEnabled = computed(() => props.pod.autoClear ?? false)
const isAutoClearAnimating = computed(() => chatStore.autoClearAnimationPodId === props.pod.id)

const hasSchedule = computed(() => props.pod.schedule !== null && props.pod.schedule !== undefined)
const scheduleEnabled = computed(() => props.pod.schedule?.enabled ?? false)
const scheduleTooltip = computed(() => {
  if (!props.pod.schedule) return ''
  return formatScheduleTooltip(props.pod.schedule)
})

const isScheduleFiredAnimating = computed(() => podStore.isScheduleFiredAnimating(props.pod.id))
const isWorkflowRunning = computed(() => connectionStore.isWorkflowRunning(props.pod.id))

let currentMouseMoveHandler: ((e: MouseEvent) => void) | null = null
let currentMouseUpHandler: (() => void) | null = null

const cleanupEventListeners = (): void => {
  if (currentMouseMoveHandler) {
    document.removeEventListener('mousemove', currentMouseMoveHandler)
    currentMouseMoveHandler = null
  }
  if (currentMouseUpHandler) {
    document.removeEventListener('mouseup', currentMouseUpHandler)
    currentMouseUpHandler = null
  }
}

onUnmounted(() => {
  cleanupEventListeners()
})

const SLOT_CLASSES = [
  '.pod-output-style-slot',
  '.pod-skill-slot',
  '.pod-subagent-slot',
  '.pod-repository-slot',
  '.pod-command-slot',
  '.pod-mcp-server-slot'
]

const shouldBlockForSlot = (target: HTMLElement): boolean => {
  return SLOT_CLASSES.some(cls => target.closest(cls) !== null)
}

const handleCtrlClick = (): void => {
  selectionStore.toggleElement({type: 'pod', id: props.pod.id})
  podStore.setActivePod(props.pod.id)
  connectionStore.selectConnection(null)
}

const handleCtrlOrModifierClick = (e: MouseEvent): boolean => {
  if (!isCtrlOrCmdPressed(e)) return false
  handleCtrlClick()
  return true
}

const initiateSingleDrag = (e: MouseEvent): void => {
  if (!isElementSelected('pod', props.pod.id)) {
    selectionStore.setSelectedElements([{type: 'pod', id: props.pod.id}])
  }

  podStore.setActivePod(props.pod.id)
  connectionStore.selectConnection(null)
  cleanupEventListeners()

  isDragging.value = true
  dragRef.value = {
    startX: e.clientX,
    startY: e.clientY,
    podX: props.pod.x,
    podY: props.pod.y,
  }

  const handleMouseMove = (moveEvent: MouseEvent): void => {
    if (!dragRef.value) return

    const dx = (moveEvent.clientX - dragRef.value.startX) / viewportStore.zoom
    const dy = (moveEvent.clientY - dragRef.value.startY) / viewportStore.zoom

    emit('drag-end', {
      id: props.pod.id,
      x: dragRef.value.podX + dx,
      y: dragRef.value.podY + dy,
    })
  }

  const handleMouseUp = (): void => {
    emit('drag-complete', { id: props.pod.id })

    isDragging.value = false
    dragRef.value = null
    cleanupEventListeners()
  }

  currentMouseMoveHandler = handleMouseMove
  currentMouseUpHandler = handleMouseUp

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const handleMouseDown = (e: MouseEvent): void => {
  const target = e.target as HTMLElement

  if (shouldBlockForSlot(target)) return
  if (handleCtrlOrModifierClick(e)) return
  if (isElementSelected('pod', props.pod.id) && startBatchDrag(e)) return

  initiateSingleDrag(e)
}

const handleRename = (): void => {
  isEditing.value = true
}

const handleUpdateName = (name: string): void => {
  emit('update', {...props.pod, name})
}

const handleSaveName = (): void => {
  isEditing.value = false
}

const handleDelete = (): void => {
  emit('delete', props.pod.id)
  showDeleteDialog.value = false
}

const handleOpenScheduleModal = (): void => {
  showScheduleModal.value = true
}

const handleScheduleConfirm = async (schedule: Schedule): Promise<void> => {
  await podStore.setScheduleWithBackend(props.pod.id, schedule)
  showScheduleModal.value = false
}

const handleScheduleDelete = async (): Promise<void> => {
  await podStore.setScheduleWithBackend(props.pod.id, null)
  showScheduleModal.value = false
}

const handleScheduleToggle = async (): Promise<void> => {
  if (!props.pod.schedule) return

  const newSchedule = {
    ...props.pod.schedule,
    enabled: !props.pod.schedule.enabled
  }

  await podStore.setScheduleWithBackend(props.pod.id, newSchedule)
}

const handleSelectPod = (): void => {
  podStore.setActivePod(props.pod.id)
  emit('select', props.pod.id)
}

const handleDblClick = (e: MouseEvent): void => {
  if (isEditing.value || isDragging.value) return

  const target = e.target as HTMLElement

  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  handleSelectPod()
}

type NoteType = 'outputStyle' | 'skill' | 'subAgent' | 'repository' | 'command' | 'mcpServer'

interface NoteItem {
  outputStyleId?: string
  skillId?: string
  subAgentId?: string
  repositoryId?: string
  commandId?: string
  mcpServerId?: string
}

interface NoteStoreMapping {
  bindToPod: (noteId: string, podId: string) => Promise<void>
  getNoteById: (noteId: string) => NoteItem | undefined
  isItemBoundToPod?: (itemId: string, podId: string) => boolean
  unbindFromPod?: (podId: string, returnToOriginal: boolean) => Promise<void>
  getItemId: (note: NoteItem) => string | undefined
  updatePodField?: (podId: string, itemId: string | null) => void
}

const noteStoreMap: Record<NoteType, NoteStoreMapping> = {
  outputStyle: {
    bindToPod: (noteId, podId) => outputStyleStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => outputStyleStore.getNoteById(noteId),
    unbindFromPod: (podId, returnToOriginal) => outputStyleStore.unbindFromPod(podId, returnToOriginal),
    getItemId: (note) => note.outputStyleId,
    updatePodField: (podId, itemId) => podStore.updatePodOutputStyle(podId, itemId)
  },
  skill: {
    bindToPod: (noteId, podId) => skillStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => skillStore.getNoteById(noteId),
    isItemBoundToPod: (itemId, podId) => skillStore.isItemBoundToPod(itemId, podId),
    getItemId: (note) => note.skillId
  },
  subAgent: {
    bindToPod: (noteId, podId) => subAgentStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => subAgentStore.getNoteById(noteId),
    isItemBoundToPod: (itemId, podId) => subAgentStore.isItemBoundToPod(itemId, podId),
    getItemId: (note) => note.subAgentId
  },
  repository: {
    bindToPod: (noteId, podId) => repositoryStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => repositoryStore.getNoteById(noteId),
    unbindFromPod: (podId, returnToOriginal) => repositoryStore.unbindFromPod(podId, returnToOriginal),
    getItemId: (note) => note.repositoryId,
    updatePodField: (podId, itemId) => podStore.updatePodRepository(podId, itemId)
  },
  command: {
    bindToPod: (noteId, podId) => commandStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => commandStore.getNoteById(noteId),
    unbindFromPod: (podId, returnToOriginal) => commandStore.unbindFromPod(podId, returnToOriginal),
    getItemId: (note) => note.commandId,
    updatePodField: (podId, itemId) => podStore.updatePodCommand(podId, itemId)
  },
  mcpServer: {
    bindToPod: (noteId, podId) => mcpServerStore.bindToPod(noteId, podId),
    getNoteById: (noteId) => mcpServerStore.getNoteById(noteId),
    isItemBoundToPod: (itemId, podId) => mcpServerStore.isItemBoundToPod(itemId, podId),
    getItemId: (note) => note.mcpServerId
  }
}

const DUPLICATE_BIND_MESSAGES: Partial<Record<NoteType, string>> = {
  skill: '此 Skill 已綁定到此 Pod',
  subAgent: '此 SubAgent 已綁定到此 Pod',
  mcpServer: '此 MCP Server 已綁定到此 Pod',
}

const isAlreadyBound = (mapping: NoteStoreMapping, note: NoteItem, podId: string): boolean => {
  if (!mapping.isItemBoundToPod) return false
  const itemId = mapping.getItemId(note)
  return !!itemId && mapping.isItemBoundToPod(itemId, podId)
}

const handleNoteDrop = async (noteType: NoteType, noteId: string): Promise<void> => {
  const mapping = noteStoreMap[noteType]
  const note = mapping.getNoteById(noteId)
  if (!note) return

  if (isAlreadyBound(mapping, note, props.pod.id)) {
    const description = DUPLICATE_BIND_MESSAGES[noteType]
    if (description) {
      toast({title: '已存在，無法插入', description, duration: 3000})
    }
    return
  }

  await mapping.bindToPod(noteId, props.pod.id)

  if (mapping.updatePodField) {
    const itemId = mapping.getItemId(note)
    mapping.updatePodField(props.pod.id, itemId ?? null)
  }
}

const handleNoteRemove = async (noteType: NoteType): Promise<void> => {
  const mapping = noteStoreMap[noteType]
  if (!mapping.unbindFromPod) return

  await mapping.unbindFromPod(props.pod.id, true)

  if (mapping.updatePodField) {
    mapping.updatePodField(props.pod.id, null)
  }
}

const handleAnchorDragStart = (data: {
  podId: string
  anchor: AnchorPosition
  screenX: number
  screenY: number
}): void => {
  const canvasX = (data.screenX - viewportStore.offset.x) / viewportStore.zoom
  const canvasY = (data.screenY - viewportStore.offset.y) / viewportStore.zoom

  connectionStore.startDragging(data.podId, data.anchor, {x: canvasX, y: canvasY})
}

const handleAnchorDragMove = (data: { screenX: number; screenY: number }): void => {
  const canvasX = (data.screenX - viewportStore.offset.x) / viewportStore.zoom
  const canvasY = (data.screenY - viewportStore.offset.y) / viewportStore.zoom

  connectionStore.updateDraggingPosition({x: canvasX, y: canvasY})
}

const handleAnchorDragEnd = async (): Promise<void> => {
  if (!connectionStore.draggingConnection) {
    connectionStore.endDragging()
    return
  }

  const {sourcePodId, sourceAnchor, currentPoint} = connectionStore.draggingConnection
  if (!sourcePodId) return

  const targetAnchor = detectTargetAnchor(currentPoint, podStore.pods, sourcePodId)

  if (targetAnchor) {
    await connectionStore.createConnection(
        sourcePodId,
        sourceAnchor,
        targetAnchor.podId,
        targetAnchor.anchor
    )
  }

  connectionStore.endDragging()
}

const handleClearWorkflow = async (): Promise<void> => {
  const canvasId = getActiveCanvasIdOrWarn('CanvasPod')
  if (!canvasId) return

  isLoadingDownstream.value = true

  const {wrapWebSocketRequest} = useWebSocketErrorHandler()

  const response = await wrapWebSocketRequest(
      createWebSocketRequest<WorkflowGetDownstreamPodsPayload, WorkflowGetDownstreamPodsResultPayload>({
        requestEvent: WebSocketRequestEvents.WORKFLOW_GET_DOWNSTREAM_PODS,
        responseEvent: WebSocketResponseEvents.WORKFLOW_GET_DOWNSTREAM_PODS_RESULT,
        payload: {
          canvasId,
          sourcePodId: props.pod.id
        }
      })
  )

  isLoadingDownstream.value = false

  if (!response) return

  if (!response.pods) return

  downstreamPods.value = response.pods
  showClearDialog.value = true
}

const handleConfirmClear = async (): Promise<void> => {
  const canvasId = getActiveCanvasIdOrWarn('CanvasPod')
  if (!canvasId) return

  isClearing.value = true

  const {wrapWebSocketRequest} = useWebSocketErrorHandler()

  const response = await wrapWebSocketRequest(
      createWebSocketRequest<WorkflowClearPayload, WorkflowClearResultPayload>({
        requestEvent: WebSocketRequestEvents.WORKFLOW_CLEAR,
        responseEvent: WebSocketResponseEvents.WORKFLOW_CLEAR_RESULT,
        payload: {
          canvasId,
          sourcePodId: props.pod.id
        }
      })
  )

  isClearing.value = false

  if (!response) return

  if (!response.clearedPodIds) return

  chatStore.clearMessagesByPodIds(response.clearedPodIds)
  podStore.clearPodOutputsByIds(response.clearedPodIds)

  const downstreamAiDecideConnectionIds: string[] = []
  response.clearedPodIds.forEach(podId => {
    const connections = connectionStore.getAiDecideConnectionsBySourcePodId(podId)
    downstreamAiDecideConnectionIds.push(...connections.map(connection => connection.id))
  })

  if (downstreamAiDecideConnectionIds.length > 0) {
    connectionStore.clearAiDecideStatusByConnectionIds(downstreamAiDecideConnectionIds)
  }

  showClearDialog.value = false
  downstreamPods.value = []
}

const handleCancelClear = (): void => {
  showClearDialog.value = false
  downstreamPods.value = []
}

const handleModelChange = async (model: ModelType): Promise<void> => {
  const canvasId = getActiveCanvasIdOrWarn('CanvasPod')
  if (!canvasId) return

  const {wrapWebSocketRequest} = useWebSocketErrorHandler()

  const response = await wrapWebSocketRequest(
      createWebSocketRequest<PodSetModelPayload, PodModelSetPayload>({
        requestEvent: WebSocketRequestEvents.POD_SET_MODEL,
        responseEvent: WebSocketResponseEvents.POD_MODEL_SET,
        payload: {
          canvasId,
          podId: props.pod.id,
          model
        }
      })
  )

  if (!response) return

  if (!response.pod) return

  podStore.updatePodModel(props.pod.id, response.pod.model ?? 'opus')
}

const handleToggleAutoClear = async (): Promise<void> => {
  await podStore.setAutoClearWithBackend(props.pod.id, !isAutoClearEnabled.value)
}

const handleClearScheduleFiredAnimation = (): void => {
  podStore.clearScheduleFiredAnimation(props.pod.id)
}

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault()
  emit('contextmenu', { podId: props.pod.id, event: e })
}
</script>

<template>
  <div
    class="absolute select-none"
    :style="{
      left: `${pod.x}px`,
      top: `${pod.y}px`,
      zIndex: isActive ? 100 : 10,
    }"
    @mousedown="handleMouseDown"
  >
    <div
      class="relative pod-with-notch pod-with-skill-notch pod-with-subagent-notch pod-with-model-notch pod-with-repository-notch pod-with-mcp-server-notch"
      :class="{ dragging: isDragging || isBatchDragging }"
      :style="{ '--pod-rotation': `${pod.rotation}deg` }"
    >
      <PodModelSelector
        :pod-id="pod.id"
        :current-model="currentModel"
        @update:model="handleModelChange"
      />

      <PodSlots
        :pod-id="pod.id"
        :pod-rotation="pod.rotation"
        :bound-output-style-note="boundNote"
        :bound-skill-notes="boundSkillNotes"
        :bound-sub-agent-notes="boundSubAgentNotes"
        :bound-repository-note="boundRepositoryNote"
        :bound-command-note="boundCommandNote"
        :bound-mcp-server-notes="boundMcpServerNotes"
        @output-style-dropped="(noteId) => handleNoteDrop('outputStyle', noteId)"
        @output-style-removed="() => handleNoteRemove('outputStyle')"
        @skill-dropped="(noteId) => handleNoteDrop('skill', noteId)"
        @subagent-dropped="(noteId) => handleNoteDrop('subAgent', noteId)"
        @repository-dropped="(noteId) => handleNoteDrop('repository', noteId)"
        @repository-removed="() => handleNoteRemove('repository')"
        @command-dropped="(noteId) => handleNoteDrop('command', noteId)"
        @command-removed="() => handleNoteRemove('command')"
        @mcp-server-dropped="(noteId) => handleNoteDrop('mcpServer', noteId)"
      />

      <div
        class="pod-doodle w-56 overflow-visible relative"
        :class="[podStatusClass, { selected: isSelected, dragging: isDragging || isBatchDragging }]"
        @dblclick="handleDblClick"
        @contextmenu="handleContextMenu"
      >
        <div class="model-notch" />
        <div class="subagent-notch" />
        <div class="mcp-server-notch" />
        <div class="repository-notch" />
        <div class="command-notch" />

        <PodAnchors
          :pod-id="pod.id"
          @drag-start="handleAnchorDragStart"
          @drag-move="handleAnchorDragMove"
          @drag-end="handleAnchorDragEnd"
        />

        <SlackStatusIcon :slack-binding="pod.slackBinding" />

        <div class="p-3">
          <PodHeader
            :name="pod.name"
            :is-editing="isEditing"
            @update:name="handleUpdateName"
            @save="handleSaveName"
            @rename="handleRename"
          />

          <PodMiniScreen
            :output="pod.output"
          />
        </div>
      </div>

      <PodActions
        :pod-id="pod.id"
        :pod-name="pod.name"
        :is-source-pod="isSourcePod"
        :show-schedule-button="showScheduleButton"
        :is-auto-clear-enabled="isAutoClearEnabled"
        :is-auto-clear-animating="isAutoClearAnimating"
        :is-loading-downstream="isLoadingDownstream"
        :is-clearing="isClearing"
        :downstream-pods="downstreamPods"
        :show-clear-dialog="showClearDialog"
        :show-delete-dialog="showDeleteDialog"
        :has-schedule="hasSchedule"
        :schedule-enabled="scheduleEnabled"
        :schedule-tooltip="scheduleTooltip"
        :is-schedule-fired-animating="isScheduleFiredAnimating"
        :is-workflow-running="isWorkflowRunning"
        @open-schedule-modal="handleOpenScheduleModal"
        @update:show-clear-dialog="showClearDialog = $event"
        @update:show-delete-dialog="showDeleteDialog = $event"
        @delete="handleDelete"
        @clear-workflow="handleClearWorkflow"
        @toggle-auto-clear="handleToggleAutoClear"
        @confirm-clear="handleConfirmClear"
        @cancel-clear="handleCancelClear"
        @confirm-delete="handleDelete"
        @cancel-delete="showDeleteDialog = false"
        @clear-schedule-fired-animation="handleClearScheduleFiredAnimation"
      />

      <ScheduleModal
        v-model:open="showScheduleModal"
        :pod-id="pod.id"
        :existing-schedule="pod.schedule"
        @confirm="handleScheduleConfirm"
        @delete="handleScheduleDelete"
        @toggle="handleScheduleToggle"
      />
    </div>
  </div>
</template>
