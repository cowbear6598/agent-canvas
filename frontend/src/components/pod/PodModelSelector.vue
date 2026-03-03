<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ModelType } from '@/types/pod'

const props = defineProps<{
  podId: string
  currentModel: ModelType
}>()

const emit = defineEmits<{
  'update:model': [model: ModelType]
}>()

const HOVER_DEBOUNCE_MS = 150
const COLLAPSE_ANIMATION_MS = 300
const SELECT_FEEDBACK_DELAY_MS = 400

const isHovered = ref(false)
const isAnimating = ref(false)
const isCollapsing = ref(false)
const hoverTimeoutId = ref<number | null>(null)

const allOptions = [
  { label: 'Opus', value: 'opus' as ModelType },
  { label: 'Sonnet', value: 'sonnet' as ModelType },
  { label: 'Haiku', value: 'haiku' as ModelType }
]

const sortedOptions = computed(() => {
  const active = allOptions.find(o => o.value === props.currentModel)
  const others = allOptions.filter(o => o.value !== props.currentModel)
  return active ? [active, ...others] : allOptions
})

const handleMouseEnter = (): void => {
  if (isAnimating.value) return

  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value)
    hoverTimeoutId.value = null
  }
  isHovered.value = true
}

const handleMouseLeave = (): void => {
  if (isAnimating.value) return

  hoverTimeoutId.value = window.setTimeout(() => {
    isHovered.value = false
    hoverTimeoutId.value = null
  }, HOVER_DEBOUNCE_MS)
}

const selectModel = (model: ModelType): void => {
  if (isAnimating.value || isCollapsing.value) return

  if (model === props.currentModel) {
    isCollapsing.value = true
    setTimeout(() => {
      isHovered.value = false
      isCollapsing.value = false
    }, COLLAPSE_ANIMATION_MS)
    return
  }

  isAnimating.value = true

  emit('update:model', model)

  setTimeout(() => {
    isCollapsing.value = true

    setTimeout(() => {
      isHovered.value = false
      isCollapsing.value = false
      isAnimating.value = false
    }, COLLAPSE_ANIMATION_MS)
  }, SELECT_FEEDBACK_DELAY_MS)
}
</script>

<template>
  <div
    class="pod-model-slot"
    @mouseleave="handleMouseLeave"
  >
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
          'card-opus': option.value === 'opus',
          'card-sonnet': option.value === 'sonnet',
          'card-haiku': option.value === 'haiku'
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
  width: 24px;
  height: 70px;
  padding: 6px 4px;
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

.card-opus {
  background: var(--doodle-yellow);
}

.card-sonnet {
  background: var(--doodle-light-blue);
}

.card-haiku {
  background: oklch(0.85 0.1 150);
}
</style>
