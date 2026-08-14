<script setup lang="ts">
import { ref, computed, toRef, watch } from "vue";
import type { Pod } from "@/types";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useBatchDrag } from "@/composables/canvas";
import { isCtrlOrCmdPressed } from "@/utils/keyboardHelpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type {
  PodSetModelPayload,
  PodModelSetPayload,
  PodSetThinkingLevelPayload,
  PodThinkingLevelSetPayload,
  PodSetFastModePayload,
  PodFastModeSetPayload,
} from "@/types/websocket";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";
import { usePodDrag } from "@/composables/pod/usePodDrag";
import { usePodNoteBinding } from "@/composables/pod/usePodNoteBinding";
import { usePodSchedule } from "@/composables/pod/usePodSchedule";
import { usePodAnchorDrag } from "@/composables/pod/usePodAnchorDrag";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";
import { usePodPopovers } from "@/composables/pod/usePodPopovers";
import { useCanvasPodState } from "@/composables/pod/useCanvasPodState";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useRunStore } from "@/stores/run/runStore";
import { useUploadStore } from "@/stores/upload/uploadStore";
import PodHeader from "@/components/pod/PodHeader.vue";
import PodUploadOverlay from "@/components/pod/PodUploadOverlay.vue";
import PodSlots from "@/components/pod/PodSlots.vue";
import PodAnchors from "@/components/pod/PodAnchors.vue";
import PodActions from "@/components/pod/PodActions.vue";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import IntegrationStatusIcon from "@/components/integration/IntegrationStatusIcon.vue";
import ScheduleModal from "@/components/canvas/ScheduleModal.vue";
import PluginPopover from "@/components/pod/PluginPopover.vue";
import McpPopover from "@/components/pod/McpPopover.vue";
import ThinkingPopover from "@/components/pod/ThinkingPopover.vue";
import { createPodDividerPath } from "@/lib/podDividerPath";

const props = defineProps<{
  pod: Pod;
  activeResourceMenuPodId?: string | null;
}>();

const {
  podStore,
  viewportStore,
  selectionStore,
  repositoryStore,
  connectionStore,
  canvasStore,
} = useCanvasContext();
const runStore = useRunStore();
const uploadStore = useUploadStore();
const { startBatchDrag, isElementSelected, isBatchDragging } = useBatchDrag();
const { toast } = useToast();
const { sendCanvasAction } = useSendCanvasAction();
const { t } = useI18n();

const providerCapabilityStore = useProviderCapabilityStore();

const isActive = computed(() => props.pod.id === podStore.activePodId);
const boundRepositoryNote = computed(
  () => repositoryStore.getNotesByPodId(props.pod.id)[0],
);
const currentModel = computed(() => props.pod.providerConfig.model);
const goalTodoCount = computed(() => props.pod.goal?.todos.length ?? 0);

const dividerPath = computed(() => createPodDividerPath(props.pod.id));

// ---- 上傳狀態（來自 uploadStore，避免與 chatStore 狀態互相覆蓋）----
/** 上傳中或等待重試時都應由 overlay 完整接管 Pod 互動。 */
const isPodUploadActive = computed(
  () => uploadStore.getUploadState(props.pod.id).status !== "idle",
);

// isElementSelected 內部使用 selectedElementSet（Set<string>），O(1) 查找
const isSelected = computed(() =>
  selectionStore.isElementSelected("pod", props.pod.id),
);

const emit = defineEmits<{
  select: [podId: string];
  update: [pod: Pod];
  delete: [id: string];
  "drag-end": [data: { id: string; x: number; y: number }];
  "drag-complete": [data: { id: string }];
  contextmenu: [data: { podId: string; event: MouseEvent }];
  "resource-menu-opened": [podId: string];
}>();

const isEditing = ref(false);
const showDeleteDialog = ref(false);

const computedPodId = toRef(() => props.pod.id);

const {
  isUnknownProvider,
  isDownstreamChainPod,
  showScheduleButton,
  podProviderClasses,
  isFileDropDisabled,
} = useCanvasPodState({
  pod: () => props.pod,
  providerCapabilityStore,
  connectionStore,
});

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
  repositoryStore,
  podStore,
});

// Plugin notch 相關狀態
const pluginActiveCount = computed(() => props.pod.pluginIds?.length ?? 0);

const {
  isDragOver,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDropEvent,
} = usePodFileDrop({
  disabled: () => isFileDropDisabled.value || isPodUploadActive.value,
  getCanvasId: () => canvasStore.activeCanvasId,
});

/**
 * 包裝 handleDropEvent，綁定當前 pod.id。
 * 模板中 `@drop` 只傳 DragEvent，podId 由此閉包注入。
 * 上傳流程結束後，source pod 送出後自動開啟 history panel。
 */
const handleDrop = async (event: DragEvent): Promise<void> => {
  await handleDropEvent(event, props.pod.id);
  if (connectionStore.isSourcePod(props.pod.id)) {
    runStore.openHistoryPanel();
  }
};

const {
  showPluginPopover,
  pluginAnchorRect,
  handlePluginClick,
  closePluginPopover,
  showMcpPopover,
  mcpAnchorRect,
  handleMcpClick,
  closeMcpPopover,
  showThinkingPopover,
  thinkingAnchorRect,
  handleThinkingClick,
  closeThinkingPopover,
  closeAllPopovers,
} = usePodPopovers(() => emit("resource-menu-opened", props.pod.id));

const hasOpenPopover = computed(
  () =>
    showPluginPopover.value ||
    showMcpPopover.value ||
    showThinkingPopover.value,
);

watch(
  [isDragging, isBatchDragging, isSelected],
  ([isSingleDragging, isBatchDragging, isSelected]) => {
    if (isSingleDragging || (isBatchDragging && isSelected)) {
      closeAllPopovers();
    }
  },
);

watch(
  () => props.activeResourceMenuPodId,
  (activeResourceMenuPodId) => {
    if (
      activeResourceMenuPodId !== null &&
      activeResourceMenuPodId !== undefined &&
      activeResourceMenuPodId !== props.pod.id
    ) {
      closeAllPopovers();
    }
  },
);

watch(
  () =>
    hasOpenPopover.value
      ? [viewportStore.offset.x, viewportStore.offset.y, viewportStore.zoom]
      : null,
  (viewportState, previousViewportState) => {
    if (viewportState === null || previousViewportState === null) return;
    closeAllPopovers();
  },
);

// MCP notch 相關狀態
const podMcpActiveCount = computed(
  () =>
    (props.pod.mcpServerNames?.length ?? 0) +
    (props.pod.agentCanvasMcpEnabled === true ? 1 : 0),
);

// 合併成單一 CSS selector 字串，closest() 一次查詢取代原本最差 4 次 DOM 遍歷
const SLOT_CLASSES =
  ".pod-plugin-slot, .pod-repository-slot, .pod-goal-slot, .pod-mcp-server-slot, .pod-model-slot, .pod-thinking-slot, .pod-fast-slot";

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

const handleGoalClick = (): void => {
  podStore.openGoalEditor(props.pod.id);
};

/**
 * 判斷雙擊是否被封鎖，並回傳封鎖原因。
 * blocked=false 表示可繼續進入對話；blocked=true 表示應終止。
 * reason 供 handleDblClick 決定是否顯示 toast。
 */
const isEditBlocked = (
  target: Element | null,
): {
  blocked: boolean;
  reason?: "dragging" | "input" | "unknownProvider" | "downstreamChainPod";
} => {
  if (isEditing.value || isDragging.value)
    return { blocked: true, reason: "dragging" };

  const el = target as HTMLElement;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
    return { blocked: true, reason: "input" };

  if (isUnknownProvider.value)
    return { blocked: true, reason: "unknownProvider" };
  if (isDownstreamChainPod.value)
    return { blocked: true, reason: "downstreamChainPod" };

  return { blocked: false };
};

const handleDblClick = (e: MouseEvent): void => {
  const { blocked, reason } = isEditBlocked(e.target as Element | null);
  if (!blocked) {
    handleSelectPod();
    return;
  }
  if (reason === "unknownProvider") {
    toast({
      title: t("pod.provider.title"),
      description: t("pod.provider.unknownDescription"),
    });
  } else if (reason === "downstreamChainPod") {
    toast({
      title: "Pod",
      description: t("pod.downstreamChainHint"),
    });
  }
};

const handleModelChange = async (model: string): Promise<void> => {
  const result = await sendCanvasAction<
    PodSetModelPayload,
    PodModelSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_MODEL,
    responseEvent: WebSocketResponseEvents.POD_MODEL_SET,
    payload: { podId: props.pod.id, model },
  });

  if (!result.success) return;
  const response = result.data;
  if (!response.pod) return;

  podStore.updatePod(response.pod);
};

const handleFastModeToggle = async (): Promise<void> => {
  const result = await sendCanvasAction<
    PodSetFastModePayload,
    PodFastModeSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_FAST_MODE,
    responseEvent: WebSocketResponseEvents.POD_FAST_MODE_SET,
    payload: {
      podId: props.pod.id,
      enabled: !props.pod.fastModeEnabled,
    },
  });

  if (!result.success || !result.data.pod) {
    toast({
      title: t("pod.slot.fastLabel"),
      description: t("pod.slot.fastToggleFailed"),
      variant: "destructive",
    });
    return;
  }

  podStore.updatePod(result.data.pod);
};

const handleThinkingLevelChange = async (level: string): Promise<void> => {
  const result = await sendCanvasAction<
    PodSetThinkingLevelPayload,
    PodThinkingLevelSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_THINKING_LEVEL,
    responseEvent: WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
    payload: { podId: props.pod.id, level },
  });

  if (!result.success) return;
  const response = result.data;
  if (!response.pod) return;

  podStore.updatePodThinkingLevel(
    props.pod.id,
    response.pod.providerConfig.thinkingLevel as string,
  );
};

const handleContextMenu = (e: MouseEvent): void => {
  // 上傳中封鎖右鍵選單，避免誤觸刪除或其他操作
  if (isPodUploadActive.value) {
    e.preventDefault();
    return;
  }
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
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 光暈層：放在 pod-wrapper 之外，不受 transform: rotate 影響 -->
    <!-- 此層僅承載 chatting/summarizing 等需要完整包覆（不被截切）的光暈效果 -->
    <!-- selected/drag-over 狀態已移至 pod-wrapper 內層（pod-inner-highlight），跟著旋轉 -->
    <div class="pod-glow-layer" />

    <div
      class="relative pod-wrapper pod-with-plugin-notch pod-with-mcp-notch pod-with-mcp-server-notch pod-with-thinking-notch pod-with-fast-notch"
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
        :plugin-active-count="pluginActiveCount"
        :mcp-active-count="podMcpActiveCount"
        :provider="pod.provider"
        :current-model="currentModel"
        :current-thinking-level="pod.providerConfig.thinkingLevel"
        :fast-mode-enabled="pod.fastModeEnabled === true"
        :bound-repository-note="boundRepositoryNote"
        :goal-todo-count="goalTodoCount"
        @plugin-clicked="handlePluginClick"
        @mcp-clicked="handleMcpClick"
        @thinking-clicked="handleThinkingClick"
        @fast-clicked="handleFastModeToggle"
        @goal-clicked="handleGoalClick"
        @repository-dropped="(noteId) => handleNoteDrop('repository', noteId)"
        @repository-removed="() => handleNoteRemove('repository')"
      />

      <div
        class="pod-doodle w-56 overflow-visible relative"
        :class="[
          podProviderClasses,
          { selected: isSelected, dragging: isDragging || isBatchDragging },
        ]"
        @dblclick="handleDblClick"
        @contextmenu="handleContextMenu"
      >
        <!-- 內層 highlight：selected/drag-over 狀態，隨 pod-wrapper 的 rotate 一起旋轉 -->
        <div
          class="pod-inner-highlight"
          :class="[
            { 'pod-glow-selected': isSelected },
            { 'pod-glow-drop-target': isDragOver },
          ]"
        />
        <div class="model-notch" />
        <div class="thinking-notch" />
        <div class="fast-notch" />
        <div class="mcp-notch" />
        <div class="mcp-server-notch" />
        <div class="repository-notch" />
        <div class="goal-notch" />

        <!-- 上傳流程中或失敗待重試時隱藏連線把手，避免誤建立連線。 -->
        <PodAnchors
          v-if="!isPodUploadActive"
          :pod-id="pod.id"
          @drag-start="handleAnchorDragStart"
          @drag-move="handleAnchorDragMove"
          @drag-end="handleAnchorDragEnd"
        />

        <IntegrationStatusIcon :bindings="pod.integrationBindings ?? []" />

        <!-- 聊天區容器：flex flex-col 禁用 child 之間的 margin collapse，讓 divider 與 button group
             的垂直間距精確等於設定值 -->
        <div class="p-3 flex flex-col">
          <PodHeader
            :name="pod.name"
            :is-editing="isEditing"
            @update:name="handleUpdateName"
            @save="handleSaveName"
            @rename="handleRename"
          />

          <!-- Doodle 分隔線：手繪 wavy SVG，分隔 header 與 body -->
          <svg
            class="pod-doodle-divider"
            preserveAspectRatio="none"
            viewBox="0 0 200 6"
            aria-hidden="true"
          >
            <path
              :d="dividerPath"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <!-- 未知 Provider fallback badge：
               store 已載入後仍找不到此 provider，表示已下線或尚未支援。
               僅插入提示 badge，保留下方 output 歷史可見，不遮蓋整個 Pod。 -->
          <div
            v-if="isUnknownProvider"
            class="unknown-provider-badge"
            data-testid="unknown-provider-badge"
          >
            <span class="unknown-provider-badge__dot" />
            <span class="unknown-provider-badge__text">
              {{ $t("pod.provider.unknownDescription") }}
            </span>
          </div>
        </div>

        <!-- 直接掛在 pod-doodle 下，absolute inset-0 才會覆蓋完整 Pod。 -->
        <PodUploadOverlay
          v-if="isPodUploadActive"
          :pod-id="pod.id"
        />

        <!-- PodActions 放在 pod-doodle 內部，讓 button-group 的 absolute 定位
             錨點為 pod-doodle 本體（min-height 102），避免被 pod-wrapper 的 slot
             子元素影響到參考座標；上傳流程由 overlay 接管時不渲染。 -->
        <PodActions
          v-if="!isPodUploadActive"
          :pod-name="pod.name"
          :show-schedule-button="showScheduleButton"
          :show-delete-dialog="showDeleteDialog"
          :has-pod-memory="pod.hasPodMemory ?? false"
          :has-schedule="hasSchedule"
          :schedule-enabled="scheduleEnabled"
          :schedule-tooltip="scheduleTooltip"
          :is-schedule-fired-animating="isScheduleFiredAnimating"
          @open-schedule-modal="handleOpenScheduleModal"
          @update:show-delete-dialog="showDeleteDialog = $event"
          @delete="handleDelete"
          @confirm-delete="handleDelete"
          @cancel-delete="showDeleteDialog = false"
          @clear-schedule-fired-animation="handleClearScheduleFiredAnimation"
        />
      </div>

      <ScheduleModal
        v-model:open="showScheduleModal"
        :pod-id="pod.id"
        :existing-schedule="pod.schedule"
        @confirm="handleScheduleConfirm"
        @delete="handleScheduleDelete"
        @toggle="handleScheduleToggle"
      />

      <PluginPopover
        v-if="showPluginPopover && pluginAnchorRect"
        :pod-id="pod.id"
        :anchor-rect="pluginAnchorRect"
        @close="closePluginPopover"
      />

      <McpPopover
        v-if="showMcpPopover && mcpAnchorRect"
        :pod-id="pod.id"
        :anchor-rect="mcpAnchorRect"
        :provider="pod.provider"
        @close="closeMcpPopover"
      />

      <ThinkingPopover
        v-if="showThinkingPopover && thinkingAnchorRect"
        :pod-id="pod.id"
        :provider="pod.provider"
        :current-model="currentModel"
        :current-level="pod.providerConfig.thinkingLevel"
        :anchor-rect="thinkingAnchorRect"
        @select="handleThinkingLevelChange"
        @close="closeThinkingPopover"
      />
    </div>
  </div>
</template>
