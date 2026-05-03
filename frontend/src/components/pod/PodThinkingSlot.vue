<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { PodProvider } from "@/types/pod";

const { t } = useI18n();

const props = defineProps<{
  podId: string;
  podRotation: number;
  /** 當前 thinking level；undefined 表示 model 不支援或尚未指定 */
  currentLevel: string | undefined;
  currentModel: string;
  provider: PodProvider;
  /** 僅 capability gate：當前 model 完全不支援 thinking 才為 true。 */
  capabilityDisabled: boolean;
  disabledTooltip: string;
}>();

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
}>();

const providerCapabilityStore = useProviderCapabilityStore();

const handleClick = (event: MouseEvent): void => {
  if (props.capabilityDisabled) return;
  emit("click", event);
};

/**
 * 卡片水位填充比例（0~1）：currentLevel 在該 model 支援清單中的位置（1-indexed）/ 總長。
 * 例：model 支援 [low, medium, high]，currentLevel=medium 為第 2 階 → 2/3；
 * currentLevel=high → 3/3 = 1.0（永遠填滿到頂）。
 * 不支援或未設定為 0（不填）。
 */
const fillRatio = computed((): number => {
  if (!props.currentLevel) return 0;
  const levels = providerCapabilityStore.getSupportedThinkingLevels(
    props.provider,
    props.currentModel,
  );
  if (levels.length === 0) return 0;
  const idx = levels.indexOf(props.currentLevel);
  if (idx < 0) return 0;
  return (idx + 1) / levels.length;
});

/** 透過 CSS 變數讓子元素（水體 height、波浪 bottom）共用單一來源；
 *  CSS 端對 height / bottom 設 transition，level 切換時自動 lerp。 */
const buttonStyle = computed(() => ({
  transform: `rotate(${-props.podRotation}deg)`,
  "--thinking-fill-pct": `${fillRatio.value * 100}%`,
}));
</script>

<template>
  <div class="pod-thinking-notch-area">
    <button
      :class="['pod-thinking-slot', `pod-thinking-slot--${provider}`]"
      :style="buttonStyle"
      :aria-label="t('pod.slot.thinkingLabel')"
      :aria-disabled="capabilityDisabled || undefined"
      :title="capabilityDisabled ? disabledTooltip : undefined"
      @click="handleClick"
    >
      <div class="thinking-water" aria-hidden="true" />
      <div
        v-if="fillRatio > 0 && fillRatio < 1"
        class="thinking-wave"
        aria-hidden="true"
      />
      <svg
        class="thinking-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"
        />
        <path
          d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"
        />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
      </svg>
      <svg
        v-if="capabilityDisabled"
        class="thinking-disabled-overlay"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    </button>
  </div>
</template>
