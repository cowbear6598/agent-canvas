<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { truncateMessage, formatRelativeTime } from '@/utils/runFormatUtils'
import { RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH } from '@/lib/constants'
import RunStatusIcon from './RunStatusIcon.vue'
import RunPodInstanceItem from './RunPodInstanceItem.vue'
import type { WorkflowRun } from '@/types/run'

defineProps<{
  run: WorkflowRun
  isExpanded: boolean
}>()

const emit = defineEmits<{
  'toggle-expand': []
  delete: []
  'open-pod-chat': [runId: string, podId: string, podName: string]
}>()
</script>

<template>
  <div
    class="border-2 border-border rounded-lg p-3 mb-2 cursor-pointer"
    @click="emit('toggle-expand')"
  >
    <div class="flex items-center justify-between">
      <span class="text-sm font-semibold">{{ run.sourcePodName }}</span>
      <RunStatusIcon :status="run.status" />
    </div>

    <p class="text-xs text-muted-foreground truncate mt-1">
      {{ truncateMessage(run.triggerMessage, RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH) }}
    </p>

    <div class="flex items-center justify-between mt-2">
      <span class="text-xs text-muted-foreground">{{ formatRelativeTime(run.createdAt) }}</span>
      <button
        class="rounded-md p-1 hover:bg-destructive/20"
        @click.stop="emit('delete')"
      >
        <Trash2 :size="14" />
      </button>
    </div>

    <div
      v-if="isExpanded"
      class="border-t border-border mt-2 pt-2"
    >
      <div class="space-y-1">
        <RunPodInstanceItem
          v-for="instance in run.podInstances"
          :key="instance.id"
          :instance="instance"
          :run-id="run.id"
          @click="emit('open-pod-chat', run.id, instance.podId, instance.podName)"
        />
      </div>
    </div>
  </div>
</template>
