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
import WarningBox from "@/components/ui/WarningBox.vue";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  repositoryName: string;
  mode: "clear" | "delete";
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
}>();

const { t } = useI18n();

const titleKey = computed(() =>
  props.mode === "clear"
    ? "canvas.repositoryMemoryConfirm.clearTitle"
    : "canvas.repositoryMemoryConfirm.deleteTitle",
);

const warningTitleKey = computed(() =>
  props.mode === "clear"
    ? "canvas.repositoryMemoryConfirm.clearWarningTitle"
    : "canvas.repositoryMemoryConfirm.deleteWarningTitle",
);

const warningDescriptionKey = computed(() =>
  props.mode === "clear"
    ? "canvas.repositoryMemoryConfirm.clearWarningDescription"
    : "canvas.repositoryMemoryConfirm.deleteWarningDescription",
);

const confirmButtonKey = computed(() =>
  props.mode === "clear"
    ? "canvas.repositoryMemoryConfirm.clearConfirmButton"
    : "canvas.repositoryMemoryConfirm.deleteConfirmButton",
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t(titleKey) }}</DialogTitle>
        <DialogDescription class="space-y-3">
          <p>
            {{
              t("canvas.repositoryMemoryConfirm.description", {
                name: repositoryName,
              })
            }}
          </p>
          <WarningBox
            :title="t(warningTitleKey)"
            :description="t(warningDescriptionKey)"
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
          {{ t(confirmButtonKey) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
