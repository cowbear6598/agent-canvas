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
import { ArrowDown, ArrowUp, Plus, Target, Trash2 } from "lucide-vue-next";
import type { Pod, PodGoal } from "@/types";
import { useGoalEditorForm } from "@/composables/pod/useGoalEditorForm";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  open: boolean;
  pod: Pod;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [goal: PodGoal | null];
}>();

const { t } = useI18n();

const {
  todos,
  validationMessage,
  canClear,
  addTodo,
  moveTodo,
  removeTodo,
  reset,
  buildSubmitGoal,
} = useGoalEditorForm(() => props.pod.goal ?? null);

const handleClose = (): void => {
  reset();
  emit("update:open", false);
};

const handleSubmit = (): void => {
  const goal = buildSubmitGoal();
  if (goal === false) return;
  emit("submit", goal);
};

const handleClear = (): void => {
  emit("submit", null);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Target :size="18" />
          <span>
            {{ t("pod.goal.editor.title", { name: pod.name }) }}
          </span>
        </DialogTitle>
        <DialogDescription>
          {{ t("pod.goal.editor.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div
          v-for="(todo, index) in todos"
          :key="todo.id"
          class="goal-editor-row"
        >
          <span class="goal-editor-row__index">
            {{ index + 1 }}
          </span>
          <input
            v-model="todo.text"
            data-testid="goal-editor-input"
            :placeholder="t('pod.goal.editor.todoPlaceholder', { index: index + 1 })"
            class="goal-editor-row__input"
          >
          <div class="goal-editor-row__actions">
            <button
              type="button"
              class="goal-editor-row__icon-btn"
              :disabled="index === 0"
              :title="t('pod.goal.editor.moveUp')"
              @click="moveTodo(index, 'up')"
            >
              <ArrowUp :size="14" />
            </button>
            <button
              type="button"
              class="goal-editor-row__icon-btn"
              :disabled="index === todos.length - 1"
              :title="t('pod.goal.editor.moveDown')"
              @click="moveTodo(index, 'down')"
            >
              <ArrowDown :size="14" />
            </button>
            <button
              type="button"
              class="goal-editor-row__icon-btn"
              :title="t('pod.goal.editor.removeTodo')"
              @click="removeTodo(todo.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <p
          v-if="validationMessage"
          class="goal-editor-validation"
          data-testid="goal-editor-validation"
        >
          {{ validationMessage }}
        </p>

        <div class="flex items-center justify-between gap-2">
          <button
            type="button"
            class="goal-editor-add-btn"
            data-testid="goal-editor-add"
            @click="addTodo"
          >
            <Plus :size="14" />
            <span>{{ t("pod.goal.editor.addTodo") }}</span>
          </button>

          <button
            type="button"
            class="goal-editor-clear-btn"
            :disabled="!canClear"
            data-testid="goal-editor-clear"
            @click="handleClear"
          >
            {{ t("pod.goal.editor.clearGoal") }}
          </button>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ t("common.cancel") }}
        </Button>
        <Button
          data-testid="goal-editor-save"
          variant="default"
          @click="handleSubmit"
        >
          {{ t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.goal-editor-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
}

.goal-editor-row__index {
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  text-align: center;
}

.goal-editor-row__input {
  width: 100%;
  min-width: 0;
  padding: 0.75rem 0.875rem;
  background: var(--card);
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.875rem;
  outline: none;
}

.goal-editor-row__input:focus {
  box-shadow: 0 0 0 2px oklch(0.75 0.07 90 / 0.35);
}

.goal-editor-row__actions {
  display: inline-flex;
  gap: 0.375rem;
}

.goal-editor-row__icon-btn,
.goal-editor-add-btn,
.goal-editor-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border: 2px solid var(--doodle-ink);
  background: var(--card);
  border-radius: 0.5rem;
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.75rem;
}

.goal-editor-row__icon-btn {
  width: 2rem;
  height: 2rem;
}

.goal-editor-add-btn,
.goal-editor-clear-btn {
  padding: 0.5rem 0.75rem;
}

.goal-editor-add-btn {
  background: var(--doodle-sand);
}

.goal-editor-clear-btn {
  color: oklch(0.45 0.12 25);
}

.goal-editor-row__icon-btn:disabled,
.goal-editor-clear-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.goal-editor-validation {
  font-size: 0.75rem;
  color: oklch(0.52 0.18 25);
  font-family: var(--font-mono), monospace, sans-serif;
}
</style>
