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

const mcpLabel = computed(
  () => `${t("pod.slot.mcpLabel")} (${props.activeCount})`,
);

const buttonStyle = computed(() => ({
  transform: `rotate(${-props.podRotation}deg)`,
}));
</script>

<template>
  <div class="pod-mcp-notch-area">
    <button
      :class="['pod-mcp-slot', activeCount > 0 ? 'pod-mcp-slot--active' : '']"
      :style="buttonStyle"
      @click="handleClick"
    >
      <span class="text-xs font-mono">
        {{ mcpLabel }}
      </span>
    </button>
  </div>
</template>
