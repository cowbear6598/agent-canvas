import { afterEach, describe, expect, it } from "vitest";
import {
  GOAL_MCP_SERVER_NAME,
  GOAL_MCP_TOOL_NAMES,
  blockGoalRuntime,
  buildGoalRuntimeMcpListItem,
  buildGoalRuntimeMcpServerConfig,
  buildGoalRuntimeActiveTodoResult,
  buildGoalRuntimeToolFullName,
  canonicalizeGoalRuntimeToolName,
  completeGoalTodo,
  consumeGoalRuntimeToolResult,
  createGoalRuntimeState,
  ensureGoalRuntime,
  forceBlockGoalRuntime,
  formatGoalTodos,
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
  removeGoalRuntimeRun,
} from "../../src/services/goalRuntime.js";

const goal = {
  todos: [
    { id: "todo-1", text: "Collect requirements" },
    { id: "todo-2", text: "Implement changes" },
  ],
};

const pod = {
  id: "pod-goal-001",
  name: "Planner",
  goal,
};

const noGoalPod = {
  id: "pod-no-goal-001",
  name: "Executor",
  goal: null,
};

const runContext = {
  runId: "run-goal-runtime-test",
  canvasId: "canvas-001",
  sourcePodId: "pod-goal-001",
};

afterEach(() => {
  removeGoalRuntimeRun(runContext.runId);
});

describe("goalRuntime", () => {
  it("createGoalRuntimeState 應以第一個 todo 作為 active", () => {
    const state = createGoalRuntimeState(goal);

    expect(state).toMatchObject({
      todoOrder: ["todo-1", "todo-2"],
      activeTodoId: "todo-1",
      completedTodoIds: [],
      status: "running",
      blockedReason: null,
      handoffSummary: null,
    });
    expect(state?.updatedAt).toEqual(expect.any(String));
  });

  it("createGoalRuntimeState 在沒有 Goal 時應回傳空的 completed 狀態", () => {
    const state = createGoalRuntimeState(null);

    expect(state).toMatchObject({
      todoOrder: [],
      activeTodoId: null,
      completedTodoIds: [],
      status: "completed",
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

  it("formatGoalTodos 應回傳給摘要服務使用的純文字 goal", () => {
    expect(formatGoalTodos(goal)).toBe(
      "1. Collect requirements\n2. Implement changes",
    );
  });

  it("buildGoalRuntimeMcpServerConfig 應建立固定名稱的內建 Goal MCP bridge", () => {
    const config = buildGoalRuntimeMcpServerConfig(runContext, pod);

    expect(config).not.toBeNull();
    expect(config?.name).toBe(GOAL_MCP_SERVER_NAME);
    expect(config?.command.length).toBeGreaterThan(0);
    expect(config?.args).toContain("--goal-bridge");
    expect(config?.env.AGENT_CANVAS_GOAL_STATE_PATH).toBe(
      getGoalRuntimeStatePath(runContext, pod.id),
    );
  });

  it("run snapshot 建立後應固定 goal，不受後續 pod goal 編輯影響", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    const editedPod = {
      ...pod,
      goal: {
        todos: [{ id: "todo-new", text: "Edited while running" }],
      },
    };

    const config = buildGoalRuntimeMcpServerConfig(runContext, editedPod);
    const persisted = readGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
    );

    expect(config?.name).toBe(GOAL_MCP_SERVER_NAME);
    expect(persisted?.goal.todos.map((todo) => todo.id)).toEqual([
      "todo-1",
      "todo-2",
    ]);
  });

  it("buildGoalRuntimeMcpServerConfig（compiled 模式）args 應只有 --goal-bridge", () => {
    const originalEnv = process.env.AGENT_CANVAS_COMPILED;
    try {
      process.env.AGENT_CANVAS_COMPILED = "1";
      const config = buildGoalRuntimeMcpServerConfig(runContext, pod);
      expect(config).not.toBeNull();
      expect(config?.command).toBe(process.execPath);
      expect(config?.args.length).toBe(1);
      expect(config?.args[0]).toBe("--goal-bridge");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AGENT_CANVAS_COMPILED;
      } else {
        process.env.AGENT_CANVAS_COMPILED = originalEnv;
      }
    }
  });

  it("buildGoalRuntimeMcpServerConfig（dev 模式）args 應有兩個元素且第二個為 --goal-bridge", () => {
    const originalEnv = process.env.AGENT_CANVAS_COMPILED;
    try {
      delete process.env.AGENT_CANVAS_COMPILED;
      const config = buildGoalRuntimeMcpServerConfig(runContext, pod);
      expect(config).not.toBeNull();
      expect(config?.args.length).toBe(2);
      expect(config?.args[1]).toBe("--goal-bridge");
      expect(config?.args[0]).toMatch(/cli\.ts$/);
    } finally {
      if (originalEnv !== undefined) {
        process.env.AGENT_CANVAS_COMPILED = originalEnv;
      }
    }
  });

  it("buildGoalRuntimeMcpListItem 應回傳 system/locked 與 active todo metadata", () => {
    const item = buildGoalRuntimeMcpListItem(pod);

    expect(item).toMatchObject({
      name: GOAL_MCP_SERVER_NAME,
      type: "stdio",
      system: true,
      locked: true,
      status: "running",
      activeTodoId: "todo-1",
      activeTodoText: "Collect requirements",
      completedCount: 0,
      totalCount: 2,
    });
  });

  it("buildGoalRuntimeActiveTodoResult 只回傳 active todo id 與文字", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);

    expect(buildGoalRuntimeActiveTodoResult(snapshot)).toEqual({
      activeTodoId: "todo-1",
      activeTodoText: "Collect requirements",
    });
  });

  it("buildGoalRuntimeActiveTodoResult 無 snapshot 時回傳空 active todo", () => {
    expect(buildGoalRuntimeActiveTodoResult(null)).toEqual({
      activeTodoId: null,
      activeTodoText: null,
    });
  });

  it("沒有 Goal 時仍應建立 Goal Runtime MCP metadata，並回報空狀態", () => {
    const item = buildGoalRuntimeMcpListItem(noGoalPod);

    expect(item).toMatchObject({
      name: GOAL_MCP_SERVER_NAME,
      type: "stdio",
      system: true,
      locked: true,
      status: "completed",
      activeTodoId: null,
      activeTodoText: null,
      completedCount: 0,
      totalCount: 0,
      description: "Goal Runtime 可用，但目前尚未設定 goal",
    });
  });

  it("沒有 Goal 時也應建立 run-scoped Goal MCP bridge", () => {
    const config = buildGoalRuntimeMcpServerConfig(runContext, noGoalPod);

    expect(config?.name).toBe(GOAL_MCP_SERVER_NAME);
    expect(config?.env.AGENT_CANVAS_GOAL_STATE_PATH).toBe(
      getGoalRuntimeStatePath(runContext, noGoalPod.id),
    );
  });

  it("consumeGoalRuntimeToolResult 應用 tool output 後，run-scoped 狀態檔應被更新", () => {
    ensureGoalRuntime(pod, runContext);

    const snapshot = consumeGoalRuntimeToolResult(
      runContext,
      pod,
      `mcp__${GOAL_MCP_SERVER_NAME}__${GOAL_MCP_TOOL_NAMES.COMPLETE_TODO}`,
      JSON.stringify({
        status: "running",
        activeTodoId: "todo-2",
        activeTodoText: "Implement changes",
        nextTodoId: "todo-2",
        nextTodoText: "Implement changes",
        completedTodoIds: ["todo-1"],
        blockedReason: null,
        handoffSummary: "Need implementation",
        completedCount: 1,
        totalCount: 2,
      }),
    );

    expect(snapshot?.state.activeTodoId).toBe("todo-2");
    expect(snapshot?.state.completedTodoIds).toEqual(["todo-1"]);
    expect(snapshot?.state.handoffSummary).toBe("Need implementation");

    const persisted = readGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
    );
    expect(persisted?.state.activeTodoId).toBe("todo-2");
    expect(persisted?.state.completedTodoIds).toEqual(["todo-1"]);
  });

  it("consumeGoalRuntimeToolResult 更新進度時不應用 live pod goal 覆蓋 run snapshot", () => {
    ensureGoalRuntime(pod, runContext);
    const editedPod = {
      ...pod,
      goal: {
        todos: [{ id: "todo-new", text: "Edited while running" }],
      },
    };

    const snapshot = consumeGoalRuntimeToolResult(
      runContext,
      editedPod,
      `mcp__${GOAL_MCP_SERVER_NAME}__${GOAL_MCP_TOOL_NAMES.COMPLETE_TODO}`,
      JSON.stringify({
        status: "running",
        activeTodoId: "todo-2",
        activeTodoText: "Implement changes",
        nextTodoId: null,
        nextTodoText: null,
        completedTodoIds: ["todo-1"],
        blockedReason: null,
        handoffSummary: null,
        completedCount: 1,
        totalCount: 2,
      }),
    );

    expect(snapshot?.goal.todos.map((todo) => todo.id)).toEqual([
      "todo-1",
      "todo-2",
    ]);
    expect(snapshot?.state.activeTodoId).toBe("todo-2");
  });

  it("consumeGoalRuntimeToolResult 應正規化已完成但殘留 activeTodoId 的狀態", () => {
    ensureGoalRuntime(pod, runContext);

    const snapshot = consumeGoalRuntimeToolResult(
      runContext,
      pod,
      `mcp__${GOAL_MCP_SERVER_NAME}__${GOAL_MCP_TOOL_NAMES.COMPLETE_TODO}`,
      JSON.stringify({
        status: "running",
        activeTodoId: "todo-2",
        activeTodoText: "Implement changes",
        nextTodoId: "todo-2",
        nextTodoText: "Implement changes",
        completedTodoIds: ["todo-2", "todo-1", "todo-1", "todo-3"],
        blockedReason: null,
        handoffSummary: "All tasks done",
        completedCount: 4,
        totalCount: 2,
      }),
    );

    expect(snapshot?.state.status).toBe("completed");
    expect(snapshot?.state.activeTodoId).toBeNull();
    expect(snapshot?.state.completedTodoIds).toEqual(["todo-1", "todo-2"]);

    const persisted = readGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
    );
    expect(persisted?.state.status).toBe("completed");
    expect(persisted?.state.activeTodoId).toBeNull();
    expect(persisted?.state.completedTodoIds).toEqual(["todo-1", "todo-2"]);
  });

  it("generic mcp wrapper + blockedReason input 應 canonicalize 為 block_goal_progress", () => {
    expect(
      canonicalizeGoalRuntimeToolName(
        "mcp__mcp__tool",
        { blockedReason: "Missing file" },
        null,
      ),
    ).toBe(buildGoalRuntimeToolFullName(GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS));
  });

  it("forceBlockGoalRuntime 應把現有 snapshot 改為 blocked 並保留 handoffSummary", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    const blocked = forceBlockGoalRuntime(runContext, pod, "達到 retry 上限");

    expect(blocked).not.toBeNull();
    expect(blocked?.state.status).toBe("blocked");
    expect(blocked?.state.blockedReason).toBe("達到 retry 上限");

    const persisted = readGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
    );
    expect(persisted?.state.status).toBe("blocked");
  });

  it("forceBlockGoalRuntime 在無 runContext 時應回 null", () => {
    expect(forceBlockGoalRuntime(undefined, pod, "any")).toBeNull();
  });

  it("generic mcp wrapper + structured output 應 canonicalize 為 get_goal_status", () => {
    expect(
      canonicalizeGoalRuntimeToolName(
        "mcp__mcp__tool",
        {},
        {
          structured_content: {
            status: "running",
            activeTodoId: "todo-1",
            activeTodoText: "Collect requirements",
            nextTodoId: "todo-1",
            nextTodoText: "Collect requirements",
            completedTodoIds: [],
            blockedReason: null,
            handoffSummary: null,
            completedCount: 0,
            totalCount: 2,
          },
        },
      ),
    ).toBe(buildGoalRuntimeToolFullName(GOAL_MCP_TOOL_NAMES.GET_STATUS));
  });
});
