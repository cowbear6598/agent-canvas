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
import { useModalForm } from "@/composables/useModalForm";
import { validateResourceName } from "@/lib/validators";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  repositoryName: string;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [worktreeName: string];
}>();

const { t } = useI18n();

const {
  inputValue: worktreeName,
  errorMessage,
  handleSubmit,
  handleClose,
} = useModalForm<string>({
  validator: (name) =>
    validateResourceName(
      name.trim(),
      t("canvas.worktree.nameRequired"),
      t("canvas.worktree.nameInvalid"),
    ),
  onSubmit: async (name) => {
    emit("submit", name.trim());
    emit("update:open", false);
    return null;
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
        <DialogTitle>{{ $t("canvas.worktree.createTitle") }}</DialogTitle>
        <DialogDescription>
          {{
            $t("canvas.worktree.createDescription", { name: repositoryName })
          }}
        </DialogDescription>
      </DialogHeader>

      <div>
        <label class="text-sm font-medium">{{
          $t("canvas.worktree.nameLabel")
        }}</label>
        <Input
          v-model="worktreeName"
          :placeholder="$t('canvas.worktree.namePlaceholder')"
          @keyup.enter="handleSubmit"
        />
      </div>

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
          @click="handleSubmit"
        >
          {{ $t("common.confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
