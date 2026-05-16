<script setup lang="ts">
import type { PodProvider } from "@/types/pod";
import { computed } from "vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  provider: PodProvider;
  model: string;
  disabled?: boolean;
  disabledTooltip?: string;
}>();

const emit = defineEmits<{
  "update:provider": [provider: PodProvider];
  "update:model": [model: string];
}>();

const { t } = useI18n();
const providerCapabilityStore = useProviderCapabilityStore();

/**
 * 硬編碼三項 provider 選項，刻意不從 allowedProviders 動態取得。
 * 理由：新增 provider 時 UI 顯示順序與 label 仍需人工確認，避免靜默變動選單內容。
 * 與 ConnectionContextMenu 的 PROVIDER_OPTIONS 保持相同設計原則。
 */
const PROVIDER_OPTIONS: { value: PodProvider; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

/**
 * 依當前 provider 取得可選模型清單。
 * getAvailableModels 在 capability 尚未載入時回傳空陣列；
 * 此處回傳 null 讓 template 以單一條件判斷「尚未就緒」並顯示載入中提示。
 */
const availableModels = computed(() => {
  const models = providerCapabilityStore.getAvailableModels(props.provider);
  if (models.length === 0) return null;
  return models;
});

/**
 * 切換 provider 時，同時 emit 新 provider 與該 provider 的預設模型，
 * 確保 provider/model 不會在切換過渡期間不一致。
 * getDefaultModel 在 capability 尚未載入時回傳 undefined；
 * 呼叫端應自行處理 undefined 的 fallback（如顯示載入中或使用系統預設值）。
 */
const handleProviderSelect = (targetProvider: PodProvider): void => {
  if (targetProvider === props.provider) return;

  const defaultModel = providerCapabilityStore.getDefaultModel(targetProvider);
  emit("update:provider", targetProvider);
  // defaultModel 若為 undefined，仍 emit 讓呼叫端決定 fallback 策略
  if (defaultModel !== undefined) {
    emit("update:model", defaultModel);
  }
};

const handleModelSelect = (targetModel: string): void => {
  if (targetModel === props.model) return;
  emit("update:model", targetModel);
};
</script>

<template>
  <div
    class="bg-card border border-doodle-ink rounded-md p-1 min-w-[140px]"
    :class="{ 'opacity-50 pointer-events-none': disabled }"
    :title="disabled ? disabledTooltip : undefined"
  >
    <!-- Provider 區塊 -->
    <div class="px-2 py-1 text-xs font-mono text-muted-foreground">
      {{ t("shared.providerModelSelector.providerLabel") }}
    </div>

    <button
      v-for="option in PROVIDER_OPTIONS"
      :key="option.value"
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
        {
          'bg-secondary border-l-2 border-l-primary': option.value === provider,
        },
      ]"
      @click="handleProviderSelect(option.value)"
    >
      <span
        :class="[
          'font-mono',
          option.value === provider
            ? 'text-primary font-semibold'
            : 'text-foreground',
        ]"
      >
        {{ option.label }}
      </span>
    </button>

    <div class="border-t border-border my-1" />

    <!-- Model 區塊 -->
    <div class="px-2 py-1 text-xs font-mono text-muted-foreground">
      {{ t("shared.providerModelSelector.modelLabel") }}
    </div>

    <!-- capability 尚未載入時顯示載入中提示 -->
    <div
      v-if="availableModels === null"
      class="px-2 py-1 text-xs font-mono text-muted-foreground"
    >
      {{ t("common.loading") }}
    </div>

    <!-- 依當前 provider 動態渲染可選模型清單 -->
    <button
      v-for="option in availableModels ?? []"
      :key="option.value"
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
        {
          'bg-secondary border-l-2 border-l-primary': option.value === model,
        },
      ]"
      @click="handleModelSelect(option.value)"
    >
      <span
        :class="[
          'font-mono',
          option.value === model
            ? 'text-primary font-semibold'
            : 'text-foreground',
        ]"
      >
        {{ option.label }}
      </span>
    </button>
  </div>
</template>
