<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  podId: string;
  todoCount: number;
}>();

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const { t } = useI18n();

const hasTodos = computed(() => props.todoCount > 0);

const goalLabel = computed(() => {
  if (!hasTodos.value) return t("pod.goal.slot.unset");
  return `${t("pod.goal.slot.ready")} (${props.todoCount})`;
});

const handleClick = (event: MouseEvent): void => {
  emit("click", event);
};
</script>

<template>
  <div class="pod-notch-area-base pod-goal-notch-area">
    <button
      :class="['pod-slot-base', 'pod-goal-slot']"
      @click="handleClick"
    >
      <span class="text-xs font-mono">
        {{ goalLabel }}
      </span>
    </button>
  </div>
</template>
