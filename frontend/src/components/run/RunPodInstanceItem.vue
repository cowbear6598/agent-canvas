<script setup lang="ts">
import { truncateMessage, formatRelativeTime } from '@/utils/runFormatUtils'
import { RUN_RESPONSE_SUMMARY_LENGTH } from '@/lib/constants'
import RunStatusIcon from './RunStatusIcon.vue'
import type { RunPodInstance } from '@/types/run'

defineProps<{
  instance: RunPodInstance
  runId: string
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <div
    class="flex items-start gap-2 hover:bg-accent rounded-md p-2 cursor-pointer"
    @click="emit('click')"
  >
    <div class="mt-0.5 shrink-0">
      <RunStatusIcon :status="instance.status" />
    </div>
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-sm truncate">
        {{ instance.podName }}
      </p>
      <p
        v-if="instance.lastResponseSummary"
        class="text-xs text-muted-foreground mt-0.5"
      >
        {{ truncateMessage(instance.lastResponseSummary, RUN_RESPONSE_SUMMARY_LENGTH) }}
      </p>
    </div>
    <span class="text-xs text-muted-foreground shrink-0 mt-0.5">
      {{ formatRelativeTime(instance.triggeredAt ?? instance.completedAt ?? '') }}
    </span>
  </div>
</template>
