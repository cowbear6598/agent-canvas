<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  podId: string;
  podRotation: number;
  activeCount: number;
}>();

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const { t } = useI18n();

const handleClick = (event: MouseEvent): void => {
  emit("click", event);
};

const pluginLabel = computed(
  () => `${t("pod.slot.pluginsLabel")} (${props.activeCount})`,
);
</script>

<template>
  <div class="pod-plugin-notch-area">
    <button
      :class="[
        'pod-plugin-slot',
        activeCount > 0 ? 'pod-plugin-slot--active' : '',
      ]"
      @click="handleClick"
    >
      <span class="text-xs font-mono">
        {{ pluginLabel }}
      </span>
    </button>
  </div>
</template>
