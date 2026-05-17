<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  open: boolean;
  mode: "add" | "edit";
  initialText: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  save: [text: string];
  cancel: [];
}>();

const { t } = useI18n();

const localText = ref(props.initialText);

watch(
  () => [props.open, props.initialText] as const,
  ([open, text]) => {
    if (open) {
      localText.value = text;
    }
  },
  { immediate: true },
);

const handleSave = (): void => {
  const trimmed = localText.value.trim();
  if (trimmed.length === 0) return;
  emit("save", trimmed);
  emit("update:open", false);
};

const handleCancel = (): void => {
  emit("cancel");
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="
      (value: boolean) => {
        if (!value) handleCancel();
      }
    "
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "add"
              ? t("pod.goal.editor.subModal.titleAdd")
              : t("pod.goal.editor.subModal.titleEdit")
          }}
        </DialogTitle>
      </DialogHeader>

      <textarea
        v-model="localText"
        class="goal-todo-editor__textarea doodle-textarea"
        data-testid="goal-todo-editor-textarea"
        :placeholder="t('pod.goal.editor.subModal.placeholder')"
      />

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          data-testid="goal-todo-editor-cancel"
          @click="handleCancel"
        >
          {{ t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          data-testid="goal-todo-editor-save"
          @click="handleSave"
        >
          {{ t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.goal-todo-editor__textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 8rem;
  padding: 0.75rem 0.875rem;
  background: var(--card);
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.875rem;
  outline: none;
  resize: vertical;
}

.goal-todo-editor__textarea:focus {
  box-shadow: 0 0 0 2px oklch(0.75 0.07 90 / 0.35);
}
</style>
