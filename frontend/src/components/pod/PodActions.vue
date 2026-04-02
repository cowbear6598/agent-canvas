<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import { Eraser, Trash2, Timer } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const props = withDefaults(
  defineProps<{
    podId: string;
    podName: string;
    isSourcePod: boolean;
    showScheduleButton: boolean;
    isMultiInstanceEnabled: boolean;
    isLoadingDownstream: boolean;
    isClearing: boolean;
    isWorkflowRunning?: boolean;
    downstreamPods: Array<{ id: string; name: string }>;
    showClearDialog: boolean;
    showDeleteDialog: boolean;
    hasSchedule: boolean;
    scheduleEnabled: boolean;
    scheduleTooltip: string;
    isScheduleFiredAnimating?: boolean;
  }>(),
  {
    isScheduleFiredAnimating: false,
    isWorkflowRunning: false,
  },
);

const emit = defineEmits<{
  delete: [];
  "clear-workflow": [];
  "toggle-multi-instance": [];
  "update:show-clear-dialog": [value: boolean];
  "update:show-delete-dialog": [value: boolean];
  "confirm-clear": [];
  "cancel-clear": [];
  "confirm-delete": [];
  "cancel-delete": [];
  "open-schedule-modal": [];
  "clear-schedule-fired-animation": [];
}>();

const SCHEDULE_FIRED_ANIMATION_DURATION_MS = 1800;
const TOGGLE_DEBOUNCE_GUARD_MS = 5000;

const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
let isLongPress = false;
const isToggling = ref(false);
const LONG_PRESS_DURATION_MS = 500;

const isLongPressing = ref(false);
const longPressProgress = ref(0);
const mousePosition = ref({ x: 0, y: 0 });
let progressAnimationFrame: number | null = null;
let longPressStartTime: number | null = null;

const isEraserDisabled = computed(
  () =>
    props.isLoadingDownstream ||
    props.isClearing ||
    isToggling.value ||
    props.isWorkflowRunning,
);

const cleanupLongPress = (): void => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
  isLongPressing.value = false;
  longPressProgress.value = 0;
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = null;
  }
};

const handleEraserMouseDown = (event: MouseEvent): void => {
  event.stopPropagation();
  isLongPress = false;
  isLongPressing.value = true;
  longPressProgress.value = 0;
  longPressStartTime = performance.now();

  mousePosition.value = { x: event.clientX, y: event.clientY };

  const updateProgress = (): void => {
    if (!longPressStartTime || !isLongPressing.value) return;

    const elapsed = performance.now() - longPressStartTime;
    longPressProgress.value = Math.min(elapsed / LONG_PRESS_DURATION_MS, 1);

    if (longPressProgress.value < 1) {
      progressAnimationFrame = requestAnimationFrame(updateProgress);
    }
  };
  progressAnimationFrame = requestAnimationFrame(updateProgress);

  longPressTimer.value = setTimeout(() => {
    isLongPress = true;
    isLongPressing.value = false;
    longPressProgress.value = 0;
    isToggling.value = true;
    emit("toggle-multi-instance");
    setTimeout(() => {
      isToggling.value = false;
    }, TOGGLE_DEBOUNCE_GUARD_MS);
  }, LONG_PRESS_DURATION_MS);
};

const handleEraserMouseUp = (): void => {
  cleanupLongPress();
  if (!isLongPress) {
    emit("clear-workflow");
  }
};

const handleEraserMouseLeave = (): void => {
  cleanupLongPress();
};

const handleDelete = (): void => {
  emit("update:show-delete-dialog", true);
};

const confirmDelete = (): void => {
  emit("confirm-delete");
};

const cancelDelete = (): void => {
  emit("cancel-delete");
};

const confirmClear = (): void => {
  emit("confirm-clear");
};

const cancelClear = (): void => {
  emit("cancel-clear");
};

let scheduleFiredAnimationTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  cleanupLongPress();
  if (scheduleFiredAnimationTimer) {
    clearTimeout(scheduleFiredAnimationTimer);
    scheduleFiredAnimationTimer = null;
  }
});

watch(
  () => props.isMultiInstanceEnabled,
  () => {
    isToggling.value = false;
  },
);

watch(
  () => props.isScheduleFiredAnimating,
  (newValue) => {
    if (newValue) {
      if (scheduleFiredAnimationTimer) {
        clearTimeout(scheduleFiredAnimationTimer);
      }
      scheduleFiredAnimationTimer = setTimeout(() => {
        emit("clear-schedule-fired-animation");
      }, SCHEDULE_FIRED_ANIMATION_DURATION_MS);
    }
  },
);
</script>

<template>
  <div class="pod-action-buttons-group">
    <button
      v-if="showScheduleButton"
      class="pod-action-button-base schedule-button"
      :class="{
        'schedule-enabled': scheduleEnabled,
        'schedule-fired-animating': isScheduleFiredAnimating,
      }"
      :title="hasSchedule ? scheduleTooltip : undefined"
      @click.stop="$emit('open-schedule-modal')"
    >
      <Timer :size="16" />
    </button>
    <button
      class="pod-action-button-base pod-delete-button"
      @click.stop="handleDelete"
    >
      <Trash2 :size="16" />
    </button>
    <button
      v-if="isSourcePod"
      class="pod-action-button-base workflow-clear-button-in-group"
      :class="{ 'multi-instance-enabled': isMultiInstanceEnabled }"
      :disabled="isEraserDisabled"
      @mousedown="handleEraserMouseDown"
      @mouseup="handleEraserMouseUp"
      @mouseleave="handleEraserMouseLeave"
    >
      <span v-if="isMultiInstanceEnabled" class="multi-instance-icon-m">M</span>
      <Eraser v-else :size="16" />
    </button>
  </div>

  <Dialog
    :open="showClearDialog"
    @update:open="(val) => emit('update:show-clear-dialog', val)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("pod.clearWorkflow.title") }}</DialogTitle>
        <DialogDescription>{{
          $t("pod.clearWorkflow.description")
        }}</DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <ul class="space-y-2">
          <li
            v-for="pod in downstreamPods"
            :key="pod.id"
            class="text-sm font-mono text-foreground"
          >
            • {{ pod.name }}
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isClearing" @click="cancelClear">
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          :disabled="isClearing"
          @click="confirmClear"
        >
          {{
            isClearing
              ? $t("pod.clearWorkflow.clearing")
              : $t("pod.clearWorkflow.confirm")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="showDeleteDialog"
    @update:open="(val) => emit('update:show-delete-dialog', val)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("pod.delete.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("pod.delete.description", { name: podName }) }}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button variant="outline" @click="cancelDelete">{{
          $t("common.cancel")
        }}</Button>
        <Button variant="destructive" @click="confirmDelete">{{
          $t("pod.delete.confirm")
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Teleport to="body">
    <div
      v-if="isLongPressing"
      class="long-press-indicator"
      :style="{
        left: mousePosition.x + 'px',
        top: mousePosition.y + 'px',
      }"
    >
      <svg class="long-press-ring" width="52" height="52" viewBox="0 0 52 52">
        <circle
          cx="26"
          cy="26"
          r="20"
          fill="none"
          stroke="var(--card)"
          stroke-width="8"
        />
        <circle
          cx="26"
          cy="26"
          r="24"
          fill="none"
          stroke="var(--doodle-ink)"
          stroke-width="2"
        />
        <circle
          cx="26"
          cy="26"
          r="16"
          fill="none"
          stroke="var(--doodle-ink)"
          stroke-width="2"
        />
        <circle
          cx="26"
          cy="26"
          r="20"
          fill="none"
          stroke="var(--doodle-blue)"
          stroke-width="6"
          stroke-linecap="round"
          :stroke-dasharray="125.66"
          :stroke-dashoffset="125.66 * (1 - longPressProgress)"
          transform="rotate(-90 26 26)"
        />
      </svg>
    </div>
  </Teleport>
</template>
