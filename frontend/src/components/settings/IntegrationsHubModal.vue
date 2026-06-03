<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bot, Cpu, Puzzle, SlidersHorizontal } from "lucide-vue-next";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  // 開啟 MCP 管理子 modal（ManagedMcpModal）
  "select-mcp": [];
  // 開啟 Plugin 管理子 modal（ManagedPluginModal）
  "select-plugin": [];
  // 開啟 LLM Provider 設定子 modal（LlmProviderModal）
  "select-llm-provider": [];
  // 開啟 Model 設定子 modal（ModelSettingsModal）
  "select-model-settings": [];
}>();

const { t } = useI18n();

const handleClose = (): void => {
  emit("update:open", false);
};

const handleSelectMcp = (): void => {
  emit("update:open", false);
  emit("select-mcp");
};

const handleSelectPlugin = (): void => {
  emit("update:open", false);
  emit("select-plugin");
};

const handleSelectLlmProvider = (): void => {
  emit("update:open", false);
  emit("select-llm-provider");
};

const handleSelectModelSettings = (): void => {
  emit("update:open", false);
  emit("select-model-settings");
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("integrationsHub.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("integrationsHub.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid grid-cols-2 gap-3 py-2 sm:grid-cols-4">
        <!-- MCP 管理卡片 -->
        <button
          class="flex flex-col items-center gap-2 rounded-md border border-doodle-ink/20 bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleSelectMcp"
        >
          <Bot class="h-7 w-7" />
          <span
            class="flex min-h-[2.5em] items-center justify-center text-center text-sm font-medium leading-tight"
          >
            {{ t("integrationsHub.cards.mcp") }}
          </span>
        </button>

        <!-- Plugin 管理卡片 -->
        <button
          class="flex flex-col items-center gap-2 rounded-md border border-doodle-ink/20 bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleSelectPlugin"
        >
          <Puzzle class="h-7 w-7" />
          <span
            class="flex min-h-[2.5em] items-center justify-center text-center text-sm font-medium leading-tight"
          >
            {{ t("integrationsHub.cards.plugin") }}
          </span>
        </button>

        <!-- LLM Provider 卡片 -->
        <button
          class="flex flex-col items-center gap-2 rounded-md border border-doodle-ink/20 bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleSelectLlmProvider"
        >
          <Cpu class="h-7 w-7" />
          <span
            class="flex min-h-[2.5em] items-center justify-center text-center text-sm font-medium leading-tight"
          >
            {{ t("integrationsHub.cards.llmProvider") }}
          </span>
        </button>

        <!-- Model 設定卡片 -->
        <button
          class="flex flex-col items-center gap-2 rounded-md border border-doodle-ink/20 bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleSelectModelSettings"
        >
          <SlidersHorizontal class="h-7 w-7" />
          <span
            class="flex min-h-[2.5em] items-center justify-center text-center text-sm font-medium leading-tight"
          >
            {{ t("integrationsHub.cards.modelSettings") }}
          </span>
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
