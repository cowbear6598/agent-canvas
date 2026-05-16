import { computed, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { GoalTodoItem, PodGoal } from "@/types";
import { generateUUID } from "@/services/utils";
import { t } from "@/i18n";

export type GoalEditorTodo = GoalTodoItem;

function createEmptyTodo(): GoalEditorTodo {
  return {
    id: generateUUID(),
    text: "",
  };
}

function cloneGoalTodos(goal: PodGoal | null | undefined): GoalEditorTodo[] {
  if (!goal?.todos?.length) return [createEmptyTodo()];
  return goal.todos.map((todo) => ({
    id: todo.id,
    text: todo.text,
  }));
}

export function useGoalEditorForm(
  sourceGoal: () => PodGoal | null | undefined,
): {
  todos: Ref<GoalEditorTodo[]>;
  validationMessage: Ref<string>;
  canClear: ComputedRef<boolean>;
  addTodo: () => void;
  moveTodo: (index: number, direction: "up" | "down") => void;
  removeTodo: (todoId: string) => void;
  reset: () => void;
  buildSubmitGoal: () => PodGoal | null | false;
} {
  const todos = ref<GoalEditorTodo[]>([]);
  const validationMessage = ref("");

  const reset = (): void => {
    todos.value = cloneGoalTodos(sourceGoal());
    validationMessage.value = "";
  };

  watch(sourceGoal, reset, { immediate: true });

  const canClear = computed(() =>
    todos.value.some((todo) => todo.text.trim().length > 0),
  );

  const addTodo = (): void => {
    todos.value.push(createEmptyTodo());
    validationMessage.value = "";
  };

  const moveTodo = (index: number, direction: "up" | "down"): void => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= todos.value.length) return;

    const next = [...todos.value];
    const [movedTodo] = next.splice(index, 1);
    if (!movedTodo) return;
    next.splice(targetIndex, 0, movedTodo);
    todos.value = next;
  };

  const removeTodo = (todoId: string): void => {
    todos.value = todos.value.filter((todo) => todo.id !== todoId);
    validationMessage.value = "";
    if (todos.value.length === 0) {
      todos.value = [createEmptyTodo()];
    }
  };

  const buildSubmitGoal = (): PodGoal | null | false => {
    const normalizedTodos = todos.value.map((todo) => ({
      id: todo.id,
      text: todo.text.trim(),
    }));

    // 全部空白視為清空 Goal（Goal 已改為可選，無待辦時等同於 null）
    const hasAnyText = normalizedTodos.some((todo) => todo.text.length > 0);
    if (!hasAnyText) {
      validationMessage.value = "";
      return null;
    }

    if (normalizedTodos.some((todo) => todo.text.length === 0)) {
      validationMessage.value = t("pod.goal.editor.validation.noEmptyRows");
      return false;
    }

    validationMessage.value = "";
    return {
      todos: normalizedTodos,
    };
  };

  return {
    todos,
    validationMessage,
    canClear,
    addTodo,
    moveTodo,
    removeTodo,
    reset,
    buildSubmitGoal,
  };
}
