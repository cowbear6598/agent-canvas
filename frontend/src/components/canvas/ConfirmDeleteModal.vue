<script setup lang="ts">
import { computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";

type ItemType =
  | "outputStyle"
  | "skill"
  | "repository"
  | "subAgent"
  | "command"
  | "mcpServer";
type GroupType = "outputStyleGroup" | "subAgentGroup" | "commandGroup";
type ExtendedItemType = ItemType | GroupType;

interface Props {
  open: boolean;
  itemName: string;
  isInUse: boolean;
  itemType: ExtendedItemType;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
}>();

const { t } = useI18n();

const dialogTitle = computed(() => {
  if (props.isInUse) return t("canvas.confirmDelete.cannotDelete");
  return t("common.confirmDelete");
});

const dialogDescription = computed(() => {
  if (props.isInUse) return t("canvas.confirmDelete.inUseMessage");
  return t("canvas.confirmDelete.confirmMessage", { name: props.itemName });
});

const handleClose = (): void => {
  emit("update:open", false);
};

const handleConfirm = (): void => {
  emit("confirm");
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ dialogDescription }}</DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <template v-if="isInUse">
          <Button
            variant="outline"
            @click="handleClose"
          >
            {{ $t("common.confirm") }}
          </Button>
        </template>
        <template v-else>
          <Button
            variant="outline"
            @click="handleClose"
          >
            {{ $t("common.cancel") }}
          </Button>
          <Button
            variant="destructive"
            @click="handleConfirm"
          >
            {{ $t("common.delete") }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
