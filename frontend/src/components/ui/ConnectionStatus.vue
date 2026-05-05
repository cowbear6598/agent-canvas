<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const connectionStatus = computed(() =>
  chatStore.isSilentReconnectInProgress ? 'connecting' : chatStore.connectionStatus
)
const disconnectReason = computed(() => chatStore.getDisconnectReason)

const statusConfig = computed(() => {
  switch (connectionStatus.value) {
    case 'connected':
      return {
        color: 'bg-green-500',
        text: 'Connected',
        textColor: 'text-green-700',
        ringColor: 'ring-green-200'
      }
    case 'connecting':
      return {
        color: 'bg-yellow-500',
        text: 'Connecting...',
        textColor: 'text-yellow-700',
        ringColor: 'ring-yellow-200'
      }
    case 'disconnected': {
      const reasonText = disconnectReason.value ? ` (${disconnectReason.value})` : ''
      return {
        color: 'bg-gray-400',
        text: `Disconnected${reasonText}`,
        textColor: 'text-gray-600',
        ringColor: 'ring-gray-200'
      }
    }
    case 'error':
      return {
        color: 'bg-red-500',
        text: 'Error',
        textColor: 'text-red-700',
        ringColor: 'ring-red-200'
      }
    default:
      return {
        color: 'bg-gray-400',
        text: 'Unknown',
        textColor: 'text-gray-600',
        ringColor: 'ring-gray-200'
      }
  }
})

const tooltipText = computed(() => {
  if (connectionStatus.value === 'disconnected' && disconnectReason.value) {
    return `WebSocket status: ${statusConfig.value.text} - ${disconnectReason.value}`
  }
  return `WebSocket status: ${statusConfig.value.text}`
})

const isConnecting = computed(() => connectionStatus.value === 'connecting')
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm border border-gray-200 shadow-sm"
    :title="tooltipText"
  >
    <div class="relative">
      <div
        :class="[
          'w-2.5 h-2.5 rounded-full transition-colors duration-300',
          statusConfig.color
        ]"
      />
      <div
        v-if="isConnecting"
        :class="[
          'absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping',
          statusConfig.color,
          'opacity-75'
        ]"
      />
    </div>

    <span
      :class="[
        'text-xs font-medium transition-colors duration-300',
        statusConfig.textColor
      ]"
    >
      {{ statusConfig.text }}
    </span>
  </div>
</template>

<style scoped>
@keyframes ping {
  75%,
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

.animate-ping {
  animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}
</style>
