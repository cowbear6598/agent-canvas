<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type {
  Connection,
  ConnectionRoutingPoint,
  TriggerMode,
} from "@/types/connection";
import type { Pod } from "@/types/pod";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPath } from "@/composables/useConnectionPath";
import { useAnchorDetection } from "@/composables/useAnchorDetection";
import { useViewportStore } from "@/stores/pod";

const props = withDefaults(
  defineProps<{
    connection: Connection;
    podsById: Map<string, Pod>;
    isSelected: boolean;
    triggerMode?: TriggerMode;
    label?: string;
  }>(),
  {
    triggerMode: "auto",
    label: undefined,
  },
);

const emit = defineEmits<{
  select: [connectionId: string];
  contextmenu: [data: { connectionId: string; event: MouseEvent }];
}>();

const connectionStore = useConnectionStore();
const viewportStore = useViewportStore();
const {
  calculatePathData,
  calculateMultipleArrowPositions,
  calculateInsertionHandles,
  calculateRoutingControlPoints,
} = useConnectionPath();
const { getAnchorPositions } = useAnchorDetection();

const emptyPathData = {
  path: "",
  midPoint: { x: 0, y: 0 },
  angle: 0,
  routeAxis: null,
  handlePoint: { x: 0, y: 0 },
  bounds: { left: 0, top: 0, right: 0, bottom: 0 },
} as const;
const previewRoutingPoints = ref<ConnectionRoutingPoint[] | null>(null);
const draggingHandleKey = ref<string | null>(null);
const isDraggingRoute = computed(() => draggingHandleKey.value !== null);

const connectionPathInput = computed(() => {
  const sourcePod = props.podsById.get(props.connection.sourcePodId ?? "");
  const targetPod = props.podsById.get(props.connection.targetPodId);

  if (!sourcePod || !targetPod) {
    return null;
  }

  const sourceAnchors = getAnchorPositions(sourcePod);
  const sourceAnchor = sourceAnchors.find(
    (a) => a.anchor === props.connection.sourceAnchor,
  );

  if (!sourceAnchor) {
    return null;
  }

  const targetAnchors = getAnchorPositions(targetPod);
  const targetAnchor = targetAnchors.find(
    (a) => a.anchor === props.connection.targetAnchor,
  );

  if (!targetAnchor) {
    return null;
  }

  return {
    start: { x: sourceAnchor.x, y: sourceAnchor.y },
    end: { x: targetAnchor.x, y: targetAnchor.y },
    sourceAnchor: props.connection.sourceAnchor,
    targetAnchor: props.connection.targetAnchor,
    routingMode: props.connection.routingMode ?? "bezier",
    routingOffset: props.connection.routingOffset ?? 0,
    routingPoints:
      previewRoutingPoints.value ?? props.connection.routingPoints ?? [],
  };
});

const pathData = computed(() => {
  if (!connectionPathInput.value) {
    return emptyPathData;
  }

  return calculatePathData(connectionPathInput.value);
});

const lineColor = computed(() =>
  props.triggerMode === "branch"
    ? "oklch(0.65 0.12 300 / 0.7)"
    : "oklch(0.6 0.02 50 / 0.5)",
);

const isDirect = computed(() => props.connection.direct);

type MidLabelEntryValue = { type: string; text: string; class: string };
type MidLabelEntry = MidLabelEntryValue | null;

function createBranchMidLabel(label?: string): MidLabelEntryValue {
  return {
    type: "branch-label",
    text: label ?? "",
    class: "branch-label",
  };
}

function getMidLabel(
  triggerMode: TriggerMode,
  label: string | undefined,
): MidLabelEntry {
  if (triggerMode === "auto") return null;
  return createBranchMidLabel(label);
}

const midLabel = computed((): MidLabelEntry => {
  return getMidLabel(props.triggerMode, props.label);
});

const arrowPositions = computed(() => {
  if (!connectionPathInput.value) {
    return [];
  }

  return calculateMultipleArrowPositions(
    connectionPathInput.value,
    160,
  );
});

const insertionHandles = computed(() => {
  if (!connectionPathInput.value || isDraggingRoute.value) return [];
  return calculateInsertionHandles(connectionPathInput.value);
});

const displayedRoutingPoints = computed(() =>
  connectionPathInput.value
    ? calculateRoutingControlPoints(connectionPathInput.value)
    : [],
);


const handleClick = (e: MouseEvent): void => {
  e.stopPropagation();
  emit("select", props.connection.id);
};

const handleDoubleClick = (e: MouseEvent): void => {
  e.stopPropagation();
  connectionStore.deleteConnection(props.connection.id);
};

const handleContextMenu = (e: MouseEvent): void => {
  e.preventDefault();
  e.stopPropagation();
  emit("contextmenu", { connectionId: props.connection.id, event: e });
};

let currentMouseMoveHandler: ((event: MouseEvent) => void) | null = null;
let currentMouseUpHandler: (() => void) | null = null;

const cleanupRouteDrag = (): void => {
  if (currentMouseMoveHandler) {
    document.removeEventListener("mousemove", currentMouseMoveHandler);
    currentMouseMoveHandler = null;
  }
  if (currentMouseUpHandler) {
    document.removeEventListener("mouseup", currentMouseUpHandler);
    currentMouseUpHandler = null;
  }
};

const cloneRoutingPoints = (
  points: ConnectionRoutingPoint[],
): ConnectionRoutingPoint[] => points.map((point) => ({ ...point }));

const startRoutingPointDrag = (params: {
  event: MouseEvent;
  handleKey: string;
  pointIndex: number;
  origin: ConnectionRoutingPoint;
  dragAxis: "x" | "y" | null;
  initialPoints: ConnectionRoutingPoint[];
}): void => {
  const { event, handleKey, pointIndex, origin, dragAxis, initialPoints } = params;
  event.preventDefault();
  event.stopPropagation();
  emit("select", props.connection.id);
  cleanupRouteDrag();

  const startClientX = event.clientX;
  const startClientY = event.clientY;
  let hasMoved = false;
  draggingHandleKey.value = handleKey;
  previewRoutingPoints.value = cloneRoutingPoints(initialPoints);

  currentMouseMoveHandler = (moveEvent: MouseEvent): void => {
    const deltaX = (moveEvent.clientX - startClientX) / viewportStore.zoom;
    const deltaY = (moveEvent.clientY - startClientY) / viewportStore.zoom;
    hasMoved ||= deltaX !== 0 || deltaY !== 0;
    const nextPoints = cloneRoutingPoints(initialPoints);
    nextPoints[pointIndex] = {
      ...nextPoints[pointIndex],
      x: origin.x + (dragAxis === "y" ? 0 : deltaX),
      y: origin.y + (dragAxis === "x" ? 0 : deltaY),
    };
    previewRoutingPoints.value = nextPoints;
  };
  currentMouseUpHandler = (): void => {
    const nextPoints = previewRoutingPoints.value;
    draggingHandleKey.value = null;
    cleanupRouteDrag();

    if (!hasMoved || !nextPoints) {
      previewRoutingPoints.value = null;
      return;
    }

    void connectionStore
      .updateConnectionRouting(props.connection.id, {
        routingOffset:
          props.connection.routingMode === "orthogonal"
            ? (props.connection.routingOffset ?? 0)
            : 0,
        routingPoints: nextPoints,
      })
      .finally(() => {
        previewRoutingPoints.value = null;
      });
  };

  document.addEventListener("mousemove", currentMouseMoveHandler);
  document.addEventListener("mouseup", currentMouseUpHandler);
};

const handleExistingPointDragStart = (
  event: MouseEvent,
  pointIndex: number,
): void => {
  const initialPoints = cloneRoutingPoints(displayedRoutingPoints.value);
  const origin = initialPoints[pointIndex];
  if (!origin) return;
  const routeAxis = pathData.value.routeAxis;
  const dragAxis =
    props.connection.routingMode === "orthogonal" && routeAxis
      ? origin.orthogonalRole === "lane"
        ? routeAxis
        : routeAxis === "x"
          ? "y"
          : "x"
      : null;
  startRoutingPointDrag({
    event,
    handleKey: `point-${pointIndex}`,
    pointIndex,
    origin,
    dragAxis,
    initialPoints,
  });
};

const handleInsertionDragStart = (
  event: MouseEvent,
  handleIndex: number,
): void => {
  const handle = insertionHandles.value[handleIndex];
  if (!handle) return;
  const initialPoints = cloneRoutingPoints(displayedRoutingPoints.value);
  initialPoints.splice(handle.insertIndex, 0, { ...handle.point });
  startRoutingPointDrag({
    event,
    handleKey: `insert-${handleIndex}`,
    pointIndex: handle.insertIndex,
    origin: handle.point,
    dragAxis: handle.dragAxis,
    initialPoints,
  });
};

onUnmounted(cleanupRouteDrag);
</script>

<template>
  <g
    :class="[
      'connection-line',
      {
        selected: isSelected,
        branch: triggerMode === 'branch',
        direct: isDirect,
      },
    ]"
    @click="handleClick"
    @dblclick="handleDoubleClick"
    @contextmenu="handleContextMenu"
  >
    <path
      class="click-area"
      :d="pathData.path"
      stroke="transparent"
      stroke-width="20"
      fill="none"
    />

    <path
      class="line"
      :d="pathData.path"
      :stroke="lineColor"
      :style="{ color: lineColor }"
      fill="none"
    />

    <polygon
      v-for="(arrow, index) in arrowPositions"
      :key="`static-${index}`"
      class="arrow"
      :points="`0,-5 10,0 0,5`"
      :fill="lineColor"
      :transform="`translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle})`"
    />

    <foreignObject
      v-if="midLabel || isDirect"
      :x="pathData.midPoint.x - 100"
      :y="pathData.midPoint.y - 10"
      width="200"
      height="20"
    >
      <div class="connection-mid-label-wrapper">
        <div class="connection-mid-label-stack">
          <div
            v-if="midLabel"
            :class="['connection-mid-label', midLabel.class]"
          >
            <span>{{ midLabel.text }}</span>
          </div>
          <div
            v-if="isDirect"
            class="connection-mid-label direct-label"
          >
            <span>D</span>
          </div>
        </div>
      </div>
    </foreignObject>

    <template v-if="isSelected">
      <g
        v-for="(point, index) in displayedRoutingPoints"
        :key="`point-${index}`"
        class="route-handle route-point-handle"
        :class="{ dragging: draggingHandleKey === `point-${index}` }"
        :data-testid="`connection-route-point-${index}`"
        @mousedown="handleExistingPointDragStart($event, index)"
        @click.stop
      >
        <title>{{ $t("canvas.connectionRouting.movePoint") }}</title>
        <circle
          :cx="point.x"
          :cy="point.y"
          r="8"
        />
      </g>

      <g
        v-for="(handle, index) in insertionHandles"
        :key="`insert-${handle.insertIndex}-${index}`"
        class="route-handle route-insertion-handle"
        :class="{
          horizontal: handle.dragAxis === 'x',
          vertical: handle.dragAxis === 'y',
        }"
        :data-testid="`connection-route-insert-${index}`"
        @mousedown="handleInsertionDragStart($event, index)"
        @click.stop
      >
        <title>{{ $t("canvas.connectionRouting.addPoint") }}</title>
        <circle
          :cx="handle.point.x"
          :cy="handle.point.y"
          r="6"
        />
      </g>
    </template>
  </g>
</template>
