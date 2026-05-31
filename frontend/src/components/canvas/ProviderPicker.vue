<script setup lang="ts">
import AnthropicLogo from "@/components/icons/AnthropicLogo.vue";
import OpenAILogo from "@/components/icons/OpenAILogo.vue";
import OpencodeLogo from "@/components/icons/OpencodeLogo.vue";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import {
  isProviderSelectionDisabled,
  resolveDefaultProviderConfig,
} from "@/lib/providerSelection";

const providerStore = useProviderCapabilityStore();
const { toast } = useToast();
const { t } = useI18n();

const emit = defineEmits<{
  select: [payload: { provider: PodProvider; providerConfig: ProviderConfig }];
}>();

function isProviderDisabled(provider: PodProvider): boolean {
  return isProviderSelectionDisabled(providerStore, provider);
}

/**
 * 顯示 disabled 原因 toast。
 * - opencode 無 alias 對應 → 引導使用者去 LLM Provider 設定新增
 * - 其他 provider metadata 未就緒 → 顯示「Provider 載入中」
 */
function showDisabledToast(provider: PodProvider): void {
  toast({
    title: t("shared.providerModelSelector.providerLabel"),
    description:
      provider === "opencode"
        ? t("pod.modelSelector.opencode.emptyPlaceholder")
        : t("pod.provider.loadingHint"),
    variant: "default",
  });
}

/**
 * 通用 provider 選擇 handler。
 * 從 store 取得指定 provider 的預設 model 後 emit select；若 metadata 未就緒則顯示提示。
 * 未來新增 provider 不需複製此函式，只在模板中以 inline 方式呼叫即可。
 */
function handleSelectProvider(provider: PodProvider): void {
  const providerConfig = resolveDefaultProviderConfig(providerStore, provider);
  if (!providerConfig) {
    showDisabledToast(provider);
    return;
  }
  emit("select", {
    provider,
    providerConfig,
  });
}
</script>

<template>
  <div
    class="pod-menu-submenu"
    @contextmenu.prevent
  >
    <!-- 外層 div 代理 click：disabled button 不觸發 click，需在 wrapper 上聽 -->
    <div @click="() => handleSelectProvider('claude')">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isProviderDisabled('claude')"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <AnthropicLogo :size="16" />
        </span>
        <span class="font-mono">Claude</span>
      </button>
    </div>

    <div @click="() => handleSelectProvider('codex')">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isProviderDisabled('codex')"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <OpenAILogo
            :size="16"
            class="text-black"
          />
        </span>
        <span class="font-mono">Codex</span>
      </button>
    </div>

    <div @click="() => handleSelectProvider('opencode')">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isProviderDisabled('opencode')"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <OpencodeLogo :size="16" />
        </span>
        <span class="font-mono">Opencode</span>
      </button>
    </div>
  </div>
</template>
