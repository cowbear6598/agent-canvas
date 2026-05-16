import type { ContentBlock } from "../types/message.js";
import type { GoalTodoItem, Pod, PodGoal } from "../types/pod.js";

export type GoalRuntimeStatus = "running" | "blocked" | "completed";

export interface GoalRuntimeState {
  todoOrder: string[];
  activeTodoId: string | null;
  completedTodoIds: string[];
  status: GoalRuntimeStatus;
  blockedReason: string | null;
  handoffSummary: string | null;
}

export const GOAL_REQUIRED_MESSAGE = "請先設定 Goal 再執行這個 Pod";

function getGoalTodoMap(goal: PodGoal): Map<string, GoalTodoItem> {
  return new Map(goal.todos.map((todo) => [todo.id, todo]));
}

export function createGoalRuntimeState(
  goal: PodGoal | null | undefined,
): GoalRuntimeState | null {
  if (!goal?.todos.length) return null;

  const todoOrder = goal.todos.map((todo) => todo.id);
  return {
    todoOrder,
    activeTodoId: todoOrder[0] ?? null,
    completedTodoIds: [],
    status: "running",
    blockedReason: null,
    handoffSummary: null,
  };
}

export function completeGoalTodo(
  goal: PodGoal,
  state: GoalRuntimeState,
  todoId: string = state.activeTodoId ?? "",
  handoffSummary: string | null = null,
): GoalRuntimeState {
  const todoMap = getGoalTodoMap(goal);
  if (!todoMap.has(todoId)) return state;

  const completedTodoIds = state.completedTodoIds.includes(todoId)
    ? state.completedTodoIds
    : [...state.completedTodoIds, todoId];
  const activeTodoId =
    state.todoOrder.find((id) => !completedTodoIds.includes(id)) ?? null;

  return {
    ...state,
    activeTodoId,
    completedTodoIds,
    status: activeTodoId ? "running" : "completed",
    blockedReason: null,
    handoffSummary,
  };
}

export function blockGoalRuntime(
  state: GoalRuntimeState,
  blockedReason: string,
  handoffSummary: string | null = null,
): GoalRuntimeState {
  return {
    ...state,
    status: "blocked",
    blockedReason,
    handoffSummary,
  };
}

export function serializeGoalForPrompt(
  goal: PodGoal | null | undefined,
): string | null {
  if (!goal?.todos.length) return null;

  return goal.todos.map((todo, index) => `${index + 1}. ${todo.text}`).join("\n");
}

function buildGoalExecutionHeader(
  pod: Pick<Pod, "name" | "goal">,
): string | null {
  const serializedGoal = serializeGoalForPrompt(pod.goal);
  if (!serializedGoal) return null;

  const runtimeState = createGoalRuntimeState(pod.goal);
  const activeTodoText =
    runtimeState?.activeTodoId &&
    pod.goal?.todos.find((todo) => todo.id === runtimeState.activeTodoId)?.text;

  const lines = [
    "<goal_runtime>",
    `Pod「${pod.name}」本次執行的 Goal：`,
    serializedGoal,
    activeTodoText
      ? `請先從目前 active todo 開始：${activeTodoText}`
      : "若 Goal 已全部完成，請整理結果並清楚回報。",
    "請依序推進 todos；若被阻塞，請明確說明阻塞原因與下一步建議。",
    "</goal_runtime>",
    "",
  ];

  return lines.join("\n");
}

export function prependGoalExecutionContext(
  pod: Pick<Pod, "name" | "goal">,
  message: string | ContentBlock[],
): string | ContentBlock[] {
  const goalHeader = buildGoalExecutionHeader(pod);
  if (!goalHeader) return message;

  if (typeof message === "string") {
    return goalHeader + message;
  }

  const firstTextIndex = message.findIndex((block) => block.type === "text");
  if (firstTextIndex === -1) {
    return [{ type: "text", text: goalHeader }, ...message];
  }

  return message.map((block, index) => {
    if (index === firstTextIndex && block.type === "text") {
      return { ...block, text: goalHeader + block.text };
    }
    return block;
  });
}
