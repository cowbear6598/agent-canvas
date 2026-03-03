<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import ConnectionLine from './ConnectionLine.vue'

const { connectionStore, podStore } = useCanvasContext()

const draggingPathData = computed(() => {
  if (!connectionStore.draggingConnection) {
    return ''
  }

  const { startPoint, currentPoint } = connectionStore.draggingConnection

  return `M ${startPoint.x} ${startPoint.y} L ${currentPoint.x} ${currentPoint.y}`
})

const emit = defineEmits<{
  connectionContextMenu: [data: { connectionId: string; event: MouseEvent }]
}>()

const handleSelectConnection = (connectionId: string): void => {
  connectionStore.selectConnection(connectionId)
}

const handleConnectionContextMenu = (data: { connectionId: string; event: MouseEvent }): void => {
  emit('connectionContextMenu', data)
}

const handleCanvasClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) {
    connectionStore.selectConnection(null)
  }
}

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (connectionStore.selectedConnectionId) {
      connectionStore.deleteConnection(connectionStore.selectedConnectionId)
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <svg
    class="connection-layer"
    @click="handleCanvasClick"
  >
    <ConnectionLine
      v-for="connection in connectionStore.connections"
      :key="connection.id"
      :connection="connection"
      :pods="podStore.pods"
      :is-selected="connection.id === connectionStore.selectedConnectionId"
      :status="connection.status || 'idle'"
      :trigger-mode="connection.triggerMode || 'auto'"
      :decide-reason="connection.decideReason"
      @select="handleSelectConnection"
      @contextmenu="handleConnectionContextMenu"
    />

    <g
      v-if="connectionStore.draggingConnection"
      class="dragging-line"
    >
      <path
        :d="draggingPathData"
        stroke="oklch(0.6 0.02 50)"
        stroke-width="2"
        stroke-dasharray="5,5"
        fill="none"
      />
    </g>
  </svg>
</template>
