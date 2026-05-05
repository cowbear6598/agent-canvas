<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useChatStore } from '@/stores/chat'

const JITTER_REFRESH_INTERVAL_MS = 100
const TURN_OFF_ANIMATION_DURATION_MS = 500
const TURN_ON_ANIMATION_DURATION_MS = 600

const chatStore = useChatStore()
const showOverlay = ref(false)
const isTurningOn = ref(false)
const isTurningOff = ref(false)
let turnOnTimer: ReturnType<typeof setTimeout> | null = null
let turnOffTimer: ReturnType<typeof setTimeout> | null = null

const pathData1 = ref('')
const pathData2 = ref('')
const pathData3 = ref('')
let jitterInterval: ReturnType<typeof setInterval> | null = null

const shouldShowDisconnectOverlay = computed(
  () =>
    chatStore.connectionStatus === 'disconnected' &&
    !chatStore.isSilentReconnectInProgress
)

const generateJitterPath = (yOffset: number = 0): string => {
  const segments = 35
  const width = 1200
  const centerY = 30 + yOffset
  const amplitude = 15
  const segmentWidth = width / segments

  let path = `M0,${centerY}`

  for (let i = 1; i <= segments; i++) {
    const x = i * segmentWidth
    const randomOffset = (Math.random() - 0.5) * 2 * amplitude
    const y = centerY + randomOffset
    path += ` L${x},${y}`
  }

  return path
}

const refreshPaths = (): void => {
  pathData1.value = generateJitterPath(-0.5)
  pathData2.value = generateJitterPath(0)
  pathData3.value = generateJitterPath(0.8)
}

const startJitter = (): void => {
  refreshPaths()
  jitterInterval = setInterval(refreshPaths, JITTER_REFRESH_INTERVAL_MS)
}

const stopJitter = (): void => {
  if (jitterInterval) {
    clearInterval(jitterInterval)
    jitterInterval = null
  }
}

watch(shouldShowDisconnectOverlay, (shouldShow) => {
  if (shouldShow && !showOverlay.value) {
    showOverlay.value = true
    isTurningOff.value = true
    startJitter()

    turnOffTimer = setTimeout(() => {
      isTurningOff.value = false
    }, TURN_OFF_ANIMATION_DURATION_MS)
  } else if (!shouldShow && showOverlay.value) {
    isTurningOn.value = true
    stopJitter()
    turnOnTimer = setTimeout(() => {
      showOverlay.value = false
      isTurningOn.value = false
    }, TURN_ON_ANIMATION_DURATION_MS)
  }
}, { immediate: true })

onUnmounted(() => {
  if (turnOnTimer) clearTimeout(turnOnTimer)
  if (turnOffTimer) clearTimeout(turnOffTimer)
  stopJitter()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showOverlay"
      class="disconnect-overlay"
      :class="{ 'tv-turn-on': isTurningOn, 'tv-turn-off': isTurningOff }"
    >
      <div class="disconnect-overlay-line">
        <svg
          viewBox="0 0 1200 60"
          preserveAspectRatio="none"
          class="disconnect-overlay-svg"
        >
          <path
            :d="pathData1"
            class="disconnect-line-layer-1"
          />
          <path
            :d="pathData2"
            class="disconnect-line-layer-2"
          />
          <path
            :d="pathData3"
            class="disconnect-line-layer-3"
          />
        </svg>
      </div>
    </div>
  </Teleport>
</template>
