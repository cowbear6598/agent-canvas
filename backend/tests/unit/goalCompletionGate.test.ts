import fs from "fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  GOAL_GATE_LIMITS,
  autoForceBlock,
  buildNudgeMessage,
  evaluateGoalGate,
  nextNoProgressCount,
} from "../../src/services/goalCompletionGate.js";
import {
  completeGoalTodo,
  ensureGoalRuntime,
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
  removeGoalRuntimeRun,
  writeGoalRuntimeSnapshot,
  type GoalRuntimeSnapshot,
} from "../../src/services/goalRuntime.js";

const runContext = {
  runId: "run-gate-test",
  canvasId: "canvas-gate-001",
  sourcePodId: "pod-gate-001",
};

const goal = {
  todos: [
    { id: "todo-1", text: "Inspect logs" },
    { id: "todo-2", text: "Fix the bug" },
  ],
};

const pod = {
  id: "pod-gate-001",
  name: "Gate Pod",
  goal,
};

const noGoalPod = {
  id: "pod-gate-no-goal-001",
  name: "Empty Pod",
  goal: null,
};

afterEach(() => {
  removeGoalRuntimeRun(runContext.runId);
});

describe("evaluateGoalGate", () => {
  it("runContext 為 undefined 時應 proceed", () => {
    const decision = evaluateGoalGate(undefined, pod.id, {
      retryCount: 0,
      noProgressCount: 0,
    });
    expect(decision.action).toBe("proceed");
  });

  it("snapshot 不存在時應 proceed", () => {
    const decision = evaluateGoalGate(runContext, "pod-not-exist", {
      retryCount: 0,
      noProgressCount: 0,
    });
    expect(decision.action).toBe("proceed");
  });

  it("status === 'completed' 時應 proceed", () => {
    ensureGoalRuntime(noGoalPod, runContext);
    const decision = evaluateGoalGate(runContext, noGoalPod.id, {
      retryCount: 0,
      noProgressCount: 0,
    });
    expect(decision.action).toBe("proceed");
  });

  it("status === 'blocked' 時應 proceed（blocked 視為完成的一種）", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");
    const blocked: GoalRuntimeSnapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        status: "blocked",
        blockedReason: "卡住了",
      },
    };
    writeGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
      blocked,
    );

    const decision = evaluateGoalGate(runContext, pod.id, {
      retryCount: 0,
      noProgressCount: 0,
    });
    expect(decision.action).toBe("proceed");
  });

  it("status === 'running' 且有 activeTodo 時應 retry，附帶 nudge 訊息", () => {
    ensureGoalRuntime(pod, runContext);

    const decision = evaluateGoalGate(runContext, pod.id, {
      retryCount: 0,
      noProgressCount: 0,
    });

    expect(decision.action).toBe("retry");
    if (decision.action !== "retry") return;
    expect(decision.completedCountBefore).toBe(0);
    expect(decision.nudgeMessage).toContain("Inspect logs");
    expect(decision.nudgeMessage).toContain("agent_canvas_goal");
  });

  it("snapshot 已完成但殘留 activeTodoId 時應 proceed，不再補送 nudge", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    fs.writeFileSync(
      getGoalRuntimeStatePath(runContext, pod.id),
      JSON.stringify(
        {
          ...snapshot,
          state: {
            ...snapshot.state,
            status: "running",
            activeTodoId: "todo-2",
            completedTodoIds: ["todo-1", "todo-2"],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const decision = evaluateGoalGate(runContext, pod.id, {
      retryCount: 0,
      noProgressCount: 0,
    });

    expect(decision.action).toBe("proceed");
  });

  it("retryCount 達到 hardRetryLimit 時應 force_block", () => {
    ensureGoalRuntime(pod, runContext);

    const decision = evaluateGoalGate(runContext, pod.id, {
      retryCount: GOAL_GATE_LIMITS.hardRetryLimit,
      noProgressCount: 0,
    });

    expect(decision.action).toBe("force_block");
    if (decision.action !== "force_block") return;
    expect(decision.reason).toContain("硬上限");
  });

  it("noProgressCount 達到 noProgressLimit 時應 force_block", () => {
    ensureGoalRuntime(pod, runContext);

    const decision = evaluateGoalGate(runContext, pod.id, {
      retryCount: 1,
      noProgressCount: GOAL_GATE_LIMITS.noProgressLimit,
    });

    expect(decision.action).toBe("force_block");
    if (decision.action !== "force_block") return;
    expect(decision.reason).toContain("未推進");
  });
});

describe("nextNoProgressCount", () => {
  it("completedCount 有增加時應歸零", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    const updated: GoalRuntimeSnapshot = {
      ...snapshot,
      state: completeGoalTodo(snapshot.goal, snapshot.state, "todo-1"),
    };
    writeGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
      updated,
    );

    expect(nextNoProgressCount(runContext, pod.id, 0, 1)).toBe(0);
  });

  it("completedCount 沒增加時應 +1", () => {
    ensureGoalRuntime(pod, runContext);
    expect(nextNoProgressCount(runContext, pod.id, 0, 1)).toBe(2);
  });
});

describe("buildNudgeMessage", () => {
  it("應帶入 activeTodo 文字與剩餘數量", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    const msg = buildNudgeMessage(snapshot);
    expect(msg).toContain("Inspect logs");
    expect(msg).toContain("2 個未完成");
    expect(msg).toContain("agent_canvas_goal");
  });

  it("activeTodoId 無效時應退回實際剩餘 todo，不顯示 UUID", () => {
    const snapshot = ensureGoalRuntime(pod, runContext);
    if (!snapshot) throw new Error("snapshot 應存在");

    const msg = buildNudgeMessage({
      ...snapshot,
      state: {
        ...snapshot.state,
        activeTodoId: "e6739b91-b57f-42cf-8643-8c771f3d917a",
        completedTodoIds: ["todo-1"],
      },
    });

    expect(msg).toContain("Fix the bug");
    expect(msg).toContain("1 個未完成");
    expect(msg).not.toContain("e6739b91-b57f-42cf-8643-8c771f3d917a");
  });
});

describe("autoForceBlock", () => {
  it("應把 snapshot 的 status 改為 blocked 並寫入 reason", () => {
    ensureGoalRuntime(pod, runContext);

    autoForceBlock(runContext, pod, "達到 retry 上限");

    const after = readGoalRuntimeSnapshot(
      getGoalRuntimeStatePath(runContext, pod.id),
    );
    expect(after?.state.status).toBe("blocked");
    expect(after?.state.blockedReason).toBe("達到 retry 上限");
  });
});
