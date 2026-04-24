<script setup lang="ts">
import { computed } from "vue";
import { getProvider } from "@/integration/providerRegistry";

const props = defineProps<{
  provider: string;
}>();

const config = computed(() => getProvider(props.provider));
</script>

<template>
  <div class="p-4 border-t-2 border-doodle-ink">
    <div
      class="border-2 border-dashed border-doodle-ink rounded-lg"
      :data-testid="`${provider}-blocked-hint`"
    >
      <div class="flex items-center justify-center gap-2 py-4">
        <component
          :is="config.icon"
          :size="16"
        />
        <p class="text-sm font-mono text-muted-foreground">
          {{ $t("chat.integrationBlockedHint", { label: config.label }) }}
        </p>
      </div>
    </div>
  </div>
</template>
