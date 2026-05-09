<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from "vue";
import type {
  Connection,
  ConnectionStatus,
  DecideStatus,
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
    decideStatus?: DecideStatus;
    decideReason?: string;
    label?: string;
  }>(),
  {
    status: "idle",
    triggerMode: "auto",
    decideStatus: "none",
    decideReason: undefined,
    label: undefined,
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

const BRANCH_STATUS_COLOR_DEFAULT = "oklch(0.65 0.12 300 / 0.7)";

const BRANCH_STATUS_COLOR_MAP: Record<string, string> = {
  pending: "oklch(0.65 0.14 300 / 0.8)",
  rejected: "oklch(0.65 0.15 20)",
  error: "oklch(0.7 0.15 60 / 0.8)",
  approved: BRANCH_STATUS_COLOR_DEFAULT,
  active: "oklch(0.7 0.15 50)",
  queued: "oklch(0.7 0.12 230 / 0.8)",
};

function getBranchStatusColor(decideStatus: string): string {
  return BRANCH_STATUS_COLOR_MAP[decideStatus] ?? BRANCH_STATUS_COLOR_DEFAULT;
}

function getStatusColor(status: string): string {
  if (status === "idle") return "oklch(0.6 0.02 50 / 0.5)";
  return "oklch(0.7 0.15 50)";
}

const lineColor = computed(() => {
  if (props.triggerMode === "branch")
    return getBranchStatusColor(props.decideStatus ?? "none");
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

// branch 模式下特殊狀態 label 覆寫表（rejected 不覆寫，保留使用者命名的 label）
const BRANCH_STATUS_LABEL_MAP: Record<string, MidLabelEntry> = {
  pending: { type: "deciding", text: "", class: "deciding-label" },
  error: { type: "error", text: "!", class: "error-label" },
};

const midLabel = computed((): MidLabelEntry => {
  if (props.triggerMode === "auto") return null;
  if (props.triggerMode === "direct") return MID_LABEL_DIRECT;

  // branch 模式：pending / error 用特殊 label 覆寫；其餘狀態（含 rejected）顯示使用者命名的 label
  const decideKey = props.decideStatus ?? "none";
  if (decideKey in BRANCH_STATUS_LABEL_MAP) {
    return BRANCH_STATUS_LABEL_MAP[decideKey] ?? null;
  }
  return {
    type: "branch-label",
    text: props.label ?? "",
    class: "branch-label",
  };
});

const tooltipText = computed(() => {
  if (!props.decideReason) return undefined;

  if (props.decideStatus === "rejected") {
    return t("canvas.connectionLine.aiRejectedReason", {
      reason: props.decideReason,
    });
  }

  if (props.decideStatus === "error") {
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
  return props.triggerMode === "branch" && props.decideStatus === "rejected";
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
        branch: triggerMode === 'branch',
        deciding: decideStatus === 'pending',
        approved: decideStatus === 'approved',
        rejected: decideStatus === 'rejected',
        error: decideStatus === 'error',
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
          decideStatus === 'approved') &&
        !useXMarker
      "
      :key="`static-${index}`"
      class="arrow"
      :points="`0,-5 10,0 0,5`"
      :fill="lineColor"
      :transform="`translate(${arrow.x}, ${arrow.y}) rotate(${arrow.angle})`"
    />

    <template
      v-if="(status === 'active' || decideStatus === 'pending') && !useXMarker"
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
      :x="pathData.midPoint.x - 100"
      :y="pathData.midPoint.y - 10"
      width="200"
      height="20"
      :title="tooltipText"
    >
      <div class="connection-mid-label-wrapper">
        <div :class="['connection-mid-label', midLabel.class]">
          <Loader2 v-if="midLabel.type === 'deciding'" :size="12" />
          <span v-else>{{ midLabel.text }}</span>
        </div>
      </div>
    </foreignObject>
  </g>
</template>
