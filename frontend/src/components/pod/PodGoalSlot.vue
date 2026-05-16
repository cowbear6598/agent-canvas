<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PodGoalStatus } from "@/types";

const props = defineProps<{
  podId: string;
  goalStatus: PodGoalStatus | undefined;
  todoCount: number;
  disabled: boolean;
  disabledTooltip: string;
}>();

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const { t } = useI18n();

const isReady = computed(() => props.goalStatus === "ready");

const goalLabel = computed(() => {
  if (!isReady.value) return t("pod.goal.slot.unset");
  return `${t("pod.goal.slot.ready")} (${props.todoCount})`;
});

const handleClick = (event: MouseEvent): void => {
  if (props.disabled) return;
  emit("click", event);
};
</script>

<template>
  <div class="pod-notch-area-base pod-goal-notch-area">
    <button
      :class="[
        'pod-slot-base',
        'pod-goal-slot',
        isReady ? 'pod-goal-slot--ready' : 'pod-goal-slot--unset',
        { 'opacity-50 cursor-not-allowed': disabled },
      ]"
      :title="disabled ? disabledTooltip : undefined"
      @click="handleClick"
    >
      <span class="text-xs font-mono">
        {{ goalLabel }}
      </span>
    </button>
  </div>
</template>
