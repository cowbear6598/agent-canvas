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

interface Props {
  open: boolean;
  branchName: string;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const handleConfirm = (): void => {
  emit("confirm");
};

const handleCancel = (): void => {
  emit("cancel");
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.deleteBranch.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("canvas.deleteBranch.description", { name: branchName }) }}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleCancel"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="handleConfirm"
        >
          {{ $t("common.delete") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
