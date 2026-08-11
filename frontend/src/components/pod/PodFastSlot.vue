<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  podRotation: number;
  enabled: boolean;
  disabled: boolean;
  disabledTooltip?: string;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const { t } = useI18n();
const buttonStyle = computed(() => ({
  transform: `rotate(${-props.podRotation}deg)`,
}));
</script>

<template>
  <div class="pod-fast-notch-area">
    <button
      class="pod-fast-slot"
      :class="{ 'pod-fast-slot--enabled': enabled }"
      :style="buttonStyle"
      :disabled="disabled"
      :aria-label="t('pod.slot.fastLabel')"
      :aria-pressed="enabled"
      :title="disabled ? disabledTooltip : t('pod.slot.fastToggleTooltip')"
      @click="(event) => emit('click', event)"
    >
      <span
        class="fast-charge-fill"
        aria-hidden="true"
      />
      <svg
        class="fast-icon"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2 4.5 13h7L11 22l8.5-11h-7L13 2Z" />
      </svg>
      <svg
        v-if="disabled"
        class="fast-disabled-overlay"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
        />
        <line
          x1="4.93"
          y1="4.93"
          x2="19.07"
          y2="19.07"
        />
      </svg>
    </button>
  </div>
</template>
