<script setup lang="ts">
import { ref, computed } from "vue";
import type { Pod, ModelType } from "@/types";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useBatchDrag } from "@/composables/canvas";
import { isCtrlOrCmdPressed } from "@/utils/keyboardHelpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type { PodSetModelPayload, PodModelSetPayload } from "@/types/websocket";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";
import { usePodDrag } from "@/composables/pod/usePodDrag";
import { usePodNoteBinding } from "@/composables/pod/usePodNoteBinding";
import { useWorkflowClear } from "@/composables/pod/useWorkflowClear";
import { usePodSchedule } from "@/composables/pod/usePodSchedule";
import { usePodAnchorDrag } from "@/composables/pod/usePodAnchorDrag";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import {
  isMultiInstanceChainPod,
  isMultiInstanceSourcePod,
} from "@/utils/multiInstanceGuard";
import PodHeader from "@/components/pod/PodHeader.vue";
import PodMiniScreen from "@/components/pod/PodMiniScreen.vue";
import PodSlots from "@/components/pod/PodSlots.vue";
import PodAnchors from "@/components/pod/PodAnchors.vue";
import PodActions from "@/components/pod/PodActions.vue";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import IntegrationStatusIcon from "@/components/integration/IntegrationStatusIcon.vue";
import ScheduleModal from "@/components/canvas/ScheduleModal.vue";

const props = defineProps<{
  pod: Pod;
}>();

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
} = useCanvasContext();
const { startBatchDrag, isElementSelected, isBatchDragging } = useBatchDrag();
const { toast } = useToast();
const { sendCanvasAction } = useSendCanvasAction();
const { t } = useI18n();

const isActive = computed(() => props.pod.id === podStore.activePodId);
const boundNote = computed(
  () => outputStyleStore.getNotesByPodId(props.pod.id)[0],
);
const boundSkillNotes = computed(() =>
  skillStore.getNotesByPodId(props.pod.id),
);
const boundSubAgentNotes = computed(() =>
  subAgentStore.getNotesByPodId(props.pod.id),
);
const boundRepositoryNote = computed(
  () => repositoryStore.getNotesByPodId(props.pod.id)[0],
);
const boundCommandNote = computed(
  () => commandStore.getNotesByPodId(props.pod.id)[0],
);
const boundMcpServerNotes = computed(() =>
  mcpServerStore.getNotesByPodId(props.pod.id),
);
const isSourcePod = computed(() => connectionStore.isSourcePod(props.pod.id));
const hasUpstreamConnection = computed(() =>
  connectionStore.hasUpstreamConnections(props.pod.id),
);
const showScheduleButton = computed(
  () => isSourcePod.value || !hasUpstreamConnection.value,
);
const currentModel = computed(() => props.pod.model ?? "opus");

const isSelected = computed(() =>
  selectionStore.selectedPodIds.includes(props.pod.id),
);

const podStatusClass = computed(() => {
  return props.pod.status ? `pod-status-${props.pod.status}` : "";
});

const emit = defineEmits<{
  select: [podId: string];
  update: [pod: Pod];
  delete: [id: string];
  "drag-end": [data: { id: string; x: number; y: number }];
  "drag-complete": [data: { id: string }];
  contextmenu: [data: { podId: string; event: MouseEvent }];
}>();

const isEditing = ref(false);
const showDeleteDialog = ref(false);

const isMultiInstanceEnabled = computed(() => props.pod.multiInstance ?? false);
const isDownstreamMultiInstance = computed(
  () =>
    isMultiInstanceChainPod(props.pod.id) &&
    !isMultiInstanceSourcePod(props.pod.id),
);

const isWorkflowRunning = computed(() =>
  connectionStore.isWorkflowRunning(props.pod.id),
);

const computedPodId = computed(() => props.pod.id);

const {
  showScheduleModal,
  hasSchedule,
  scheduleEnabled,
  scheduleTooltip,
  isScheduleFiredAnimating,
  handleOpenScheduleModal,
  handleScheduleConfirm,
  handleScheduleDelete,
  handleScheduleToggle,
  handleClearScheduleFiredAnimation,
} = usePodSchedule(computedPodId, () => props.pod.schedule, { podStore });

const { handleAnchorDragStart, handleAnchorDragMove, handleAnchorDragEnd } =
  usePodAnchorDrag({ viewportStore, connectionStore, podStore });

const { isDragging, startSingleDrag } = usePodDrag(
  computedPodId,
  () => ({ x: props.pod.x, y: props.pod.y }),
  isElementSelected,
  emit,
  { viewportStore, selectionStore, podStore, connectionStore },
);

const { handleNoteDrop, handleNoteRemove } = usePodNoteBinding(computedPodId, {
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  podStore,
});

const {
  showClearDialog,
  downstreamPods,
  isLoadingDownstream,
  isClearing,
  handleClearWorkflow,
  handleConfirmClear,
  handleCancelClear,
} = useWorkflowClear(computedPodId, { chatStore, podStore, connectionStore });

const SLOT_CLASSES = [
  ".pod-output-style-slot",
  ".pod-skill-slot",
  ".pod-subagent-slot",
  ".pod-repository-slot",
  ".pod-command-slot",
  ".pod-mcp-server-slot",
];

const shouldBlockForSlot = (target: HTMLElement): boolean => {
  return SLOT_CLASSES.some((cls) => target.closest(cls) !== null);
};

const handleCtrlClick = (): void => {
  selectionStore.toggleElement({ type: "pod", id: props.pod.id });
  podStore.setActivePod(props.pod.id);
  connectionStore.selectConnection(null);
};

const handleCtrlOrModifierClick = (e: MouseEvent): boolean => {
  if (!isCtrlOrCmdPressed(e)) return false;
  handleCtrlClick();
  return true;
};

const handleMouseDown = (e: MouseEvent): void => {
  const target = e.target as HTMLElement;

  if (shouldBlockForSlot(target)) return;
  if (handleCtrlOrModifierClick(e)) return;
  if (isElementSelected("pod", props.pod.id) && startBatchDrag(e)) return;

  startSingleDrag(e);
};

const handleRename = (): void => {
  isEditing.value = true;
};

const handleUpdateName = (name: string): void => {
  emit("update", { ...props.pod, name });
};

const handleSaveName = (): void => {
  isEditing.value = false;
};

const handleDelete = (): void => {
  emit("delete", props.pod.id);
  showDeleteDialog.value = false;
};

const handleSelectPod = (): void => {
  podStore.setActivePod(props.pod.id);
  emit("select", props.pod.id);
};

const handleDblClick = (e: MouseEvent): void => {
  if (isEditing.value || isDragging.value) return;

  const target = e.target as HTMLElement;

  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

  if (isDownstreamMultiInstance.value) {
    toast({
      title: "Pod",
      description: t("pod.multiInstance.readonlyHint"),
    });
    return;
  }

  handleSelectPod();
};

const handleModelChange = async (model: ModelType): Promise<void> => {
  const response = await sendCanvasAction<
    PodSetModelPayload,
    PodModelSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_MODEL,
    responseEvent: WebSocketResponseEvents.POD_MODEL_SET,
    payload: { podId: props.pod.id, model },
  });

  if (!response) return;
  if (!response.pod) return;

  podStore.updatePodModel(props.pod.id, response.pod.model ?? "opus");
};

const handleToggleMultiInstance = async (): Promise<void> => {
  await podStore.setMultiInstanceWithBackend(
    props.pod.id,
    !isMultiInstanceEnabled.value,
  );
};

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault();
  emit("contextmenu", { podId: props.pod.id, event: e });
};
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
        @output-style-dropped="
          (noteId) => handleNoteDrop('outputStyle', noteId)
        "
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
        :class="[
          podStatusClass,
          { selected: isSelected, dragging: isDragging || isBatchDragging },
        ]"
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

        <IntegrationStatusIcon :bindings="pod.integrationBindings ?? []" />

        <div class="p-3">
          <PodHeader
            :name="pod.name"
            :is-editing="isEditing"
            @update:name="handleUpdateName"
            @save="handleSaveName"
            @rename="handleRename"
          />

          <PodMiniScreen :output="pod.output" />
        </div>
      </div>

      <PodActions
        :pod-id="pod.id"
        :pod-name="pod.name"
        :is-source-pod="isSourcePod"
        :show-schedule-button="showScheduleButton"
        :is-multi-instance-enabled="isMultiInstanceEnabled"
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
        @toggle-multi-instance="handleToggleMultiInstance"
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
