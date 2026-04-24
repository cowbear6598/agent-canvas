<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAllProviders } from "@/integration/providerRegistry";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
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
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("integration.select.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ $t("integration.select.title") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-2 py-2">
        <button
          v-for="category in categories"
          :key="category.name"
          class="flex w-full cursor-pointer items-center gap-4 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
          @click="handleSelect(category.name)"
        >
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"
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
