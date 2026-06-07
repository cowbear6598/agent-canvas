<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import OpencodeSettingsPanel from "@/components/settings/OpencodeSettingsPanel.vue";

interface Props {
  open: boolean;
  showBackButton?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  back: [];
}>();

const { t } = useI18n();

const handleClose = (): void => {
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @back="emit('back')"
          />
          {{ t("llmProvider.modal.title") }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("llmProvider.modal.title") }}
        </DialogDescription>
      </DialogHeader>

      <div
        class="flex max-h-[70vh] flex-col gap-3 py-2"
      >
        <ScrollArea class="flex-1 pr-3">
          <OpencodeSettingsPanel />
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>
</template>
