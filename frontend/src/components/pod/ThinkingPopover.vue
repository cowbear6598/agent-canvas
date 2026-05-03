<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useEscapeClose } from "@/composables/useEscapeClose";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { PodProvider } from "@/types/pod";

const props = defineProps<{
  podId: string;
  provider: PodProvider;
  currentModel: string;
  currentLevel: string | undefined;
  anchorRect: DOMRect;
}>();

const emit = defineEmits<{
  (e: "select", level: string): void;
  (e: "close"): void;
}>();

const providerCapabilityStore = useProviderCapabilityStore();

/** 當前 provider+model 支援的 thinking levels 清單 */
const supportedLevels = computed<ReadonlyArray<string>>(() =>
  providerCapabilityStore.getSupportedThinkingLevels(
    props.provider,
    props.currentModel,
  ),
);

/** 顯示用 label 對照表（直接 inline，依 plan 不另開檔） */
const LEVEL_LABEL_MAP: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "xHigh",
  max: "Max",
};

const levelLabel = (level: string): string => LEVEL_LABEL_MAP[level] ?? level;

const rootRef = ref<HTMLElement | null>(null);

/** 點擊外部關閉（capture 階段攔截，避免內部 click 誤觸）
 *  排除 thinking 觸發按鈕（.pod-thinking-notch-area）：
 *  點觸發按鈕時讓 click 事件走到 toggle 邏輯，
 *  避免「mousedown 先關、click 再開」的競態導致 popover 無法關閉。
 */
const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  if ((event.target as Element).closest(".pod-thinking-notch-area")) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

const handleSelect = (level: string): void => {
  emit("select", level);
  emit("close");
};

onMounted(() => {
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

// ESC 鍵關閉
useEscapeClose(() => emit("close"));
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="fixed z-50 min-w-32 rounded-md border border-doodle-ink bg-card p-2 shadow-md pod-slot-menu-base"
      :style="{
        left: `${anchorRect.left}px`,
        top: `${anchorRect.top - 8}px`,
        transform: 'translateY(-100%)',
      }"
      @click.stop
    >
      <button
        v-for="level in supportedLevels"
        :key="level"
        :class="[
          'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
          {
            'bg-secondary border-l-2 border-l-primary': level === currentLevel,
          },
        ]"
        @click="handleSelect(level)"
      >
        <span
          :class="[
            'font-mono',
            level === currentLevel
              ? 'text-primary font-semibold'
              : 'text-foreground',
          ]"
        >
          {{ levelLabel(level) }}
        </span>
      </button>
    </div>
  </Teleport>
</template>
