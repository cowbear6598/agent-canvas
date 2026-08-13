<script setup lang="ts">
import { computed } from "vue";
import type { Connection, TriggerMode } from "@/types/connection";
import type { Pod } from "@/types/pod";
import { useConnectionStore } from "@/stores/connectionStore";
import { useConnectionPath } from "@/composables/useConnectionPath";
import { useAnchorDetection } from "@/composables/useAnchorDetection";

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
const { calculatePathData, calculateMultipleArrowPositions } =
  useConnectionPath();
const { getAnchorPositions } = useAnchorDetection();

const emptyPathData = { path: "", midPoint: { x: 0, y: 0 }, angle: 0 };

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
  </g>
</template>
