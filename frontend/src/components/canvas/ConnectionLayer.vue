<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { isEditingElement } from "@/utils/domHelpers";
import ConnectionLine from "./ConnectionLine.vue";
import {
  isCanvasBoundsVisible,
  type CanvasViewportBounds,
} from "@/lib/canvasViewport";
import { useAnchorDetection } from "@/composables/useAnchorDetection";
import { useConnectionPath } from "@/composables/useConnectionPath";

const props = defineProps<{
  viewportBounds: CanvasViewportBounds;
}>();

const { connectionStore, podStore } = useCanvasContext();
const { getAnchorPositions } = useAnchorDetection();
const { calculatePathData } = useConnectionPath();

const podsById = computed(
  () => new Map(podStore.pods.map((pod) => [pod.id, pod])),
);

const visibleConnections = computed(() =>
  connectionStore.connections.filter((connection) => {
    const sourcePod = podsById.value.get(connection.sourcePodId ?? "");
    const targetPod = podsById.value.get(connection.targetPodId);
    if (!sourcePod || !targetPod) return false;

    const sourceAnchor = getAnchorPositions(sourcePod).find(
      (anchor) => anchor.anchor === connection.sourceAnchor,
    );
    const targetAnchor = getAnchorPositions(targetPod).find(
      (anchor) => anchor.anchor === connection.targetAnchor,
    );
    if (!sourceAnchor || !targetAnchor) return false;

    const pathData = calculatePathData({
      start: { x: sourceAnchor.x, y: sourceAnchor.y },
      end: { x: targetAnchor.x, y: targetAnchor.y },
      sourceAnchor: connection.sourceAnchor,
      targetAnchor: connection.targetAnchor,
      routingMode: connection.routingMode ?? "bezier",
      routingOffset: connection.routingOffset ?? 0,
      routingPoints: connection.routingPoints ?? [],
    });
    return isCanvasBoundsVisible(props.viewportBounds, pathData.bounds);
  }),
);

const draggingPathData = computed(() => {
  if (!connectionStore.draggingConnection) {
    return "";
  }

  const { startPoint, currentPoint } = connectionStore.draggingConnection;

  return `M ${startPoint.x} ${startPoint.y} L ${currentPoint.x} ${currentPoint.y}`;
});

const emit = defineEmits<{
  connectionContextMenu: [data: { connectionId: string; event: MouseEvent }];
}>();

const handleSelectConnection = (connectionId: string): void => {
  connectionStore.selectConnection(connectionId);
};

const handleConnectionContextMenu = (data: {
  connectionId: string;
  event: MouseEvent;
}): void => {
  emit("connectionContextMenu", data);
};

const handleCanvasClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) {
    connectionStore.selectConnection(null);
  }
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  if (isEditingElement()) return;

  if (connectionStore.selectedConnectionId) {
    connectionStore.deleteConnection(connectionStore.selectedConnectionId);
  }
};

onMounted(() => {
  document.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeyDown);
});
</script>

<template>
  <svg
    class="connection-layer"
    @click="handleCanvasClick"
  >
    <ConnectionLine
      v-for="connection in visibleConnections"
      :key="connection.id"
      :connection="connection"
      :pods-by-id="podsById"
      :is-selected="connection.id === connectionStore.selectedConnectionId"
      :trigger-mode="connection.triggerMode || 'auto'"
      :label="connection.label"
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
