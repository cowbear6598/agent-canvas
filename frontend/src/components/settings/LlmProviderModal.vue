<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft } from "lucide-vue-next";
import OpencodeSettingsPanel from "@/components/settings/OpencodeSettingsPanel.vue";

type Step = "home" | "opencode";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const step = ref<Step>("home");

const handleClose = (): void => {
  step.value = "home";
  emit("update:open", false);
};

const handleCardClick = (target: Step): void => {
  step.value = target;
};

const handleBack = (): void => {
  step.value = "home";
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("llmProvider.modal.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("llmProvider.modal.title") }}
        </DialogDescription>
      </DialogHeader>

      <!-- 首頁：列出 provider card -->
      <div
        v-if="step === 'home'"
        class="space-y-3 py-2"
      >
        <!-- opencode card -->
        <button
          class="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleCardClick('opencode')"
        >
          <div class="font-medium">
            {{ t("llmProvider.card.opencode.title") }}
          </div>
          <div class="mt-1 text-sm text-muted-foreground">
            {{ t("llmProvider.card.opencode.description") }}
          </div>
        </button>
      </div>

      <!-- opencode 設定畫面：返回按鈕固定在頂端，設定面板區可獨立滾動 -->
      <div
        v-else-if="step === 'opencode'"
        class="flex max-h-[70vh] flex-col gap-3 py-2"
      >
        <!-- 返回按鈕（不滾動） -->
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 px-1 shrink-0"
          @click="handleBack"
        >
          <ArrowLeft class="h-4 w-4" />
          <span>{{ t("llmProvider.modal.backButton") }}</span>
        </Button>

        <!-- opencode 設定面板（內容過長時走專案自訂的 ScrollArea） -->
        <ScrollArea class="flex-1 pr-3">
          <OpencodeSettingsPanel />
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>
</template>
