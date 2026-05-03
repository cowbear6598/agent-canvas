<script setup lang="ts">
// Provider 選擇器：讓使用者選擇 Claude 或 Codex 作為新 Pod 的 provider
// providerConfig 改由 providerCapabilityStore.getDefaultOptions 提供，不再 hardcode 預設 model
import AnthropicLogo from "@/components/icons/AnthropicLogo.vue";
import OpenAILogo from "@/components/icons/OpenAILogo.vue";
import GeminiLogo from "@/components/icons/GeminiLogo.vue";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";

const providerStore = useProviderCapabilityStore();
const { toast } = useToast();
const { t } = useI18n();

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
 * 指定 provider 的按鈕是否應 disabled：metadata 尚未載入時 disable。
 * 以 provider 動態查詢，未來新增 provider 只需更新模板，不需複製 computed。
 */
function isProviderDisabled(provider: PodProvider): boolean {
  return resolveModel(provider) === undefined;
}

/**
 * 顯示「Provider 載入中」提示 toast（metadata 尚未就緒時使用）。
 */
function showLoadingToast(): void {
  toast({
    title: "Provider",
    description: t("pod.provider.loadingHint"),
    variant: "default",
  });
}

/**
 * 通用 provider 選擇 handler。
 * 從 store 取得指定 provider 的預設 model 後 emit select；若 metadata 未就緒則顯示提示。
 * 未來新增 provider 不需複製此函式，只在模板中以 inline 方式呼叫即可。
 */
function handleSelectProvider(provider: PodProvider): void {
  const model = resolveModel(provider);
  if (model === undefined) {
    showLoadingToast();
    return;
  }
  emit("select", {
    provider,
    providerConfig: { model },
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

    <div @click="() => handleSelectProvider('gemini')">
      <button
        class="pod-menu-submenu-item flex items-center gap-3"
        :disabled="isProviderDisabled('gemini')"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink bg-white flex-shrink-0"
        >
          <GeminiLogo :size="16" />
        </span>
        <span class="font-mono">Gemini</span>
      </button>
    </div>
  </div>
</template>
