import { describe, expect, it } from "vitest";
import {
  blockGoalRuntime,
  completeGoalTodo,
  createGoalRuntimeState,
  prependGoalExecutionContext,
  serializeGoalForPrompt,
} from "../../src/services/goalRuntime.js";

const goal = {
  todos: [
    { id: "todo-1", text: "Collect requirements" },
    { id: "todo-2", text: "Implement changes" },
  ],
};

describe("goalRuntime", () => {
  it("createGoalRuntimeState 應以第一個 todo 作為 active", () => {
    const state = createGoalRuntimeState(goal);

    expect(state).toEqual({
      todoOrder: ["todo-1", "todo-2"],
      activeTodoId: "todo-1",
      completedTodoIds: [],
      status: "running",
      blockedReason: null,
      handoffSummary: null,
    });
  });

  it("completeGoalTodo 應推進到下一個 todo，全部完成後標記 completed", () => {
    const initial = createGoalRuntimeState(goal)!;
    const afterFirst = completeGoalTodo(goal, initial);
    const afterSecond = completeGoalTodo(goal, afterFirst);

    expect(afterFirst.activeTodoId).toBe("todo-2");
    expect(afterFirst.completedTodoIds).toEqual(["todo-1"]);
    expect(afterFirst.status).toBe("running");

    expect(afterSecond.activeTodoId).toBeNull();
    expect(afterSecond.completedTodoIds).toEqual(["todo-1", "todo-2"]);
    expect(afterSecond.status).toBe("completed");
  });

  it("blockGoalRuntime 應保留目前進度並記錄阻塞原因", () => {
    const state = createGoalRuntimeState(goal)!;
    const blocked = blockGoalRuntime(state, "Missing API token", "Need auth");

    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedReason).toBe("Missing API token");
    expect(blocked.handoffSummary).toBe("Need auth");
    expect(blocked.activeTodoId).toBe("todo-1");
  });

  it("serializeGoalForPrompt / prependGoalExecutionContext 應產生 Goal 導向 prompt", () => {
    expect(serializeGoalForPrompt(goal)).toBe(
      "1. Collect requirements\n2. Implement changes",
    );

    const prompt = prependGoalExecutionContext(
      { name: "Planner", goal },
      "Please start now",
    ) as string;

    expect(prompt).toContain("<goal_runtime>");
    expect(prompt).toContain("Collect requirements");
    expect(prompt).toContain("Implement changes");
    expect(prompt).toContain("Please start now");
  });
});
