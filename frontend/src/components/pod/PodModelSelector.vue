<script setup lang="ts">
import { ref, computed } from "vue";
import type { PodProvider } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

const props = defineProps<{
  podId: string;
  currentModel: string;
  provider: PodProvider;
}>();

const emit = defineEmits<{
  "update:model": [model: string];
}>();

const HOVER_DEBOUNCE_MS = 150;
const COLLAPSE_ANIMATION_MS = 300;
const SELECT_FEEDBACK_DELAY_MS = 400;

const isHovered = ref(false);
const isAnimating = ref(false);
const isCollapsing = ref(false);
const hoverTimeoutId = ref<number | null>(null);

const providerCapabilityStore = useProviderCapabilityStore();

/** 依 provider 動態決定可選模型清單 */
const allOptions = computed(() => {
  if (props.provider === "codex") {
    // 從 store 動態讀取 Codex 預設 model；若 metadata 尚未載入則顯示 "—" 作為 placeholder
    const codexDefaultModel =
      (providerCapabilityStore.getDefaultOptions("codex")?.["model"] as
        | string
        | undefined) ?? "";
    const displayValue = codexDefaultModel || "—";
    // TODO: 待後端 metadata 擴充 availableModels 後，改為從 store 動態拿可切換 model 清單
    return [{ label: "GPT 5.4", value: displayValue }];
  }
  // claude（預設）
  // TODO: 待後端 metadata 擴充 availableModels 後，改為從 store 動態拿可切換 model 清單
  return [
    { label: "Opus", value: "opus" },
    { label: "Sonnet", value: "sonnet" },
    { label: "Haiku", value: "haiku" },
  ];
});

/** Codex 只有單一選項，不需展開 */
const isSingleOption = computed(() => allOptions.value.length === 1);

const sortedOptions = computed(() => {
  const active = allOptions.value.find((o) => o.value === props.currentModel);
  const others = allOptions.value.filter((o) => o.value !== props.currentModel);
  return active ? [active, ...others] : allOptions.value;
});

const handleMouseEnter = (): void => {
  // 單一選項仍允許展開動畫，但不允許切換
  if (isAnimating.value) return;

  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
  isHovered.value = true;
};

const handleMouseLeave = (): void => {
  if (isAnimating.value) return;

  hoverTimeoutId.value = window.setTimeout(() => {
    isHovered.value = false;
    hoverTimeoutId.value = null;
  }, HOVER_DEBOUNCE_MS);
};

const selectModel = (model: string): void => {
  // 單一選項時點擊不做任何事
  if (isSingleOption.value) return;
  if (isAnimating.value || isCollapsing.value) return;

  if (model === props.currentModel) {
    isCollapsing.value = true;
    setTimeout(() => {
      isHovered.value = false;
      isCollapsing.value = false;
    }, COLLAPSE_ANIMATION_MS);
    return;
  }

  isAnimating.value = true;

  emit("update:model", model);

  setTimeout(() => {
    isCollapsing.value = true;

    setTimeout(() => {
      isHovered.value = false;
      isCollapsing.value = false;
      isAnimating.value = false;
    }, COLLAPSE_ANIMATION_MS);
  }, SELECT_FEEDBACK_DELAY_MS);
};
</script>

<template>
  <div class="pod-model-slot" @mouseleave="handleMouseLeave">
    <TransitionGroup
      name="card-swap"
      tag="div"
      class="model-cards-container"
      :class="{ expanded: isHovered, collapsing: isCollapsing }"
    >
      <button
        v-for="option in sortedOptions"
        :key="option.value"
        class="model-card"
        :class="{
          active: option.value === currentModel,
          'card-single': isSingleOption,
          'card-opus': option.value === 'opus',
          'card-sonnet': option.value === 'sonnet',
          'card-haiku': option.value === 'haiku',
          'card-codex': provider === 'codex',
        }"
        @mouseenter="option.value === currentModel && handleMouseEnter()"
        @click.stop="selectModel(option.value)"
      >
        {{ option.label }}
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.pod-model-slot {
  position: absolute;
  bottom: 100%;
  left: 12px;
  margin-bottom: -12px;
  z-index: -1;
}

.model-cards-container {
  display: inline-flex;
  /* 底部對齊：高度不同的卡片以底部為錨點，避免高度變化時卡片位置亂跳 */
  align-items: flex-end;
  gap: 6px;
  transition: transform 0.3s ease;
  position: relative;
  z-index: 1;
  transform: translateY(20px);
}

.model-cards-container.expanded {
  transform: translateY(-12px);
}

.model-card {
  /* 固定窄寬度，垂直文字排列 */
  width: 24px;
  /* min-height 保底高度，height: max-content 讓字數多的 card 自然撐高 */
  min-height: 70px;
  height: max-content;
  padding: 8px 4px;
  border: 2px solid var(--doodle-ink);
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  color: oklch(0.3 0.02 50);
  box-shadow: 2px 2px 0 oklch(0.4 0.02 50 / 0.3);
  cursor: pointer;
  opacity: 0;
  transition: all 0.3s ease;
  white-space: nowrap;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 垂直文字：字符直立排列，字數越多 card 越高 */
  writing-mode: vertical-lr;
  text-orientation: upright;
  letter-spacing: -2px;
  pointer-events: none;
}

.model-card.active {
  opacity: 1;
  pointer-events: auto;
}

.model-cards-container.expanded .model-card {
  opacity: 1;
  pointer-events: auto;
}

.model-cards-container.collapsing .model-card:not(.active) {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.model-card:hover {
  box-shadow: 3px 3px 0 oklch(0.4 0.02 50 / 0.4);
}

/* 單一選項：cursor 提示無法切換，但仍允許 hover 事件觸發展開動畫 */
.model-card.card-single {
  cursor: default;
}

.card-opus {
  background: var(--doodle-yellow);
}

.card-sonnet {
  background: var(--doodle-light-blue);
}

.card-haiku {
  background: oklch(0.85 0.1 150);
}

/* Codex 使用中性灰色背景；字間距微調，讓垂直文字較整齊 */
.card-codex {
  background: oklch(0.9 0.005 240);
  letter-spacing: -1px;
}
</style>
