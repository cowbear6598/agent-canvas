<script setup lang="ts">
import type { TriggerMode } from "@/types/connection";
import type { ModelType, PodProvider } from "@/types/pod";
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
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";

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
    const triggerModeLabels: Record<TriggerMode, string> = {
      auto: t("canvas.connectionContextMenu.triggerModeAutoLabel"),
      "ai-decide": t("canvas.connectionContextMenu.triggerModeAiDecideLabel"),
      direct: t("canvas.connectionContextMenu.triggerModeDirectLabel"),
    };
    toast({
      title: t("canvas.connectionContextMenu.triggerModeChanged"),
      description: t("canvas.connectionContextMenu.triggerModeChangedDesc", {
        mode: triggerModeLabels[targetMode],
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

interface SetModelOptions {
  targetModel: string;
  currentModel: string;
  updateFn: (connectionId: string, model: string) => Promise<unknown>;
  successTitle: string;
  failDesc: string;
  changedEvent: "summary-model-changed" | "ai-decide-model-changed";
  displayLabel?: string;
}

const handleSetModel = async (options: SetModelOptions): Promise<void> => {
  const {
    targetModel,
    currentModel,
    updateFn,
    successTitle,
    failDesc,
    changedEvent,
    displayLabel,
  } = options;

  if (targetModel === currentModel) {
    emit("close");
    return;
  }

  const result = await updateFn(props.connectionId, targetModel);

  if (result) {
    showModelChangeToast(successTitle, displayLabel ?? targetModel);
    // 透過分支縮窄 changedEvent union type，讓 TypeScript emit overload 能正確解析
    if (changedEvent === "summary-model-changed") {
      emit("summary-model-changed");
    } else if (changedEvent === "ai-decide-model-changed") {
      emit("ai-decide-model-changed");
    }
    emit("close");
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
  handleSetModel({
    targetModel: targetValue,
    currentModel: props.currentSummaryModel,
    updateFn: connectionStore.updateConnectionSummaryModel,
    successTitle: t("canvas.connectionContextMenu.summaryModelChanged"),
    failDesc: t("canvas.connectionContextMenu.summaryModelChangeFailed"),
    changedEvent: "summary-model-changed",
    displayLabel,
  });

const handleSetAiDecideModel = (option: {
  value: ModelType;
  label: string;
}): Promise<void> =>
  handleSetModel({
    targetModel: option.value,
    currentModel: props.currentAiDecideModel,
    updateFn: connectionStore.updateConnectionAiDecideModel,
    successTitle: t("canvas.connectionContextMenu.aiDecideModelChanged"),
    failDesc: t("canvas.connectionContextMenu.aiDecideModelChangeFailed"),
    changedEvent: "ai-decide-model-changed",
    displayLabel: option.label,
  });

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

/** ai-model 觸發器區塊的 mouseenter handler */
const handleAiModelMenuEnter = (): void => {
  if (props.currentTriggerMode === "ai-decide") {
    isAiModelMenuOpen.value = true;
  }
};

/** ai-model 觸發器區塊的 mouseleave handler */
const handleAiModelMenuLeave = (): void => {
  if (props.currentTriggerMode === "ai-decide") {
    isAiModelMenuOpen.value = false;
  }
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
 * Summary Provider 子選單的選項清單。
 * 刻意硬編碼三項而非從 providerCapabilityStore.allowedProviders 動態取得，
 * 理由是後續若新增 provider，UI 顯示順序與 label 仍要人工確認，避免靜默變動 menu 內容。
 */
const PROVIDER_OPTIONS: { value: PodProvider; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

/**
 * 當前 connectionId 對應的 Connection 快照。
 * 所有需要查 connection 欄位的 computed / 函式共用此結果，
 * 避免 v-for 渲染時對 connections 陣列做多次線性掃描。
 */
const connection = computed(() =>
  connectionStore.findConnectionById(props.connectionId),
);

/**
 * 當前 Summary 使用的 provider，優先取 connection.summaryProvider，
 * 若為 null/undefined（舊 Connection）則 fallback 為來源 Pod 的 provider。
 * connection 或 sourcePod 任一不存在時回傳 undefined，讓 template 顯示載入中。
 */
const currentProvider = computed((): PodProvider | undefined => {
  const conn = connection.value;
  if (!conn?.sourcePodId) return undefined;

  const sourcePod = podStore.getPodById(conn.sourcePodId);
  if (!sourcePod) return undefined;

  return conn.summaryProvider ?? sourcePod.provider;
});

/**
 * 透過當前 connectionId 取得 connection，再查 sourcePodId 對應的上游 Pod，
 * 最後向 providerCapabilityStore 取 currentProvider 的 availableModels，
 * 作為 Summary Model 子選單的動態按鈕資料來源。
 * 模型清單依 currentProvider 而非固定取上游 Pod provider，支援 Summary Provider 解耦。
 */
const summaryModelOptions = computed(() => {
  const provider = currentProvider.value;
  if (!provider) return null;

  const models = providerCapabilityStore.getAvailableModels(provider);
  // 回傳 null（而非空陣列）是為了讓 template 能以單一條件判斷「資料尚未就緒」並顯示載入中
  if (models.length === 0) return null;

  return models;
});

/**
 * 判斷 Summary Model 按鈕是否為 active 狀態的雙欄位比對邏輯。
 * 對舊 Connection（connection.summaryProvider 為 null/undefined）：
 *   active 僅比對 model，因為 currentProvider 此時來自來源 Pod，model 比對仍合理。
 * 對已設定 summaryProvider 的 Connection：
 *   active 需同時比對 provider 與 model，避免 provider 切換後舊 model 名稱仍被標亮。
 * 直接取 connection.value（shared computed），v-for 中 2 次呼叫不再重新掃描陣列。
 */
const isSummaryModelActive = (optionValue: string): boolean => {
  const conn = connection.value;

  if (conn?.summaryProvider == null) {
    // 舊 Connection：summaryProvider 未設定，僅以 model 值比對
    return props.currentSummaryModel === optionValue;
  }

  // 新 Connection：需同時確認 currentProvider 與儲存的 summaryProvider 一致，再比對 model
  return (
    currentProvider.value === conn.summaryProvider &&
    props.currentSummaryModel === optionValue
  );
};

/** Summary Provider 子選單開關狀態 */
const isProviderMenuOpen = ref(false);

/**
 * 切換 Summary Provider 的 handler。
 * 若選擇與當前相同的 provider，直接關閉選單不送請求。
 * 透過 getDefaultModel 取得新 provider 的預設模型，一併更新。
 */
const handleSetSummaryProvider = async (
  targetProvider: PodProvider,
): Promise<void> => {
  if (targetProvider === currentProvider.value) {
    emit("close");
    return;
  }

  const defaultModel = providerCapabilityStore.getDefaultModel(targetProvider);
  // getDefaultModel 可能回傳 undefined（metadata 尚未載入時），
  // 此時 fallback 為系統預設的 summaryModel，由後端進一步驗證合法性
  const summaryModel = defaultModel ?? DEFAULT_SUMMARY_MODEL;

  const result = await connectionStore.updateConnectionSummaryProvider(
    props.connectionId,
    targetProvider,
    summaryModel,
  );

  if (result) {
    const providerLabel =
      PROVIDER_OPTIONS.find((o) => o.value === targetProvider)?.label ??
      targetProvider;
    const modelLabel =
      providerCapabilityStore
        .getAvailableModels(targetProvider)
        .find((m) => m.value === summaryModel)?.label ?? summaryModel;

    toast({
      title: t("canvas.connectionContextMenu.summaryProviderChanged"),
      description: t(
        "canvas.connectionContextMenu.summaryProviderChangedDesc",
        { provider: providerLabel, model: modelLabel ?? "" },
      ),
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("summary-model-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.summaryModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};
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

    <!-- Summary Provider 子選單觸發器（位於 Summary Model 子選單上方） -->
    <div
      class="relative"
      @mouseenter="isProviderMenuOpen = true"
      @mouseleave="isProviderMenuOpen = false"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isProviderMenuOpen }"
      >
        <span class="font-mono text-foreground">{{
          $t("canvas.connectionContextMenu.summaryProvider")
        }}</span>
        <ChevronRight :size="12" class="text-muted-foreground" />
      </button>

      <!-- Summary Provider 子選單：硬編碼三項，不過濾認證狀態
           移除 ml-1（4px gap），改在浮層加 pl-1 撐出等價的視覺空間，
           確保滑鼠從觸發項移往子選單時不會觸發 mouseleave -->
      <div
        v-if="isProviderMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="isProviderMenuOpen = true"
        @mouseleave="isProviderMenuOpen = false"
      >
        <div
          class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
        >
          <!-- currentProvider 尚未就緒時顯示載入中提示 -->
          <div
            v-if="currentProvider === undefined"
            class="px-2 py-1 text-xs font-mono text-muted-foreground"
          >
            {{ $t("canvas.connectionContextMenu.loading") }}
          </div>

          <!-- 硬編碼三項 provider 選項，active 以 currentProvider 判定 -->
          <button
            v-for="option in PROVIDER_OPTIONS"
            :key="option.value"
            :class="[
              'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
              {
                'bg-secondary border-l-2 border-l-primary':
                  option.value === currentProvider,
              },
            ]"
            @click="handleSetSummaryProvider(option.value)"
          >
            <span
              :class="[
                'font-mono',
                option.value === currentProvider
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
        <span class="font-mono text-foreground">{{
          $t("canvas.connectionContextMenu.summaryModel")
        }}</span>
        <ChevronRight :size="12" class="text-muted-foreground" />
      </button>

      <!-- Summary Model 子選單：根據上游 Pod provider 動態渲染
           移除 ml-1（4px gap），改在浮層加 pl-1 撐出等價的視覺空間，
           確保滑鼠從觸發項移往子選單時不會觸發 mouseleave -->
      <div
        v-if="isSummaryMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="isSummaryMenuOpen = true"
        @mouseleave="isSummaryMenuOpen = false"
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

          <!-- 動態渲染 currentProvider 的可選模型清單，active 以雙欄位比對邏輯判定 -->
          <button
            v-for="option in summaryModelOptions ?? []"
            :key="option.value"
            :class="[
              'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
              {
                'bg-secondary border-l-2 border-l-primary':
                  isSummaryModelActive(option.value),
              },
            ]"
            @click="handleSetSummaryModel(option.value, option.label)"
          >
            <span
              :class="[
                'font-mono',
                isSummaryModelActive(option.value)
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
    <div
      class="relative"
      :class="{
        'opacity-50 pointer-events-none': currentTriggerMode !== 'ai-decide',
      }"
      @mouseenter="handleAiModelMenuEnter"
      @mouseleave="handleAiModelMenuLeave"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isAiModelMenuOpen }"
      >
        <span class="font-mono text-foreground">{{
          $t("canvas.connectionContextMenu.aiModel")
        }}</span>
        <ChevronRight :size="12" class="text-muted-foreground" />
      </button>

      <!-- 子選單：移除 ml-1（4px gap），改用 pl-1 撐出等價視覺空間 -->
      <div
        v-if="isAiModelMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="isAiModelMenuOpen = true"
        @mouseleave="isAiModelMenuOpen = false"
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
