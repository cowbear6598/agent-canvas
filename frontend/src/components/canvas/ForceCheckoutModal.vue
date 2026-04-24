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
  targetBranch: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  cancel: [];
  "force-checkout": [];
}>();

const { t } = useI18n();

const handleCancel = (): void => {
  emit("cancel");
  emit("update:open", false);
};

const handleForceCheckout = (): void => {
  emit("force-checkout");
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.forceCheckout.title") }}</DialogTitle>
        <DialogDescription class="space-y-3">
          <WarningBox
            :title="t('canvas.forceCheckout.uncommittedWarningTitle')"
            :description="
              t('canvas.forceCheckout.uncommittedWarningDesc', {
                branch: props.targetBranch,
              })
            "
          />
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          @click="handleCancel"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="handleForceCheckout"
        >
          {{ $t("canvas.forceCheckout.forceCheckoutButton") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
