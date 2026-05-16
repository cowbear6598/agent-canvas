<script setup lang="ts">
import { onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Trash2, Timer } from "lucide-vue-next";
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
    podName: string;
    showScheduleButton: boolean;
    showDeleteDialog: boolean;
    hasSchedule: boolean;
    scheduleEnabled: boolean;
    scheduleTooltip: string;
    isScheduleFiredAnimating?: boolean;
    /** 上傳中時為 true,刪除按鈕應 disabled */
    isUploading?: boolean;
  }>(),
  {
    isScheduleFiredAnimating: false,
    isUploading: false,
  },
);

const emit = defineEmits<{
  delete: [];
  "update:show-delete-dialog": [value: boolean];
  "confirm-delete": [];
  "cancel-delete": [];
  "open-schedule-modal": [];
  "clear-schedule-fired-animation": [];
}>();

const { t } = useI18n();

const SCHEDULE_FIRED_ANIMATION_DURATION_MS = 1800;

const handleDelete = (): void => {
  emit("update:show-delete-dialog", true);
};

const confirmDelete = (): void => {
  emit("confirm-delete");
};

const cancelDelete = (): void => {
  emit("cancel-delete");
};

let scheduleFiredAnimationTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  if (scheduleFiredAnimationTimer) {
    clearTimeout(scheduleFiredAnimationTimer);
    scheduleFiredAnimationTimer = null;
  }
});

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
    <!-- 上傳中禁用刪除:disabled 封鎖點擊,title 提供原生 tooltip 說明 -->
    <button
      class="pod-action-button-base pod-delete-button"
      :disabled="isUploading"
      :title="
        isUploading ? t('pod.upload.cannotDeleteWhileUploading') : undefined
      "
      @click.stop="handleDelete"
    >
      <Trash2 :size="16" />
    </button>
  </div>

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
        <Button
          variant="outline"
          @click="cancelDelete"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="confirmDelete"
        >
          {{ $t("pod.delete.confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
