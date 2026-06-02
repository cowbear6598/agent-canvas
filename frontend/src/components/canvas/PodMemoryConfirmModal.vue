<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import WarningBox from "@/components/ui/WarningBox.vue";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  podName: string;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("canvas.podMemoryConfirm.clearTitle") }}</DialogTitle>
        <DialogDescription class="space-y-3">
          <p>
            {{
              t("canvas.podMemoryConfirm.description", {
                name: podName,
              })
            }}
          </p>
          <WarningBox
            :title="t('canvas.podMemoryConfirm.clearWarningTitle')"
            :description="t('canvas.podMemoryConfirm.clearWarningDescription')"
          />
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          @click="emit('update:open', false)"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="emit('confirm')"
        >
          {{ t("canvas.podMemoryConfirm.clearConfirmButton") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
