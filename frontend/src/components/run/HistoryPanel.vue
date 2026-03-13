<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { useRunStore } from '@/stores/run/runStore'
import RunCard from './RunCard.vue'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const runStore = useRunStore()
const sidebarRef = ref<HTMLElement | undefined>(undefined)

const handleClose = (): void => {
  emit('update:open', false)
}

const handleOpenPodChat = (runId: string, podId: string, _podName: string): void => {
  runStore.openRunChatModal(runId, podId)
}

const handleClickOutside = (event: MouseEvent): void => {
  const target = event.target

  if (!(target instanceof Node)) {
    return
  }

  if (sidebarRef.value?.contains(target)) {
    return
  }

  const historyToggleButton = document.querySelector('[data-history-toggle]')
  if (historyToggleButton?.contains(target)) {
    return
  }

  handleClose()
}

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault()
    handleClose()
  }
}

const removeDocumentListeners = (): void => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    })
  } else {
    removeDocumentListeners()
  }
})

onUnmounted(() => {
  removeDocumentListeners()
})
</script>

<template>
  <Transition name="sidebar">
    <div
      v-if="open"
      ref="sidebarRef"
      class="fixed right-0 z-40 flex h-[calc(100vh-64px)] w-80 flex-col border-l border-border bg-background"
      style="top: 64px"
    >
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold">
            歷程
          </h2>
          <span
            v-if="runStore.runningRunsCount > 0"
            class="text-xs bg-doodle-blue text-white rounded-full px-2 py-0.5"
          >
            {{ runStore.runningRunsCount }}
          </span>
        </div>
        <button
          class="rounded-md p-1 hover:bg-accent"
          @click="handleClose"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <div
          v-if="runStore.sortedRuns.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          尚無執行歷程
        </div>
        <RunCard
          v-for="run in runStore.sortedRuns"
          :key="run.id"
          :run="run"
          :is-expanded="runStore.expandedRunIds.has(run.id)"
          @toggle-expand="runStore.toggleRunExpanded(run.id)"
          @delete="runStore.deleteRun(run.id)"
          @open-pod-chat="handleOpenPodChat"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition: transform 0.2s ease-out;
}

.sidebar-enter-from {
  transform: translateX(100%);
}

.sidebar-leave-to {
  transform: translateX(100%);
}
</style>
