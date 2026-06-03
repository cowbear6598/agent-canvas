<script setup lang="ts">
import type { ConnectionBaseMode } from "@/types/connection";
import type { FunctionalComponent } from "vue";

interface Props {
  mode: ConnectionBaseMode;
  currentMode: ConnectionBaseMode;
  icon: FunctionalComponent;
  label: string;
}

defineProps<Props>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    :class="[
      'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
      {
        'bg-secondary border-l-2 border-l-primary': currentMode === mode,
      },
    ]"
    @click="$emit('click')"
  >
    <component
      :is="icon"
      :size="14"
      :class="currentMode === mode ? 'text-primary' : 'text-foreground'"
    />
    <span
      :class="[
        'font-mono',
        currentMode === mode ? 'text-primary font-semibold' : 'text-foreground',
      ]"
    >
      {{ label }}
    </span>
  </button>
</template>
