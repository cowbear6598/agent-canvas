<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import { getAllProviders } from "@/integration/providerRegistry";

interface Props {
  open: boolean;
  showBackButton?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  back: [];
  select: [category: string];
}>();

const categories = getAllProviders();

const handleSelect = (categoryId: string): void => {
  emit("update:open", false);
  emit("select", categoryId);
};

const handleClose = (): void => {
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="doodle-modal-surface max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @back="emit('back')"
          />
          {{ $t("integration.select.title") }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ $t("integration.select.title") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <button
          v-for="category in categories"
          :key="category.name"
          class="doodle-action doodle-action--row flex w-full cursor-pointer items-center gap-4"
          @click="handleSelect(category.name)"
        >
          <span
            class="doodle-icon-tile"
          >
            <component
              :is="category.icon"
              class="h-5 w-5"
            />
          </span>
          <span class="text-sm font-semibold">{{ category.label }}</span>
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
