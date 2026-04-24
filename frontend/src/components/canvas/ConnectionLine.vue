<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
import type {
  Connection,
  ConnectionStatus,
  TriggerMode,
} from "@/types/connection";
import type { Pod } from "@/types/pod";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPath } from "@/composables/useConnectionPath";
import { useAnchorDetection } from "@/composables/useAnchorDetection";
import { Loader2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    connection: Connection;
    pods: Pod[];
    isSelected: boolean;
    status?: ConnectionStatus;
    triggerMode?: TriggerMode;
    decideReason?: string;
  }>(),
  {
    status: "idle",
    triggerMode: "auto",
    decideReason: undefined,
  },
);

const emit = defineEmits<{
  select: [connectionId: string];
  contextmenu: [data: { connectionId: string; event: MouseEvent }];
}>();

const connectionStore = useConnectionStore();
const { calculatePathData, calculateMultipleArrowPositions } =
  useConnectionPath();
const { getAnchorPositions } = useAnchorDetection();
const { t } = useI18n();

const pathData = computed(() => {
  const sourcePod = props.pods.find(
    (pod) => pod.id === props.connection.sourcePodId,
  );
  const targetPod = props.pods.find(
    (pod) => pod.id === props.connection.targetPodId,
  );

  if (!sourcePod || !targetPod) {
    return { path: "", midPoint: { x: 0, y: 0 }, angle: 0 };
  }

  const sourceAnchors = getAnchorPositions(sourcePod);
  const sourceAnchor = sourceAnchors.find(
    (a) => a.anchor === props.connection.sourceAnchor,
  );

  if (!sourceAnchor) {
    return { path: "", midPoint: { x: 0, y: 0 }, angle: 0 };
  }

  const sourceX = sourceAnchor.x;
  const sourceY = sourceAnchor.y;

  const targetAnchors = getAnchorPositions(targetPod);
  const targetAnchor = targetAnchors.find(
    (a) => a.anchor === props.connection.targetAnchor,
  );

  if (!targetAnchor) {
    return { path: "", midPoint: { x: 0, y: 0 }, angle: 0 };
  }

  return calculatePathData({
    start: { x: sourceX, y: sourceY },
    end: { x: targetAnchor.x, y: targetAnchor.y },
    sourceAnchor: props.connection.sourceAnchor,
    targetAnchor: props.connection.targetAnchor,
  });
});

const AI_DECIDE_COLOR_DEFAULT = "oklch(0.65 0.12 300 / 0.7)";

const AI_DECIDE_COLOR_MAP: Record<string, string> = {
  "ai-deciding": "oklch(0.65 0.14 300 / 0.8)",
  "ai-rejected": "oklch(0.65 0.15 20)",
  "ai-error": "oklch(0.7 0.15 60 / 0.8)",
  "ai-approved": AI_DECIDE_COLOR_DEFAULT,
  active: "oklch(0.7 0.15 50)",
  queued: "oklch(0.7 0.12 230 / 0.8)",
};

function getAiDecideColor(status: string): string {
  return AI_DECIDE_COLOR_MAP[status] ?? AI_DECIDE_COLOR_DEFAULT;
}

function getStatusColor(status: string): string {
  if (status === "idle") return "oklch(0.6 0.02 50 / 0.5)";
  return "oklch(0.7 0.15 50)";
}

const lineColor = computed(() => {
  if (props.triggerMode === "ai-decide") return getAiDecideColor(props.status);
  if (props.status === "queued") return "oklch(0.7 0.12 230 / 0.8)";
  if (props.status === "waiting") return "oklch(0.7 0.15 155 / 0.8)";
  return getStatusColor(props.status);
});

type MidLabelEntry = { type: string; text: string; class: string } | null;

const MID_LABEL_DIRECT: MidLabelEntry = {
  type: "direct",
  text: "D",
  class: "direct-label",
};
const MID_LABEL_AI_DEFAULT: MidLabelEntry = {
  type: "ai",
  text: "AI",
  class: "ai-label",
};

const AI_DECIDE_STATUS_LABEL_MAP: Record<string, MidLabelEntry> = {
  "ai-deciding": { type: "deciding", text: "", class: "deciding-label" },
  "ai-rejected": null,
  "ai-error": { type: "error", text: "!", class: "error-label" },
};

const midLabel = computed((): MidLabelEntry => {
  if (props.triggerMode === "auto") return null;
  if (props.triggerMode === "direct") return MID_LABEL_DIRECT;

  const statusKey = props.status;
  return statusKey in AI_DECIDE_STATUS_LABEL_MAP
    ? (AI_DECIDE_STATUS_LABEL_MAP[statusKey] ?? null)
    : MID_LABEL_AI_DEFAULT;
});

const tooltipText = computed(() => {
  if (!props.decideReason) return undefined;

  if (props.status === "ai-rejected") {
    return t("canvas.connectionLine.aiRejectedReason", {
      reason: props.decideReason,
    });
  }

  if (props.status === "ai-error") {
    return t("canvas.connectionLine.aiErrorReason", {
      reason: props.decideReason,
    });
  }

  return undefined;
});

const arrowPositions = computed(() => {
  const sourcePod = props.pods.find(
    (pod) => pod.id === props.connection.sourcePodId,
  );
  const targetPod = props.pods.find(
    (pod) => pod.id === props.connection.targetPodId,
  );

  if (!sourcePod || !targetPod) {
    return [];
  }

  const sourceAnchors = getAnchorPositions(sourcePod);
  const sourceAnchor = sourceAnchors.find(
    (a) => a.anchor === props.connection.sourceAnchor,
  );

  if (!sourceAnchor) {
    return [];
  }

  const sourceX = sourceAnchor.x;
  const sourceY = sourceAnchor.y;

  const targetAnchors = getAnchorPositions(targetPod);
  const targetAnchor = targetAnchors.find(
    (a) => a.anchor === props.connection.targetAnchor,
  );

  if (!targetAnchor) {
    return [];
  }

  return calculateMultipleArrowPositions(
    {
      start: { x: sourceX, y: sourceY },
      end: { x: targetAnchor.x, y: targetAnchor.y },
      sourceAnchor: props.connection.sourceAnchor,
      targetAnchor: props.connection.targetAnchor,
    },
    160,
  );
});

const useXMarker = computed(() => {
  return props.triggerMode === "ai-decide" && props.status === "ai-rejected";
});

const pathRef = ref<SVGPathElement | null>(null);

const xMarkerPositions = ref<Array<{ x: number; y: number; angle: number }>>(
  [],
);

const MARKER_SPACING_PX = 50;
const MIN_MARKERS = 2;
const MAX_MARKERS = 8;

const calculateXMarkerPositions = (): void => {
  if (!pathRef.value || !useXMarker.value) {
    xMarkerPositions.value = [];
    return;
  }

  const path = pathRef.value;
  const totalLength = path.getTotalLength();

  const count = Math.max(
    MIN_MARKERS,
    Math.min(MAX_MARKERS, Math.floor(totalLength / MARKER_SPACING_PX)),
  );

  const positions: Array<{ x: number; y: number; angle: number }> = [];

  for (let i = 0; i < count; i++) {
    const distance = (totalLength / (count + 1)) * (i + 1);
    const point = path.getPointAtLength(distance);

    const delta = 2;
    const point1 = path.getPointAtLength(Math.max(0, distance - delta));
    const point2 = path.getPointAtLength(
      Math.min(totalLength, distance + delta),
    );
    const angle =
      Math.atan2(point2.y - point1.y, point2.x - point1.x) * (180 / Math.PI);

    positions.push({ x: point.x, y: point.y, angle });
  }

  xMarkerPositions.value = positions;
};

watch([pathData, useXMarker], () => nextTick(calculateXMarkerPositions));

onMounted(() => {
  calculateXMarkerPositions();
});

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
</script>

<template>
  <g
    :class="[
      'connection-line',
      {
        selected: isSelected,
        active: status === 'active',
        idle: status === 'idle',
        queued: status === 'queued',
        waiting: status === 'waiting',
        'ai-decide': triggerMode === 'ai-decide',
        'ai-deciding': status === 'ai-deciding',
        'ai-approved': status === 'ai-approved',
        'ai-rejected': status === 'ai-rejected',
        'ai-error': status === 'ai-error',
        direct: triggerMode === 'direct',
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
      ref="pathRef"
      :class="[
        'line',
        {
          'queued-pulse': status === 'queued',
          'waiting-pulse': status === 'waiting',
        },
      ]"
      :d="pathData.path"
      :stroke="lineColor"
      :style="{ color: lineColor }"
      fill="none"
    />

    <polygon
      v-for="(arrow, index) in arrowPositions"
      v-show="
        (status === 'idle' ||
          status === 'queued' ||
          status === 'waiting' ||
          status === 'ai-approved') &&
          !useXMarker
      "
      :key="`static-${index}`"
      class="arrow"
      :points="`0,-5 10,0 0,5`"
      :fill="lineColor"
      :transform="`translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle})`"
    />

    <template
      v-if="(status === 'active' || status === 'ai-deciding') && !useXMarker"
    >
      <polygon
        v-for="i in 3"
        :key="`animated-${i}`"
        class="arrow arrow-animated"
        :points="`0,-5 10,0 0,5`"
        :fill="lineColor"
      >
        <animateMotion
          dur="4s"
          :begin="`${(i - 1) * 1.33}s`"
          repeatCount="indefinite"
          :path="pathData.path"
          rotate="auto"
        />
        <animate
          attributeName="opacity"
          dur="4s"
          :begin="`${(i - 1) * 1.33}s`"
          values="0;1;1;0"
          keyTimes="0;0.1;0.9;1"
          repeatCount="indefinite"
        />
      </polygon>
    </template>

    <g
      v-for="(marker, index) in xMarkerPositions"
      v-show="useXMarker"
      :key="`x-marker-${index}`"
      :transform="`translate(${marker.x}, ${marker.y}) rotate(${marker.angle})`"
    >
      <line
        x1="-4"
        y1="-4"
        x2="4"
        y2="4"
        :stroke="lineColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <line
        x1="4"
        y1="-4"
        x2="-4"
        y2="4"
        :stroke="lineColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </g>

    <foreignObject
      v-if="midLabel"
      :x="pathData.midPoint.x - 16"
      :y="pathData.midPoint.y - 10"
      width="32"
      height="20"
      :title="tooltipText"
    >
      <div :class="['connection-mid-label', midLabel.class]">
        <Loader2
          v-if="midLabel.type === 'deciding'"
          :size="12"
        />
        <span v-else>{{ midLabel.text }}</span>
      </div>
    </foreignObject>
  </g>
</template>
