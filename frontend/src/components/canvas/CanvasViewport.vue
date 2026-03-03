<script setup lang="ts">
import { computed, ref } from 'vue'
import { useViewportStore } from '@/stores/pod'
import { useCanvasPan, useCanvasZoom, useBoxSelect } from '@/composables/canvas'
import { GRID_SIZE, MOUSE_BUTTON } from '@/lib/constants'

const viewportStore = useViewportStore()

const viewportEl = ref<HTMLElement | null>(null)

defineExpose({ el: viewportEl })

const emit = defineEmits<{
  contextmenu: [e: MouseEvent]
}>()

const { startPan } = useCanvasPan({
  onRightClick: (e: MouseEvent) => {
    emit('contextmenu', e)
  },
})
const { handleWheel } = useCanvasZoom()
const { startBoxSelect } = useBoxSelect()

const gridStyle = computed(() => {
  const { offset, zoom } = viewportStore
  const gridSizeScaled = GRID_SIZE * zoom

  return {
    backgroundPosition: `${offset.x % gridSizeScaled}px ${offset.y % gridSizeScaled}px`,
    backgroundSize: `${gridSizeScaled}px ${gridSizeScaled}px`,
  }
})

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault() // 只阻止瀏覽器原生右鍵選單，自定義選單由 useCanvasPan 的回呼處理
}

const handleMouseDown = (e: MouseEvent): void => {
  if (e.button === MOUSE_BUTTON.RIGHT) {
    startPan(e)
    return
  }

  if (e.button === MOUSE_BUTTON.LEFT) {
    startBoxSelect(e)
  }
}
</script>

<template>
  <div
    ref="viewportEl"
    class="viewport h-full canvas-grid"
    :style="gridStyle"
    @wheel="handleWheel"
    @mousedown="handleMouseDown"
    @contextmenu="handleContextMenu"
  >
    <div
      class="canvas-content h-full"
      :style="{
        transform: `translate(${viewportStore.offset.x}px, ${viewportStore.offset.y}px) scale(${viewportStore.zoom})`,
        transformOrigin: '0 0',
      }"
    >
      <slot />
    </div>
  </div>
</template>
