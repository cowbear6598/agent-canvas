import type { Pod } from "../types/pod.js";
import type { RunContext } from "../types/run.js";
import { logger } from "../utils/logger.js";
import {
  forceBlockGoalRuntime,
  getGoalRuntimeStatePath,
  readGoalRuntimeSnapshot,
  type GoalRuntimeSnapshot,
} from "./goalRuntime.js";

/**
 * Goal 完成 gate 的上限參數。
 * - hardRetryLimit：總 retry 次數的硬上限，作為「LLM 持續推進但 todo 太多」時的最終保險絲
 * - noProgressLimit：連續未推進（completedTodoIds 沒有增量）的容忍次數
 *   只要 LLM 有在完成 todo 就計數歸零；連續 N 輪沒推進才算卡住
 */
export const GOAL_GATE_LIMITS = {
  hardRetryLimit: 10,
  noProgressLimit: 2,
} as const;

export type GoalGateDecision =
  | { action: "proceed" }
  | { action: "retry"; nudgeMessage: string; completedCountBefore: number }
  | { action: "force_block"; reason: string };

interface GoalGateCounters {
  retryCount: number;
  noProgressCount: number;
}

function readSnapshotForGate(
  runContext: RunContext,
  podId: string,
): GoalRuntimeSnapshot | null {
  return readGoalRuntimeSnapshot(getGoalRuntimeStatePath(runContext, podId));
}

/**
 * 依當前 Goal Runtime snapshot 與 retry 計數，決定下一步行為。
 *
 * 放行條件（action: "proceed"）：
 *   - 沒有 snapshot（未啟用 Goal Runtime）
 *   - status === "completed"
 *   - status === "blocked"（依產品決策視為完成的一種）
 *   - activeTodoId 為 null（沒有可推進的 todo）
 *
 * 強制 block（action: "force_block"）：
 *   - retryCount 達到 hardRetryLimit
 *   - noProgressCount 達到 noProgressLimit（連續未推進）
 *
 * 重試（action: "retry"）：
 *   - status === "running" 且有 activeTodoId 且尚未達上限
 */
export function evaluateGoalGate(
  runContext: RunContext | undefined,
  podId: string,
  counters: GoalGateCounters,
): GoalGateDecision {
  if (!runContext) return { action: "proceed" };

  const snapshot = readSnapshotForGate(runContext, podId);
  if (!snapshot) return { action: "proceed" };

  const { state } = snapshot;
  if (state.status !== "running" || !state.activeTodoId) {
    return { action: "proceed" };
  }

  if (counters.retryCount >= GOAL_GATE_LIMITS.hardRetryLimit) {
    return {
      action: "force_block",
      reason: `達到 retry 硬上限 (${GOAL_GATE_LIMITS.hardRetryLimit} 次)，剩餘 todo 自動標記為 blocked`,
    };
  }

  if (counters.noProgressCount >= GOAL_GATE_LIMITS.noProgressLimit) {
    return {
      action: "force_block",
      reason: `連續 ${GOAL_GATE_LIMITS.noProgressLimit} 輪未推進任何 todo，視為卡住並自動標記為 blocked`,
    };
  }

  return {
    action: "retry",
    nudgeMessage: buildNudgeMessage(snapshot),
    completedCountBefore: state.completedTodoIds.length,
  };
}

/**
 * 產生 retry 用的 nudge 訊息：簡短提醒 LLM 還有未完成的 todo，並指出當前 activeTodo。
 */
export function buildNudgeMessage(snapshot: GoalRuntimeSnapshot): string {
  const { goal, state } = snapshot;
  const activeTodo = goal.todos.find((t) => t.id === state.activeTodoId);
  const activeText = activeTodo?.text ?? state.activeTodoId ?? "(未知 todo)";
  const remaining = goal.todos.length - state.completedTodoIds.length;

  return [
    `還有 ${remaining} 個未完成的 todo，請繼續執行。`,
    `目前進行中：${activeText}`,
    "請使用 agent_canvas_goal 工具回報進度（complete_goal_todo 完成、block_goal_progress 卡住）。",
  ].join("\n");
}

/**
 * 計算 retry 之後新的 noProgressCount。
 * 完成 todo 數有增加 → 歸零；否則 +1。
 */
export function nextNoProgressCount(
  runContext: RunContext,
  podId: string,
  completedCountBefore: number,
  previousNoProgress: number,
): number {
  const afterSnapshot = readSnapshotForGate(runContext, podId);
  const afterCount =
    afterSnapshot?.state.completedTodoIds.length ?? completedCountBefore;
  return afterCount > completedCountBefore ? 0 : previousNoProgress + 1;
}

/**
 * 達到 retry 上限時自動把 Goal Runtime 標為 blocked。
 * 依產品決策，blocked 視為完成的一種，下游 workflow 仍會被觸發；
 * handoff summary 會帶上 reason 供下游或使用者追查。
 */
export function autoForceBlock(
  runContext: RunContext,
  pod: Pick<Pod, "id" | "name" | "goal">,
  reason: string,
): void {
  const snapshot = forceBlockGoalRuntime(runContext, pod, reason);
  if (snapshot) {
    logger.warn(
      "Run",
      "Warn",
      `Pod ${pod.id} Goal Runtime 自動標記為 blocked：${reason}`,
    );
  }
}
