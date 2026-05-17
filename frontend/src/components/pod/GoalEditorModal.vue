<script setup lang="ts">
import { ref } from "vue";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GripVertical, Plus, Target, Trash2 } from "lucide-vue-next";
import { VueDraggable } from "vue-draggable-plus";
import type { Pod, PodGoal } from "@/types";
import { useGoalEditorForm } from "@/composables/pod/useGoalEditorForm";
import type { GoalEditorTodo } from "@/composables/pod/useGoalEditorForm";
import GoalTodoEditorModal from "@/components/pod/GoalTodoEditorModal.vue";
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
  removeTodo,
  reset,
  buildSubmitGoal,
  appendTodo,
  updateTodo,
} = useGoalEditorForm(() => props.pod.goal ?? null);

const subModalOpen = ref(false);
const subModalMode = ref<"add" | "edit">("add");
const subModalInitialText = ref("");
const editingTodoId = ref<string | null>(null);

const handleClose = (): void => {
  reset();
  emit("update:open", false);
};

const handleSubmit = (): void => {
  const goal = buildSubmitGoal();
  if (goal === false) return;
  emit("submit", goal);
};

const handleOpenAdd = (): void => {
  subModalMode.value = "add";
  subModalInitialText.value = "";
  editingTodoId.value = null;
  subModalOpen.value = true;
};

const handleOpenEdit = (todo: GoalEditorTodo): void => {
  subModalMode.value = "edit";
  subModalInitialText.value = todo.text;
  editingTodoId.value = todo.id;
  subModalOpen.value = true;
};

const handleSubModalSave = (text: string): void => {
  if (subModalMode.value === "add") {
    appendTodo(text);
  } else if (editingTodoId.value) {
    updateTodo(editingTodoId.value, text);
  }
  subModalOpen.value = false;
};

const previewLine = (text: string): string => text.split("\n")[0] ?? "";
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Target :size="18" />
          <span>
            {{ t("pod.goal.editor.title", { name: pod.name }) }}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div class="space-y-3">
        <VueDraggable
          v-model="todos"
          handle=".goal-card__handle"
          :animation="180"
          ghost-class="sortable-ghost"
          chosen-class="sortable-chosen"
          class="goal-editor-list"
        >
          <div
            v-for="todo in todos"
            :key="todo.id"
            class="goal-card"
            data-testid="goal-card-preview"
            @click="handleOpenEdit(todo)"
          >
            <button
              type="button"
              class="goal-card__handle"
              :title="t('pod.goal.editor.dragHandle')"
              @click.stop
            >
              <GripVertical :size="16" />
            </button>
            <span class="goal-card__preview">
              {{ previewLine(todo.text) }}
            </span>
            <button
              type="button"
              class="goal-card__delete"
              :title="t('pod.goal.editor.removeTodo')"
              @click.stop="removeTodo(todo.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </VueDraggable>

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
            @click="handleOpenAdd"
          >
            <Plus :size="14" />
            <span>{{ t("pod.goal.editor.addTodo") }}</span>
          </button>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="handleClose">
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

      <GoalTodoEditorModal
        :open="subModalOpen"
        :mode="subModalMode"
        :initial-text="subModalInitialText"
        @update:open="(value: boolean) => (subModalOpen = value)"
        @save="handleSubModalSave"
        @cancel="subModalOpen = false"
      />
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.goal-editor-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.goal-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 2px solid var(--doodle-ink);
  border-radius: 0.5rem;
  background: var(--card);
  transition: background 0.15s ease;
  cursor: pointer;
}

.goal-card:hover {
  background: var(--doodle-sand);
}

.goal-card__handle,
.goal-card__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--doodle-ink);
  background: var(--card);
  border-radius: 0.5rem;
}

.goal-card__delete {
  cursor: pointer;
}

.goal-card__handle {
  cursor: grab;
}

.goal-card__handle:active {
  cursor: grabbing;
}

.goal-card__preview {
  display: block;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
  min-width: 0;
}

.goal-card.sortable-ghost {
  opacity: 0.4;
  background: var(--doodle-sand);
}

.goal-card.sortable-chosen {
  box-shadow: 2px 3px 0 0 var(--doodle-ink);
}

.goal-editor-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border: 2px solid var(--doodle-ink);
  background: var(--doodle-sand);
  border-radius: 0.5rem;
  font-family: var(--font-mono), monospace, sans-serif;
  font-size: 0.75rem;
  padding: 0.5rem 0.75rem;
}

.goal-editor-validation {
  font-size: 0.75rem;
  color: oklch(0.52 0.18 25);
  font-family: var(--font-mono), monospace, sans-serif;
}
</style>
