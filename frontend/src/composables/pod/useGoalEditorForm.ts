import { ref, watch } from "vue";
import type { Ref } from "vue";
import type { GoalTodoItem, PodGoal } from "@/types";
import { generateUUID } from "@/services/utils";

export type GoalEditorTodo = GoalTodoItem;

function cloneGoalTodos(goal: PodGoal | null | undefined): GoalEditorTodo[] {
  if (!goal?.todos?.length) return [];
  return goal.todos.map((todo) => ({
    id: todo.id,
    text: todo.text,
  }));
}

export function useGoalEditorForm(
  sourceGoal: () => PodGoal | null | undefined,
  t: (key: string) => string,
): {
  todos: Ref<GoalEditorTodo[]>;
  validationMessage: Ref<string>;
  updateTodo: (todoId: string, text: string) => void;
  appendTodo: (text: string) => void;
  removeTodo: (todoId: string) => void;
  replaceTodos: (newTodos: GoalEditorTodo[]) => void;
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

  const updateTodo = (todoId: string, text: string): void => {
    const todo = todos.value.find((t) => t.id === todoId);
    if (!todo) return;
    todo.text = text;
    validationMessage.value = "";
  };

  const appendTodo = (text: string): void => {
    todos.value.push({ id: generateUUID(), text });
    validationMessage.value = "";
  };

  const removeTodo = (todoId: string): void => {
    todos.value = todos.value.filter((todo) => todo.id !== todoId);
    validationMessage.value = "";
  };

  const replaceTodos = (newTodos: GoalEditorTodo[]): void => {
    todos.value = newTodos;
    validationMessage.value = "";
  };

  const buildSubmitGoal = (): PodGoal | null | false => {
    // 清單為空視為清空 Goal（Goal 已改為可選，無待辦時等同於 null）
    if (todos.value.length === 0) {
      validationMessage.value = "";
      return null;
    }

    // 任一 todo 的 text 為空白則擋下送出
    const hasEmptyTodo = todos.value.some((todo) => todo.text.trim() === "");
    if (hasEmptyTodo) {
      validationMessage.value = t("pod.goal.editor.validation.noEmptyRows");
      return false;
    }

    const normalizedTodos = todos.value.map((todo) => ({
      id: todo.id,
      text: todo.text.trim(),
    }));

    validationMessage.value = "";
    return {
      todos: normalizedTodos,
    };
  };

  return {
    todos,
    validationMessage,
    updateTodo,
    appendTodo,
    removeTodo,
    replaceTodos,
    reset,
    buildSubmitGoal,
  };
}
