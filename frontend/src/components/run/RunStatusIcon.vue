<script setup lang="ts">
import { computed } from "vue";
import {
  Brain,
  CheckCircle,
  Clock,
  FileText,
  Hand,
  ListOrdered,
  Loader2,
  SkipForward,
  Timer,
  XCircle,
} from "lucide-vue-next";
import type { RunStatus, RunPodStatus } from "@/types/run";

type Status = RunStatus | RunPodStatus;

const ICON_CONFIG = {
  completed: { component: CheckCircle, class: "text-doodle-green" },
  running: { component: Loader2, class: "animate-spin text-doodle-blue" },
  pending: { component: Clock, class: "text-muted-foreground" },
  error: { component: XCircle, class: "text-destructive" },
  blocked: { component: Hand, class: "text-amber-600" },
  skipped: { component: SkipForward, class: "text-amber-500" },
  summarizing: {
    component: FileText,
    class: "animate-pulse text-doodle-orange",
  },
  deciding: { component: Brain, class: "animate-pulse text-violet-500" },
  queued: { component: ListOrdered, class: "text-muted-foreground" },
  waiting: { component: Timer, class: "animate-pulse text-doodle-blue" },
} satisfies Record<Status, { component: unknown; class: string }>;

const props = defineProps<{ status: Status }>();
const iconConfig = computed(() => ICON_CONFIG[props.status]);
</script>

<template>
  <component
    :is="iconConfig.component"
    :size="16"
    :class="iconConfig.class"
  />
</template>
