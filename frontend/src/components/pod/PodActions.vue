<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue'
import { Eraser, Trash2, Timer } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const props = withDefaults(defineProps<{
  podId: string
  podName: string
  isSourcePod: boolean
  showScheduleButton: boolean
  isAutoClearEnabled: boolean
  isAutoClearAnimating: boolean
  isLoadingDownstream: boolean
  isClearing: boolean
  isWorkflowRunning?: boolean
  downstreamPods: Array<{ id: string; name: string }>
  showClearDialog: boolean
  showDeleteDialog: boolean
  hasSchedule: boolean
  scheduleEnabled: boolean
  scheduleTooltip: string
  isScheduleFiredAnimating?: boolean
}>(), {
  isScheduleFiredAnimating: false,
  isWorkflowRunning: false,
})

const emit = defineEmits<{
  'delete': []
  'clear-workflow': []
  'toggle-auto-clear': []
  'update:show-clear-dialog': [value: boolean]
  'update:show-delete-dialog': [value: boolean]
  'confirm-clear': []
  'cancel-clear': []
  'confirm-delete': []
  'cancel-delete': []
  'open-schedule-modal': []
  'clear-schedule-fired-animation': []
}>()

const chatStore = useChatStore()

const TOGGLE_DEBOUNCE_GUARD_MS = 5000

const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isLongPress = ref(false)
const isToggling = ref(false)
const LONG_PRESS_DURATION = 500

const isLongPressing = ref(false)
const longPressProgress = ref(0)
const mousePosition = ref({ x: 0, y: 0 })
let progressAnimationFrame: number | null = null
let longPressStartTime: number | null = null
let autoClearAnimationTimer: ReturnType<typeof setTimeout> | null = null

const isEraserDisabled = computed(() =>
  props.isLoadingDownstream || props.isClearing || isToggling.value || props.isWorkflowRunning
)

const cleanupLongPress = (): void => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
  isLongPressing.value = false
  longPressProgress.value = 0
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame)
    progressAnimationFrame = null
  }
}

const handleEraserMouseDown = (e: MouseEvent): void => {
  e.stopPropagation()
  isLongPress.value = false
  isLongPressing.value = true
  longPressProgress.value = 0
  longPressStartTime = performance.now()

  mousePosition.value = { x: e.clientX, y: e.clientY }

  const updateProgress = (): void => {
    if (!longPressStartTime || !isLongPressing.value) return

    const elapsed = performance.now() - longPressStartTime
    longPressProgress.value = Math.min(elapsed / LONG_PRESS_DURATION, 1)

    if (longPressProgress.value < 1) {
      progressAnimationFrame = requestAnimationFrame(updateProgress)
    }
  }
  progressAnimationFrame = requestAnimationFrame(updateProgress)

  longPressTimer.value = setTimeout(() => {
    isLongPress.value = true
    isLongPressing.value = false
    longPressProgress.value = 0
    isToggling.value = true
    emit('toggle-auto-clear')
    setTimeout(() => {
      isToggling.value = false
    }, TOGGLE_DEBOUNCE_GUARD_MS)
  }, LONG_PRESS_DURATION)
}

const handleEraserMouseUp = (): void => {
  cleanupLongPress()
  if (!isLongPress.value) {
    emit('clear-workflow')
  }
}

const handleEraserMouseLeave = (): void => {
  cleanupLongPress()
}

const handleDelete = (): void => {
  emit('update:show-delete-dialog', true)
}

const confirmDelete = (): void => {
  emit('confirm-delete')
}

const cancelDelete = (): void => {
  emit('cancel-delete')
}

const confirmClear = (): void => {
  emit('confirm-clear')
}

const cancelClear = (): void => {
  emit('cancel-clear')
}

let scheduleFiredAnimationTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  cleanupLongPress()
  if (scheduleFiredAnimationTimer) {
    clearTimeout(scheduleFiredAnimationTimer)
    scheduleFiredAnimationTimer = null
  }
  if (autoClearAnimationTimer) {
    clearTimeout(autoClearAnimationTimer)
    autoClearAnimationTimer = null
  }
})

watch(() => props.isAutoClearEnabled, () => {
  isToggling.value = false
})

watch(() => props.isAutoClearAnimating, (newValue) => {
  if (newValue) {
    autoClearAnimationTimer = setTimeout(() => {
      chatStore.clearAutoClearAnimation()
      autoClearAnimationTimer = null
    }, 600)
  }
})

watch(() => props.isScheduleFiredAnimating, (newValue) => {
  if (newValue) {
    if (scheduleFiredAnimationTimer) {
      clearTimeout(scheduleFiredAnimationTimer)
    }
    scheduleFiredAnimationTimer = setTimeout(() => {
      emit('clear-schedule-fired-animation')
    }, 1800)
  }
})
</script>

<template>
  <div
    v-if="isSourcePod"
    class="pod-action-buttons-group"
  >
    <button
      v-if="showScheduleButton"
      class="pod-action-button-base schedule-button"
      :class="{ 'schedule-enabled': scheduleEnabled, 'schedule-fired-animating': isScheduleFiredAnimating }"
      :title="hasSchedule ? scheduleTooltip : undefined"
      @click.stop="$emit('open-schedule-modal')"
    >
      <Timer :size="16" />
    </button>
    <button
      class="pod-action-button-base pod-delete-button"
      @click.stop="handleDelete"
    >
      <Trash2 :size="16" />
    </button>
    <button
      class="pod-action-button-base workflow-clear-button-in-group"
      :class="{
        'auto-clear-enabled': isAutoClearEnabled,
        'auto-clear-animating': isAutoClearAnimating
      }"
      :disabled="isEraserDisabled"
      @mousedown="handleEraserMouseDown"
      @mouseup="handleEraserMouseUp"
      @mouseleave="handleEraserMouseLeave"
    >
      <Eraser :size="16" />
      <span
        v-show="isAutoClearEnabled"
        class="auto-clear-badge"
      >A</span>
    </button>
  </div>

  <div
    v-else
    class="pod-action-buttons-group"
  >
    <button
      v-if="showScheduleButton"
      class="pod-action-button-base schedule-button"
      :class="{ 'schedule-enabled': scheduleEnabled, 'schedule-fired-animating': isScheduleFiredAnimating }"
      :title="hasSchedule ? scheduleTooltip : undefined"
      @click.stop="$emit('open-schedule-modal')"
    >
      <Timer :size="16" />
    </button>
    <button
      class="pod-action-button-base pod-delete-button"
      @click.stop="handleDelete"
    >
      <Trash2 :size="16" />
    </button>
  </div>

  <Dialog
    :open="showClearDialog"
    @update:open="(val) => emit('update:show-clear-dialog', val)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>清理 Workflow</DialogTitle>
        <DialogDescription>
          即將清空以下 POD 的所有訊息：
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <ul class="space-y-2">
          <li
            v-for="pod in downstreamPods"
            :key="pod.id"
            class="text-sm font-mono text-foreground"
          >
            • {{ pod.name }}
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isClearing"
          @click="cancelClear"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          :disabled="isClearing"
          @click="confirmClear"
        >
          {{ isClearing ? '清理中...' : '確認清理' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="showDeleteDialog"
    @update:open="(val) => emit('update:show-delete-dialog', val)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>刪除 Pod</DialogTitle>
        <DialogDescription>
          確定要刪除「{{ podName }}」嗎？此操作無法復原。
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button
          variant="outline"
          @click="cancelDelete"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          @click="confirmDelete"
        >
          確認刪除
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Teleport to="body">
    <div
      v-if="isLongPressing"
      class="long-press-indicator"
      :style="{
        left: mousePosition.x + 'px',
        top: mousePosition.y + 'px'
      }"
    >
      <svg
        class="long-press-ring"
        width="52"
        height="52"
        viewBox="0 0 52 52"
      >
        <circle
          cx="26"
          cy="26"
          r="20"
          fill="none"
          stroke="var(--card)"
          stroke-width="8"
        />
        <circle
          cx="26"
          cy="26"
          r="24"
          fill="none"
          stroke="var(--doodle-ink)"
          stroke-width="2"
        />
        <circle
          cx="26"
          cy="26"
          r="16"
          fill="none"
          stroke="var(--doodle-ink)"
          stroke-width="2"
        />
        <circle
          cx="26"
          cy="26"
          r="20"
          fill="none"
          stroke="var(--doodle-blue)"
          stroke-width="6"
          stroke-linecap="round"
          :stroke-dasharray="125.66"
          :stroke-dashoffset="125.66 * (1 - longPressProgress)"
          transform="rotate(-90 26 26)"
        />
      </svg>
    </div>
  </Teleport>
</template>
