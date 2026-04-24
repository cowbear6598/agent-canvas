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
import { Input } from "@/components/ui/input";
import { useRepositoryStore } from "@/stores/note";
import { useModalForm } from "@/composables/useModalForm";
import { validateResourceName } from "@/lib/validators";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  created: [repository: { id: string; name: string }];
}>();

const { t } = useI18n();

const repositoryStore = useRepositoryStore();

const {
  inputValue: folderName,
  isSubmitting,
  errorMessage,
  handleSubmit,
  handleClose,
} = useModalForm<string>({
  validator: (name) =>
    validateResourceName(
      name,
      t("canvas.repository.nameRequired"),
      t("canvas.repository.nameInvalid"),
    ),
  onSubmit: async (name) => {
    const result = await repositoryStore.createRepository(name);
    if (result.success && result.repository) {
      emit("created", result.repository);
      emit("update:open", false);
      return null;
    }
    return result.error || t("canvas.repository.createFailed");
  },
  onClose: () => emit("update:open", false),
});
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.repository.createTitle") }}</DialogTitle>
        <DialogDescription>
          {{ $t("canvas.repository.createDescription") }}
        </DialogDescription>
      </DialogHeader>

      <Input
        v-model="folderName"
        placeholder="folder_name"
        @keyup.enter="handleSubmit"
      />

      <p
        v-if="errorMessage"
        class="text-sm text-destructive"
      >
        {{ errorMessage }}
      </p>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          :disabled="isSubmitting"
          @click="handleSubmit"
        >
          {{ $t("common.create") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
