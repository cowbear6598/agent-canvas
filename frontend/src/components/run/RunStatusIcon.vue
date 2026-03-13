<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle, Loader2, Clock, XCircle, SkipForward, FileText } from 'lucide-vue-next'
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
    case 'skipped':
      return { component: SkipForward, class: 'text-muted-foreground' }
    case 'summarizing':
      return { component: FileText, class: 'animate-pulse text-doodle-orange' }
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
