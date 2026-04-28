<script setup lang="ts">
import type { TriggerMode } from "@/types/connection";
import type { ModelType } from "@/types/pod";
import { Zap, Brain, ArrowRight, ChevronRight } from "lucide-vue-next";
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import {
  DEFAULT_TOAST_DURATION_MS,
  SHORT_TOAST_DURATION_MS,
} from "@/lib/constants";

interface Props {
  position: { x: number; y: number };
  connectionId: string;
  currentTriggerMode: TriggerMode;
  /** currentSummaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  currentSummaryModel: string;
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
const podStore = usePodStore();
const providerCapabilityStore = useProviderCapabilityStore();
const { toast } = useToast();
const { t } = useI18n();

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
      auto: t("canvas.connectionContextMenu.triggerModeAutoLabel"),
      "ai-decide": t("canvas.connectionContextMenu.triggerModeAiDecideLabel"),
      direct: t("canvas.connectionContextMenu.triggerModeDirectLabel"),
    };
    toast({
      title: t("canvas.connectionContextMenu.triggerModeChanged"),
      description: t("canvas.connectionContextMenu.triggerModeChangedDesc", {
        mode: modeTextMap[targetMode],
      }),
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("trigger-mode-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.triggerModeChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

/** 顯示模型切換成功的 toast */
const showModelChangeToast = (title: string, label: string): void => {
  toast({
    title,
    description: t("canvas.connectionContextMenu.modelSwitched", {
      model: label,
    }),
    duration: SHORT_TOAST_DURATION_MS,
  });
};

/** 發送模型變更事件並關閉選單 */
const emitModelChanged = (
  eventName: "summary-model-changed" | "ai-decide-model-changed",
): void => {
  if (eventName === "summary-model-changed") {
    emit("summary-model-changed");
  } else {
    emit("ai-decide-model-changed");
  }
  emit("close");
};

const handleSetModel = async (
  targetModel: string,
  currentModel: string,
  updateFn: (connectionId: string, model: string) => Promise<unknown>,
  successTitle: string,
  failDesc: string,
  changedEvent: "summary-model-changed" | "ai-decide-model-changed",
  displayLabel?: string,
): Promise<void> => {
  if (targetModel === currentModel) {
    emit("close");
    return;
  }

  const result = await updateFn(props.connectionId, targetModel);

  if (result) {
    showModelChangeToast(successTitle, displayLabel ?? targetModel);
    emitModelChanged(changedEvent);
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: failDesc,
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

/**
 * Summary Model 的 toast 訊息使用動態 label（由 availableModels 的 label 欄位提供），
 * 以支援 Claude 以外的 provider 模型（value 可為任意 provider model 字串）。
 * 呼叫端確保傳入的值來自 summaryModelOptions，後端接受任意 provider model 字串。
 */
const handleSetSummaryModel = (
  targetValue: string,
  displayLabel: string,
): Promise<void> =>
  handleSetModel(
    targetValue,
    props.currentSummaryModel,
    connectionStore.updateConnectionSummaryModel,
    t("canvas.connectionContextMenu.summaryModelChanged"),
    t("canvas.connectionContextMenu.summaryModelChangeFailed"),
    "summary-model-changed",
    displayLabel,
  );

const handleSetAiDecideModel = (option: {
  value: ModelType;
  label: string;
}): Promise<void> =>
  handleSetModel(
    option.value,
    props.currentAiDecideModel,
    connectionStore.updateConnectionAiDecideModel,
    t("canvas.connectionContextMenu.aiDecideModelChanged"),
    t("canvas.connectionContextMenu.aiDecideModelChangeFailed"),
    "ai-decide-model-changed",
    option.label,
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
  // 清理子選單延遲關閉 timer，避免 unmount 後 timer 仍觸發
  if (summaryMenuCloseTimer.value !== null) {
    clearTimeout(summaryMenuCloseTimer.value);
  }
  if (aiModelMenuCloseTimer.value !== null) {
    clearTimeout(aiModelMenuCloseTimer.value);
  }
});

const isSummaryMenuOpen = ref(false);
const isAiModelMenuOpen = ref(false);

/**
 * 子選單 hover 關閉延遲（180ms）：
 * 避免滑鼠從觸發項往子選單移動途中（經過 menu 背景或微小 gap）誤觸 mouseleave 而關閉。
 * 同時解決 Mac IME 候選視窗出現時 pointer hit-test 被劫持導致誤關的問題。
 */
const SUBMENU_CLOSE_DELAY_MS = 180;
const summaryMenuCloseTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const aiModelMenuCloseTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const openSummaryMenu = (): void => {
  if (summaryMenuCloseTimer.value !== null) {
    clearTimeout(summaryMenuCloseTimer.value);
    summaryMenuCloseTimer.value = null;
  }
  isSummaryMenuOpen.value = true;
};

const closeSummaryMenuDelayed = (): void => {
  summaryMenuCloseTimer.value = setTimeout(() => {
    isSummaryMenuOpen.value = false;
    summaryMenuCloseTimer.value = null;
  }, SUBMENU_CLOSE_DELAY_MS);
};

const openAiModelMenu = (): void => {
  if (aiModelMenuCloseTimer.value !== null) {
    clearTimeout(aiModelMenuCloseTimer.value);
    aiModelMenuCloseTimer.value = null;
  }
  isAiModelMenuOpen.value = true;
};

const closeAiModelMenuDelayed = (): void => {
  aiModelMenuCloseTimer.value = setTimeout(() => {
    isAiModelMenuOpen.value = false;
    aiModelMenuCloseTimer.value = null;
  }, SUBMENU_CLOSE_DELAY_MS);
};

/**
 * AI Decide Model 子選單專用：硬編碼 Claude 三選一。
 * 不受上游 provider 影響，始終顯示此固定清單。
 */
const AI_DECIDE_MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
];

/**
 * 透過當前 connectionId 取得 connection，再查 sourcePodId 對應的上游 Pod，
 * 最後向 providerCapabilityStore 取上游 provider 的 availableModels，
 * 作為 Summary Model 子選單的動態按鈕資料來源。
 */
const summaryModelOptions = computed(() => {
  const connection = connectionStore.findConnectionById(props.connectionId);
  if (!connection?.sourcePodId) return null;

  const sourcePod = podStore.getPodById(connection.sourcePodId);
  if (!sourcePod) return null;

  const models = providerCapabilityStore.getAvailableModels(sourcePod.provider);
  // 若後端尚未推送 capability 資料，回傳 null 觸發「載入中」顯示
  if (models.length === 0) return null;

  return models;
});
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
        {{ $t("canvas.connectionContextMenu.triggerModeAuto") }}
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
        {{ $t("canvas.connectionContextMenu.triggerModeDirect") }}
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
        {{ $t("canvas.connectionContextMenu.triggerModeAiDecide") }}
      </span>
    </button>

    <div class="border-t border-border my-1" />

    <!-- Summary Model 子選單觸發器 -->
    <!-- @mouseenter/@mouseleave 改用延遲函式，避免滑鼠途經間隙或 IME 視窗時誤關 -->
    <div
      class="relative"
      @mouseenter="openSummaryMenu"
      @mouseleave="closeSummaryMenuDelayed"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isSummaryMenuOpen }"
      >
        <span class="font-mono text-foreground">{{
          $t("canvas.connectionContextMenu.summaryModel")
        }}</span>
        <ChevronRight
          :size="12"
          class="text-muted-foreground"
        />
      </button>

      <!-- Summary Model 子選單：根據上游 Pod provider 動態渲染
           移除 ml-1（4px gap），改在浮層加 pl-1 撐出等價的視覺空間，
           確保滑鼠從觸發項移往子選單時不會觸發 mouseleave -->
      <div
        v-if="isSummaryMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="openSummaryMenu"
        @mouseleave="closeSummaryMenuDelayed"
      >
        <div
          class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
        >
          <!-- 上游 Pod 不存在或 capability 尚未載入時顯示載入中提示 -->
          <div
            v-if="summaryModelOptions === null"
            class="px-2 py-1 text-xs font-mono text-muted-foreground"
          >
            {{ $t("canvas.connectionContextMenu.loading") }}
          </div>

          <!-- 動態渲染上游 provider 的可選模型清單 -->
          <button
            v-for="option in summaryModelOptions ?? []"
            :key="option.value"
            :class="[
              'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
              {
                'bg-secondary border-l-2 border-l-primary':
                  currentSummaryModel === option.value,
              },
            ]"
            @click="handleSetSummaryModel(option.value, option.label)"
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
    </div>

    <!-- AI Model 子選單觸發器 -->
    <!-- @mouseenter/@mouseleave 改用延遲函式，避免滑鼠途經間隙或 IME 視窗時誤關 -->
    <div
      class="relative"
      :class="{
        'opacity-50 pointer-events-none': currentTriggerMode !== 'ai-decide',
      }"
      @mouseenter="currentTriggerMode === 'ai-decide' && openAiModelMenu()"
      @mouseleave="
        currentTriggerMode === 'ai-decide' && closeAiModelMenuDelayed()
      "
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isAiModelMenuOpen }"
      >
        <span class="font-mono text-foreground">{{
          $t("canvas.connectionContextMenu.aiModel")
        }}</span>
        <ChevronRight
          :size="12"
          class="text-muted-foreground"
        />
      </button>

      <!-- 子選單：移除 ml-1（4px gap），改用 pl-1 撐出等價視覺空間 -->
      <div
        v-if="isAiModelMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="openAiModelMenu"
        @mouseleave="closeAiModelMenuDelayed"
      >
        <div
          class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
        >
          <!-- AI Decide Model 子選單：始終硬編碼 Claude 三選一，不受上游 provider 影響 -->
          <button
            v-for="option in AI_DECIDE_MODEL_OPTIONS"
            :key="option.value"
            :class="[
              'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
              {
                'bg-secondary border-l-2 border-l-primary':
                  currentAiDecideModel === option.value,
              },
            ]"
            @click="handleSetAiDecideModel(option)"
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
  </div>
</template>
