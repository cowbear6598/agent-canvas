<script setup lang="ts">
import { computed } from 'vue'

export interface ProgressTask {
  requestId: string
  title: string
  progress: number
  message: string
  status: 'processing' | 'completed' | 'failed'
  cancelLabel?: string
  onCancel?: () => void
}

interface Props {
  tasks: Map<string, ProgressTask>
}

const props = defineProps<Props>()

const tasksArray = computed(() => Array.from(props.tasks.values()))

const getProgressWidth = (task: ProgressTask): string => `${task.progress}%`

const getProgressBarColor = (task: ProgressTask): string => {
  if (task.status === 'failed') {
    return 'bg-destructive'
  }
  return 'bg-doodle-orange'
}
</script>

<template>
  <div
    v-if="tasksArray.length > 0"
    class="progress-note-panel"
  >
    <div
      v-for="task in tasksArray"
      :key="task.requestId"
      class="progress-note-card"
    >
      <p class="progress-note-title">
        {{ task.title }}
      </p>

      <div class="progress-note-bar-container">
        <div
          :class="getProgressBarColor(task)"
          class="progress-note-bar"
          :style="{ width: getProgressWidth(task) }"
        />
      </div>

      <p class="progress-note-message">
        {{ task.message }}
      </p>
      <button
        v-if="task.onCancel"
        type="button"
        class="progress-note-cancel"
        @click="task.onCancel"
      >
        {{ task.cancelLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.progress-note-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.progress-note-card {
  background: var(--card);
  border: 2px solid var(--doodle-ink);
  border-radius: 6px;
  padding: 12px;
  min-width: 240px;
  box-shadow: 3px 3px 0 var(--doodle-ink);
  pointer-events: auto;
}

.progress-note-cancel {
  margin-top: 8px;
  font-size: 12px;
  color: var(--destructive);
  text-decoration: underline;
}

.progress-note-title {
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 14px;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 8px;
}

.progress-note-bar-container {
  height: 8px;
  background: var(--secondary);
  border: 1px solid var(--doodle-ink);
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 4px;
}

.progress-note-bar {
  height: 100%;
  transition: width 0.3s ease;
}

.progress-note-message {
  font-size: 12px;
  color: var(--muted-foreground);
}
</style>
