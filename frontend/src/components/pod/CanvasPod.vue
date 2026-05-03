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
import type {
  PodSetModelPayload,
  PodModelSetPayload,
  PodSetThinkingLevelPayload,
  PodThinkingLevelSetPayload,
} from "@/types/websocket";
import { useSendCanvasAction } from "@/composables/useSendCanvasAction";
import { usePodDrag } from "@/composables/pod/usePodDrag";
import { usePodNoteBinding } from "@/composables/pod/usePodNoteBinding";
import { useWorkflowClear } from "@/composables/pod/useWorkflowClear";
import { usePodSchedule } from "@/composables/pod/usePodSchedule";
import { usePodAnchorDrag } from "@/composables/pod/usePodAnchorDrag";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";
import { usePodPopovers } from "@/composables/pod/usePodPopovers";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import {
  isMultiInstanceChainPod,
  isMultiInstanceSourcePod,
} from "@/utils/multiInstanceGuard";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useRunStore } from "@/stores/run/runStore";
import { useUploadStore } from "@/stores/upload/uploadStore";
import PodHeader from "@/components/pod/PodHeader.vue";
import PodUploadOverlay from "@/components/pod/PodUploadOverlay.vue";
import PodMiniScreen from "@/components/pod/PodMiniScreen.vue";
import PodSlots from "@/components/pod/PodSlots.vue";
import PodAnchors from "@/components/pod/PodAnchors.vue";
import PodActions from "@/components/pod/PodActions.vue";
import PodModelSelector from "@/components/pod/PodModelSelector.vue";
import IntegrationStatusIcon from "@/components/integration/IntegrationStatusIcon.vue";
import ScheduleModal from "@/components/canvas/ScheduleModal.vue";
import PluginPopover from "@/components/pod/PluginPopover.vue";
import McpPopover from "@/components/pod/McpPopover.vue";
import ThinkingPopover from "@/components/pod/ThinkingPopover.vue";

const props = defineProps<{
  pod: Pod;
}>();

const {
  podStore,
  viewportStore,
  selectionStore,
  repositoryStore,
  commandStore,
  connectionStore,
  chatStore,
} = useCanvasContext();
const runStore = useRunStore();
const uploadStore = useUploadStore();
const { startBatchDrag, isElementSelected, isBatchDragging } = useBatchDrag();
const { toast } = useToast();
const { sendCanvasAction } = useSendCanvasAction();
const { t } = useI18n();

// ---- Provider 未知 fallback 判斷 ----
const providerCapabilityStore = useProviderCapabilityStore();

/**
 * 當 store 已載入（loaded = true）且 provider 不在已知清單中，
 * 視為未知 provider，顯示 fallback UI 並封鎖對話入口。
 * loaded 為 false 時（metadata 尚未抵達）跳過判斷，避免時序誤判。
 */
const isUnknownProvider = computed(
  () =>
    providerCapabilityStore.loaded &&
    !providerCapabilityStore.isKnownProvider(props.pod.provider),
);

const isActive = computed(() => props.pod.id === podStore.activePodId);
const boundRepositoryNote = computed(
  () => repositoryStore.getNotesByPodId(props.pod.id)[0],
);
const boundCommandNote = computed(
  () => commandStore.getNotesByPodId(props.pod.id)[0],
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
// 此為靜態常數（不依賴 store），刻意定義在 script setup 頂層而非 computed 內，
// 確保每次渲染不重新建立 Set，也方便日後新增 status 時集中維護。
const ALLOWED_STATUSES = new Set<string>([
  "idle",
  "chatting",
  "summarizing",
  "error",
]);

const podStatusClasses = computed(() => {
  const status = props.pod.status;
  return status && ALLOWED_STATUSES.has(status) ? `pod-status-${status}` : "";
});

// 依 provider 動態套用漸層 class，方便未來擴增更多 provider
const podProviderClasses = computed(() =>
  providerCapabilityStore.allowedProviders.has(props.pod.provider)
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

const isMultiInstanceEnabled = computed(() => props.pod.multiInstance);
const isDownstreamMultiInstance = computed(
  () =>
    isMultiInstanceChainPod(props.pod.id) &&
    !isMultiInstanceSourcePod(props.pod.id),
);

const isWorkflowRunning = computed(() =>
  connectionStore.isWorkflowRunning(props.pod.id),
);

const computedPodId = toRef(() => props.pod.id);

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
  commandStore,
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

// Plugin notch 相關狀態
const pluginActiveCount = computed(() => props.pod.pluginIds?.length ?? 0);

// error 狀態仍允許切換 plugin，故不含 'error'
const isPodBusy = computed(
  () => props.pod.status === "chatting" || props.pod.status === "summarizing",
);

/**
 * 以下任一為真時禁用 file drop：
 * - pod 正在 chatting / summarizing（busy）
 * - 為 multi-instance chain 下游 pod（target），使用者已決策由來源觸發
 * - 未知 provider，封鎖所有對話入口
 */
const isFileDropDisabled = computed(
  () =>
    isPodBusy.value ||
    isDownstreamMultiInstance.value ||
    isUnknownProvider.value,
);

const {
  isDragOver,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDropEvent,
} = usePodFileDrop({
  disabled: () => isFileDropDisabled.value,
});

/**
 * 包裝 handleDropEvent，綁定當前 pod.id。
 * 模板中 `@drop` 只傳 DragEvent，podId 由此閉包注入。
 * 上傳流程結束後，若為 multi-instance source pod 則自動開啟 history panel。
 */
const handleDrop = async (event: DragEvent): Promise<void> => {
  await handleDropEvent(event, props.pod.id);
  // multi-instance source pod 送出後自動開啟 history panel，
  // 行為與 ChatModal.handleMultiInstanceSend 一致
  if (isMultiInstanceSourcePod(props.pod.id)) {
    runStore.openHistoryPanel();
  }
};

const {
  showPluginPopover,
  pluginAnchorRect,
  handlePluginClick,
  showMcpPopover,
  mcpAnchorRect,
  handleMcpClick,
  showThinkingPopover,
  thinkingAnchorRect,
  handleThinkingClick,
} = usePodPopovers();

// MCP notch 相關狀態
const podMcpActiveCount = computed(() => props.pod.mcpServerNames?.length ?? 0);

// ---- 上傳狀態（來自 uploadStore，避免與 chatStore 狀態互相覆蓋）----
/**
 * 判斷此 Pod 是否正在上傳中（uploadStore.isUploading getter）。
 * 封鎖右鍵選單、連線把手、刪除按鈕等互動，但放行 Pod 拖移。
 */
const isPodUploading = computed(() => uploadStore.isUploading(props.pod.id));

/** 上傳狀態（uploading / upload-failed / idle），用於控制 overlay 渲染 */
const podUploadStatus = computed(
  () => uploadStore.getUploadState(props.pod.id).status,
);

// 合併成單一 CSS selector 字串，closest() 一次查詢取代原本最差 4 次 DOM 遍歷
const SLOT_CLASSES =
  ".pod-plugin-slot, .pod-repository-slot, .pod-command-slot, .pod-mcp-server-slot, .pod-model-slot";

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
 * 判斷雙擊是否被封鎖，並回傳封鎖原因。
 * blocked=false 表示可繼續進入對話；blocked=true 表示應終止。
 * reason 供 handleDblClick 決定是否顯示 toast。
 */
const isEditBlocked = (
  target: Element | null,
): {
  blocked: boolean;
  reason?: "dragging" | "input" | "unknownProvider" | "downstreamMultiInstance";
} => {
  if (isEditing.value || isDragging.value)
    return { blocked: true, reason: "dragging" };

  const el = target as HTMLElement;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
    return { blocked: true, reason: "input" };

  if (isUnknownProvider.value)
    return { blocked: true, reason: "unknownProvider" };
  if (isDownstreamMultiInstance.value)
    return { blocked: true, reason: "downstreamMultiInstance" };

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
  } else if (reason === "downstreamMultiInstance") {
    toast({
      title: "Pod",
      description: t("pod.multiInstance.readonlyHint"),
    });
  }
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

const handleThinkingLevelChange = async (level: string): Promise<void> => {
  const response = await sendCanvasAction<
    PodSetThinkingLevelPayload,
    PodThinkingLevelSetPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_SET_THINKING_LEVEL,
    responseEvent: WebSocketResponseEvents.POD_THINKING_LEVEL_SET,
    payload: { podId: props.pod.id, level },
  });

  if (!response) return;
  if (!response.pod) return;

  podStore.updatePodThinkingLevel(
    props.pod.id,
    response.pod.providerConfig.thinkingLevel as string,
  );
};

const handleToggleMultiInstance = async (): Promise<void> => {
  await podStore.setMultiInstanceWithBackend(
    props.pod.id,
    !isMultiInstanceEnabled.value,
  );
};

const handleContextMenu = (e: MouseEvent): void => {
  // 上傳中封鎖右鍵選單，避免誤觸刪除或其他操作
  if (isPodUploading.value) {
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
    <div class="pod-glow-layer" :class="[podStatusClasses]" />

    <div
      class="relative pod-wrapper pod-with-plugin-notch pod-with-mcp-notch pod-with-mcp-server-notch pod-with-thinking-notch"
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
        :bound-repository-note="boundRepositoryNote"
        :bound-command-note="boundCommandNote"
        @plugin-clicked="handlePluginClick"
        @mcp-clicked="handleMcpClick"
        @thinking-clicked="handleThinkingClick"
        @repository-dropped="(noteId) => handleNoteDrop('repository', noteId)"
        @repository-removed="() => handleNoteRemove('repository')"
        @command-dropped="(noteId) => handleNoteDrop('command', noteId)"
        @command-removed="() => handleNoteRemove('command')"
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
        <div class="mcp-notch" />
        <div class="mcp-server-notch" />
        <div class="repository-notch" />
        <div class="command-notch" />

        <!-- 上傳中隱藏連線把手，避免誤建立連線；放行 Pod 拖移（標題列邏輯未動） -->
        <PodAnchors
          v-if="!isPodUploading"
          :pod-id="pod.id"
          @drag-start="handleAnchorDragStart"
          @drag-move="handleAnchorDragMove"
          @drag-end="handleAnchorDragEnd"
        />

        <IntegrationStatusIcon :bindings="pod.integrationBindings ?? []" />

        <!-- 聊天區容器：加 relative 使 PodUploadOverlay 的 absolute inset-0 可正確定位 -->
        <div class="p-3 relative">
          <PodHeader
            :name="pod.name"
            :is-editing="isEditing"
            @update:name="handleUpdateName"
            @save="handleSaveName"
            @rename="handleRename"
          />

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

          <PodMiniScreen :output="pod.output" />

          <!-- 上傳中 / 上傳失敗 overlay：
               absolute inset-0 蓋住聊天區（輸入區 + 訊息區），封鎖所有點擊。
               僅在 uploading 或 upload-failed 時渲染，idle 時不 mount，避免不必要的 re-render。
               overlay 自身內部已有 v-if 控制，外層再加 v-if 雙重保險。 -->
          <PodUploadOverlay
            v-if="isPodUploading || podUploadStatus === 'upload-failed'"
            :pod-id="pod.id"
          />
        </div>
      </div>

      <!-- is-uploading 傳入，讓刪除按鈕在上傳中 disabled + tooltip -->
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
        :is-uploading="isPodUploading"
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

      <PluginPopover
        v-if="showPluginPopover && pluginAnchorRect"
        :pod-id="pod.id"
        :anchor-rect="pluginAnchorRect"
        :busy="isPodBusy"
        :provider="pod.provider"
        @close="showPluginPopover = false"
      />

      <McpPopover
        v-if="showMcpPopover && mcpAnchorRect"
        :pod-id="pod.id"
        :anchor-rect="mcpAnchorRect"
        :busy="isPodBusy"
        :provider="pod.provider"
        @close="showMcpPopover = false"
      />

      <ThinkingPopover
        v-if="showThinkingPopover && thinkingAnchorRect"
        :pod-id="pod.id"
        :provider="pod.provider"
        :current-model="currentModel"
        :current-level="pod.providerConfig.thinkingLevel"
        :anchor-rect="thinkingAnchorRect"
        @select="handleThinkingLevelChange"
        @close="showThinkingPopover = false"
      />
    </div>
  </div>
</template>
