<script setup lang="ts">
import { Download } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

defineProps<{ visible: boolean; busy?: boolean }>();
defineEmits<{ export: [] }>();
const { t } = useI18n();
</script>

<template>
  <div
    class="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-200"
    :class="visible ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0'"
    :aria-hidden="!visible"
  >
    <div class="pointer-events-auto flex items-center rounded-xl border-2 border-doodle-ink bg-card p-1.5 shadow-lg">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary disabled:cursor-wait disabled:opacity-50"
        :disabled="busy"
        :title="t('podPack.export.action')"
        :aria-label="t('podPack.export.action')"
        @click="$emit('export')"
      >
        <Download :size="18" />
      </button>
    </div>
  </div>
</template>
