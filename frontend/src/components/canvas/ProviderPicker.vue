<script setup lang="ts">
// Provider 選擇器：讓使用者選擇 Claude 或 Codex 作為新 Pod 的 provider
// providerConfig 改由 providerCapabilityStore.getDefaultOptions 提供，不再 hardcode 預設 model
import { computed } from "vue";
import AnthropicLogo from "@/components/icons/AnthropicLogo.vue";
import OpenAILogo from "@/components/icons/OpenAILogo.vue";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useToast } from "@/composables/useToast";

const providerStore = useProviderCapabilityStore();
const { toast } = useToast();

const emit = defineEmits<{
  select: [payload: { provider: PodProvider; providerConfig: ProviderConfig }];
}>();

/**
 * 從 store 取得指定 provider 的 model 字串。
 * 若 metadata 尚未載入（getDefaultOptions 回 undefined）或 defaultOptions 無 model 欄位，回傳 undefined。
 */
function resolveModel(provider: PodProvider): string | undefined {
  const opts = providerStore.getDefaultOptions(provider);
  if (
    opts === undefined ||
    typeof opts["model"] !== "string" ||
    opts["model"] === ""
  ) {
    return undefined;
  }
  return opts["model"] as string;
}

/**
 * Claude 按鈕是否應 disabled：metadata 尚未載入時 disable。
 */
const isClaudeDisabled = computed((): boolean => {
  return resolveModel("claude") === undefined;
});

/**
 * Codex 按鈕是否應 disabled：metadata 尚未載入時 disable。
 */
const isCodexDisabled = computed((): boolean => {
  return resolveModel("codex") === undefined;
});

/**
 * 顯示「Provider 載入中」提示 toast（metadata 尚未就緒時使用）。
 */
function showLoadingToast(): void {
  toast({
    title: "Provider",
    description: "Provider 載入中，請稍候",
    variant: "default",
  });
}

/** 選 Claude → 從 store 取預設 model 後 emit select；若 metadata 未就緒則顯示提示 */
const handleSelectClaude = (): void => {
  const model = resolveModel("claude");
  if (model === undefined) {
    showLoadingToast();
    return;
  }
  emit("select", {
    provider: "claude",
    providerConfig: { model },
  });
};

/** 選 Codex → 從 store 取預設 model 後 emit select；若 metadata 未就緒則顯示提示 */
const handleSelectCodex = (): void => {
  const model = resolveModel("codex");
  if (model === undefined) {
    showLoadingToast();
    return;
  }
  emit("select", {
    provider: "codex",
    providerConfig: { model },
  });
};
</script>

<template>
  <div class="pod-menu-submenu" @contextmenu.prevent>
    <!--
      Claude 選項：metadata 未載入時 disabled。
      點擊事件掛在外層 div，確保 disabled 狀態下仍可顯示 toast 提示；
      原生 disabled button 不觸發 click 事件，所以需外層代理。
    -->
    <div @click="handleSelectClaude">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isClaudeDisabled"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <AnthropicLogo :size="16" />
        </span>
        <span class="font-mono">Claude</span>
      </button>
    </div>

    <!--
      Codex 選項：metadata 未載入時 disabled。
      同上，點擊事件掛在外層 div 代理。
    -->
    <div @click="handleSelectCodex">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isCodexDisabled"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <OpenAILogo :size="16" class="text-black" />
        </span>
        <span class="font-mono">Codex</span>
      </button>
    </div>
  </div>
</template>
