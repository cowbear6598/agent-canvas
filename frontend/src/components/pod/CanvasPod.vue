<script setup lang="ts">
import { ref, computed, toRef } from "vue";
import type { Pod } from "@/types";
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
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";
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
const currentModel = computed(() => props.pod.providerConfig.model);

// isElementSelected 內部使用 selectedElementSet（Set<string>），O(1) 查找
const isSelected = computed(() =>
  selectionStore.isElementSelected("pod", props.pod.id),
);

// PodStatus 白名單（對應 types/pod.ts 的 PodStatus union）；
// 未知 status 不注入任意 class，回傳空字串。
const ALLOWED_STATUSES = ["idle", "chatting", "summarizing", "error"] as const;

const podStatusClass = computed(() => {
  const status = props.pod.status;
  return status && (ALLOWED_STATUSES as readonly string[]).includes(status)
    ? `pod-status-${status}`
    : "";
});

// 允許的 provider 列表（與 PodProvider type 保持同步）；
// 未知 provider 不注入任意 class，回傳空字串。
const ALLOWED_PROVIDERS = ["claude", "codex"] as const;

// 依 provider 動態套用漸層 class，方便未來擴增第三個 provider
const podProviderClass = computed(() =>
  (ALLOWED_PROVIDERS as readonly string[]).includes(props.pod.provider)
    ? `pod-provider-${props.pod.provider}`
    : "",
);

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

// toRef(() => ...) 的 getter 形式（Vue 3.3+）更語義化：此為「對 prop 的引用」非「衍生計算值」
const computedPodId = toRef(() => props.pod.id);

// 取得此 Pod 的 capability，用於守門不支援的功能入口
const { isRunModeEnabled } = usePodCapabilities(computedPodId);

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

// 合併成單一 CSS selector 字串，closest() 一次查詢取代原本最差 6 次 DOM 遍歷
const SLOT_CLASSES =
  ".pod-output-style-slot, .pod-skill-slot, .pod-subagent-slot, .pod-repository-slot, .pod-command-slot, .pod-mcp-server-slot";

const shouldBlockForSlot = (target: HTMLElement): boolean => {
  return target.closest(SLOT_CLASSES) !== null;
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

/**
 * 守門：判斷雙擊事件是否允許進入編輯/選取流程
 * 回傳 true 表示可以繼續，false 表示應終止（含副作用如 toast）
 */
const canActivateEdit = (target: Element | null): boolean => {
  if (isEditing.value || isDragging.value) return false;

  const el = target as HTMLElement;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return false;

  if (isDownstreamMultiInstance.value) {
    toast({
      title: "Pod",
      description: t("pod.multiInstance.readonlyHint"),
    });
    return false;
  }

  return true;
};

const handleDblClick = (e: MouseEvent): void => {
  if (!canActivateEdit(e.target as Element | null)) return;
  handleSelectPod();
};

const handleModelChange = async (model: string): Promise<void> => {
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

  podStore.updatePodProviderConfigModel(
    props.pod.id,
    response.pod.providerConfig.model,
  );
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
    <!-- 光暈層：放在 pod-with-notch 之外，不受 transform: rotate 影響 -->
    <!-- position: absolute; inset: 0 讓此層與外層 wrapper 等大（即 pod-doodle 等大） -->
    <div
      class="pod-glow-layer"
      :class="[podStatusClass, { 'pod-glow-selected': isSelected }]"
    />

    <div
      class="relative pod-with-notch pod-with-skill-notch pod-with-subagent-notch pod-with-mcp-server-notch"
      :class="{ dragging: isDragging || isBatchDragging }"
      :style="{ '--pod-rotation': `${pod.rotation}deg` }"
    >
      <PodModelSelector
        :pod-id="pod.id"
        :provider="pod.provider"
        :current-model="currentModel"
        @update:model="handleModelChange"
      />

      <!-- PodSlots 介面採扁平 props/emit 設計；新增 slot 類型需同步更新 PodSlots props/emits/template 與此處 listener -->
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
          podProviderClass,
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
        :is-run-mode-enabled="isRunModeEnabled"
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
