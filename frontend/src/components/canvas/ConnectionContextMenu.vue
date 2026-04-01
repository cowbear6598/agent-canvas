<script setup lang="ts">
import type { TriggerMode } from "@/types/connection";
import type { ModelType } from "@/types/pod";
import { Zap, Brain, ArrowRight, ChevronRight } from "lucide-vue-next";
import { ref, onMounted, onUnmounted } from "vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToast } from "@/composables/useToast";
import {
  DEFAULT_TOAST_DURATION_MS,
  SHORT_TOAST_DURATION_MS,
} from "@/lib/constants";

interface Props {
  position: { x: number; y: number };
  connectionId: string;
  currentTriggerMode: TriggerMode;
  currentSummaryModel: ModelType;
  currentAiDecideModel: ModelType;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "trigger-mode-changed": [];
  "summary-model-changed": [];
  "ai-decide-model-changed": [];
}>();

const connectionStore = useConnectionStore();
const { toast } = useToast();

const handleSetTriggerMode = async (targetMode: TriggerMode): Promise<void> => {
  if (targetMode === props.currentTriggerMode) {
    emit("close");
    return;
  }

  const result = await connectionStore.updateConnectionTriggerMode(
    props.connectionId,
    targetMode,
  );

  if (result) {
    const modeTextMap: Record<TriggerMode, string> = {
      auto: "自動觸發",
      "ai-decide": "AI 判斷",
      direct: "直接觸發",
    };
    toast({
      title: "觸發模式已變更",
      description: `已切換為${modeTextMap[targetMode]}模式`,
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("trigger-mode-changed");
    emit("close");
  } else {
    toast({
      title: "變更失敗",
      description: "無法變更觸發模式",
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

const MODEL_LABEL_MAP: Record<ModelType, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
};

const handleSetModel = async (
  targetModel: ModelType,
  currentModel: ModelType,
  updateFn: (connectionId: string, model: ModelType) => Promise<unknown>,
  successTitle: string,
  failDesc: string,
  changedEvent: "summary-model-changed" | "ai-decide-model-changed",
): Promise<void> => {
  if (targetModel === currentModel) {
    emit("close");
    return;
  }

  const result = await updateFn(props.connectionId, targetModel);

  if (result) {
    toast({
      title: successTitle,
      description: `已切換為 ${MODEL_LABEL_MAP[targetModel]}`,
      duration: SHORT_TOAST_DURATION_MS,
    });
    if (changedEvent === "summary-model-changed") {
      emit("summary-model-changed");
    } else {
      emit("ai-decide-model-changed");
    }
    emit("close");
  } else {
    toast({
      title: "變更失敗",
      description: failDesc,
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

const handleSetSummaryModel = (targetModel: ModelType): Promise<void> =>
  handleSetModel(
    targetModel,
    props.currentSummaryModel,
    connectionStore.updateConnectionSummaryModel,
    "總結模型已變更",
    "無法變更總結模型",
    "summary-model-changed",
  );

const handleSetAiDecideModel = (targetModel: ModelType): Promise<void> =>
  handleSetModel(
    targetModel,
    props.currentAiDecideModel,
    connectionStore.updateConnectionAiDecideModel,
    "AI 決策模型已變更",
    "無法變更 AI 決策模型",
    "ai-decide-model-changed",
  );

const menuRef = ref<HTMLElement | null>(null);

const handleOutsideClick = (event: MouseEvent): void => {
  if (!menuRef.value) return;
  const menuEl = menuRef.value;
  if (menuEl?.contains(event.target as Node)) return;

  // 右鍵點選單外部：關閉選單，讓事件繼續傳播到 canvas/connection
  // 左鍵點選單外部：關閉選單並停止事件傳播
  if (event.button !== 2) {
    event.stopPropagation();
  }

  emit("close");
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});

const isSummaryMenuOpen = ref(false);
const isAiModelMenuOpen = ref(false);

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
];
</script>

<template>
  <div
    ref="menuRef"
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @contextmenu.prevent
  >
    <button
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
        {
          'bg-secondary border-l-2 border-l-primary':
            currentTriggerMode === 'auto',
        },
      ]"
      @click="handleSetTriggerMode('auto')"
    >
      <Zap
        :size="14"
        :class="
          currentTriggerMode === 'auto' ? 'text-primary' : 'text-foreground'
        "
      />
      <span
        :class="[
          'font-mono',
          currentTriggerMode === 'auto'
            ? 'text-primary font-semibold'
            : 'text-foreground',
        ]"
      >
        自動觸發 (Auto)
      </span>
    </button>

    <button
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
        {
          'bg-secondary border-l-2 border-l-primary':
            currentTriggerMode === 'direct',
        },
      ]"
      @click="handleSetTriggerMode('direct')"
    >
      <ArrowRight
        :size="14"
        :class="
          currentTriggerMode === 'direct' ? 'text-primary' : 'text-foreground'
        "
      />
      <span
        :class="[
          'font-mono',
          currentTriggerMode === 'direct'
            ? 'text-primary font-semibold'
            : 'text-foreground',
        ]"
      >
        直接觸發 (Direct)
      </span>
    </button>

    <button
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
        {
          'bg-secondary border-l-2 border-l-primary':
            currentTriggerMode === 'ai-decide',
        },
      ]"
      @click="handleSetTriggerMode('ai-decide')"
    >
      <Brain
        :size="14"
        :class="
          currentTriggerMode === 'ai-decide'
            ? 'text-primary'
            : 'text-foreground'
        "
      />
      <span
        :class="[
          'font-mono',
          currentTriggerMode === 'ai-decide'
            ? 'text-primary font-semibold'
            : 'text-foreground',
        ]"
      >
        AI 判斷 (AI Decide)
      </span>
    </button>

    <div class="border-t border-border my-1" />

    <!-- Summary Model 子選單觸發器 -->
    <div
      class="relative"
      @mouseenter="isSummaryMenuOpen = true"
      @mouseleave="isSummaryMenuOpen = false"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isSummaryMenuOpen }"
      >
        <span class="font-mono text-foreground">Summary Model</span>
        <ChevronRight :size="12" class="text-muted-foreground" />
      </button>

      <!-- 子選單 -->
      <div
        v-if="isSummaryMenuOpen"
        class="absolute left-full top-0 ml-1 bg-card border border-doodle-ink rounded-md p-1 z-50 min-w-[120px]"
      >
        <button
          v-for="option in MODEL_OPTIONS"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary':
                currentSummaryModel === option.value,
            },
          ]"
          @click="handleSetSummaryModel(option.value)"
        >
          <span
            :class="[
              'font-mono',
              currentSummaryModel === option.value
                ? 'text-primary font-semibold'
                : 'text-foreground',
            ]"
          >
            {{ option.label }}
          </span>
        </button>
      </div>
    </div>

    <!-- AI Model 子選單觸發器 -->
    <div
      class="relative"
      :class="{
        'opacity-50 pointer-events-none': currentTriggerMode !== 'ai-decide',
      }"
      @mouseenter="
        currentTriggerMode === 'ai-decide' && (isAiModelMenuOpen = true)
      "
      @mouseleave="
        currentTriggerMode === 'ai-decide' && (isAiModelMenuOpen = false)
      "
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isAiModelMenuOpen }"
      >
        <span class="font-mono text-foreground">AI Model</span>
        <ChevronRight :size="12" class="text-muted-foreground" />
      </button>

      <!-- 子選單 -->
      <div
        v-if="isAiModelMenuOpen"
        class="absolute left-full top-0 ml-1 bg-card border border-doodle-ink rounded-md p-1 z-50 min-w-[120px]"
      >
        <button
          v-for="option in MODEL_OPTIONS"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary':
                currentAiDecideModel === option.value,
            },
          ]"
          @click="handleSetAiDecideModel(option.value)"
        >
          <span
            :class="[
              'font-mono',
              currentAiDecideModel === option.value
                ? 'text-primary font-semibold'
                : 'text-foreground',
            ]"
          >
            {{ option.label }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
