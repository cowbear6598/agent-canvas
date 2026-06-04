<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle, Loader2, Clock, XCircle, SkipForward, FileText, Brain, ListOrdered, Timer, Hand } from 'lucide-vue-next'
import type { RunStatus, RunPodStatus } from '@/types/run'

const props = defineProps<{
  status: RunStatus | RunPodStatus
}>()

const iconConfig = computed(() => {
  switch (props.status) {
    case 'completed':
      return { component: CheckCircle, class: 'text-doodle-green' }
    case 'running':
      return { component: Loader2, class: 'animate-spin text-doodle-blue' }
    case 'pending':
      return { component: Clock, class: 'text-muted-foreground' }
    case 'error':
      return { component: XCircle, class: 'text-destructive' }
    case 'blocked':
      return { component: Hand, class: 'text-amber-600' }
    case 'skipped':
      return { component: SkipForward, class: 'text-amber-500' }
    case 'summarizing':
      return { component: FileText, class: 'animate-pulse text-doodle-orange' }
    case 'deciding':
      return { component: Brain, class: 'animate-pulse text-violet-500' }
    case 'queued':
      return { component: ListOrdered, class: 'text-muted-foreground' }
    case 'waiting':
      return { component: Timer, class: 'animate-pulse text-doodle-blue' }
    default:
      return { component: Clock, class: 'text-muted-foreground' }
  }
})
</script>

<template>
  <component
    :is="iconConfig.component"
    :size="16"
    :class="iconConfig.class"
  />
</template>
