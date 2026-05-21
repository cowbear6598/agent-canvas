import { defineStore } from "pinia";
import type { GoalTodoItem } from "@/types";
import { generateUUID } from "@/services/utils";

interface GoalClipboardState {
  todos: GoalTodoItem[];
}

export const useGoalClipboardStore = defineStore("goalClipboard", {
  state: (): GoalClipboardState => ({
    todos: [],
  }),

  getters: {
    isEmpty: (state): boolean => state.todos.length === 0,
  },

  actions: {
    setGoalTodos(todos: GoalTodoItem[]): void {
      this.todos = todos.map((todo) => ({ id: todo.id, text: todo.text }));
    },

    clear(): void {
      this.todos = [];
    },

    cloneAsNewTodos(): GoalTodoItem[] {
      return this.todos.map((todo) => ({
        id: generateUUID(),
        text: todo.text,
      }));
    },
  },
});
