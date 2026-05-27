<script setup lang="ts">
import { ref, computed } from "vue";
import { ChevronRight } from "lucide-vue-next";
import type { PodProvider } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

interface Props {
  provider?: PodProvider;
  model?: string;
  currentLevel?: string | null;
  label: string;
  onUpdate: (level: string | null) => Promise<unknown>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
}>();

const providerCapabilityStore = useProviderCapabilityStore();
const isMenuOpen = ref(false);

const levels = computed(() => {
  if (!props.provider || !props.model) return [];
  return providerCapabilityStore.getSupportedThinkingLevels(
    props.provider,
    props.model,
  );
});

const hasThinkingLevels = computed(() => levels.value.length > 0);

const defaultLevel = computed(() => {
  if (!props.provider || !props.model) return null;
  return (
    providerCapabilityStore.getDefaultThinkingLevel(
      props.provider,
      props.model,
    ) ?? null
  );
});

const activeLevel = computed(() => props.currentLevel ?? defaultLevel.value);

const getLevelLabel = (level: string): string => {
  if (!props.provider || !props.model) return level;
  return (
    providerCapabilityStore.getThinkingLevelLabel(
      props.provider,
      props.model,
      level,
    ) ?? level
  );
};

const isActive = (level: string): boolean => activeLevel.value === level;

const handleSetLevel = async (level: string): Promise<void> => {
  if (props.currentLevel === level) {
    emit("close");
    return;
  }

  const result = await props.onUpdate(level);
  if (result) {
    emit("close");
  }
};
</script>

<template>
  <div
    v-if="hasThinkingLevels"
    class="relative"
    @mouseenter="isMenuOpen = true"
    @mouseleave="isMenuOpen = false"
  >
    <button
      class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      :class="{ 'bg-secondary': isMenuOpen }"
    >
      <span class="font-mono text-foreground">{{ label }}</span>
      <ChevronRight
        :size="12"
        class="text-muted-foreground"
      />
    </button>

    <div
      v-if="isMenuOpen"
      class="absolute left-full top-0 pl-1 z-50"
      @mouseenter="isMenuOpen = true"
      @mouseleave="isMenuOpen = false"
    >
      <div
        class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
      >
        <button
          v-for="level in levels"
          :key="level"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary': isActive(level),
            },
          ]"
          @click="handleSetLevel(level)"
        >
          <span
            :class="[
              'font-mono',
              isActive(level)
                ? 'text-primary font-semibold'
                : 'text-foreground',
            ]"
          >
            {{ getLevelLabel(level) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
