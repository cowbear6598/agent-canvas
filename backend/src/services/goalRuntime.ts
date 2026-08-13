import fs from "fs";
import os from "os";
import path from "path";
import type { Pod, PodGoal } from "../types/pod.js";
import type { RunContext } from "../types/run.js";
import { buildInternalSelfSpawn } from "../utils/internalSelfSpawn.js";

export type GoalRuntimeStatus = "running" | "blocked" | "completed";

export const GOAL_MCP_SERVER_NAME = "agent_canvas_goal";
export const GOAL_MCP_TOOL_NAMES = {
  GET_ACTIVE_TODO: "get_active_goal_todo",
  GET_STATUS: "get_goal_status",
  COMPLETE_TODO: "complete_goal_todo",
  BLOCK_PROGRESS: "block_goal_progress",
} as const;

export type GoalRuntimeToolName =
  (typeof GOAL_MCP_TOOL_NAMES)[keyof typeof GOAL_MCP_TOOL_NAMES];

const GOAL_RUNTIME_GENERIC_WRAPPER_TOOL_NAMES = new Set([
  "mcp__mcp_tool",
  "mcp__mcp__tool",
]);

export interface GoalRuntimeState {
  todoOrder: string[];
  activeTodoId: string | null;
  lastReadTodoId: string | null;
  completedTodoIds: string[];
  status: GoalRuntimeStatus;
  blockedReason: string | null;
  handoffSummary: string | null;
  updatedAt: string;
}

export interface GoalRuntimeSnapshot {
  runId: string;
  podId: string;
  podName: string;
  goal: PodGoal;
  state: GoalRuntimeState;
}

export interface GoalRuntimeToolResult {
  status: GoalRuntimeStatus;
  activeTodoId: string | null;
  activeTodoText: string | null;
  lastReadTodoId: string | null;
  nextTodoId: string | null;
  nextTodoText: string | null;
  completedTodoIds: string[];
  blockedReason: string | null;
  handoffSummary: string | null;
  completedCount: number;
  totalCount: number;
}

export interface GoalRuntimeActiveTodoResult {
  activeTodoId: string | null;
  activeTodoText: string | null;
}

export interface GoalRuntimeMcpMetadata extends GoalRuntimeToolResult {
  system: true;
  locked: true;
  name: string;
  type: "stdio";
  description: string;
}

export interface GoalRuntimeMcpServerConfig {
  name: typeof GOAL_MCP_SERVER_NAME;
  command: string;
  args: string[];
  env: Record<string, string>;
}

function normalizeGoalRuntimeGoal(goal: PodGoal | null | undefined): PodGoal {
  return {
    todos: Array.isArray(goal?.todos) ? [...goal.todos] : [],
  };
}

function dedupeTodoIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function getRemainingTodoIds(
  todoOrder: string[],
  completedTodoIds: string[],
): string[] {
  const completedTodoIdSet = new Set(completedTodoIds);
  return todoOrder.filter((todoId) => !completedTodoIdSet.has(todoId));
}

export function normalizeGoalRuntimeState(
  goal: PodGoal,
  state: GoalRuntimeState,
): GoalRuntimeState {
  const todoOrder = goal.todos.map((todo) => todo.id);
  const completedTodoIdSet = new Set(dedupeTodoIds(state.completedTodoIds));
  const completedTodoIds = todoOrder.filter((todoId) =>
    completedTodoIdSet.has(todoId),
  );
  const remainingTodoIds = getRemainingTodoIds(todoOrder, completedTodoIds);
  const hasRemainingTodos = remainingTodoIds.length > 0;
  const activeTodoId =
    hasRemainingTodos &&
    state.activeTodoId &&
    !completedTodoIdSet.has(state.activeTodoId)
      ? state.activeTodoId
      : (remainingTodoIds[0] ?? null);
  const status: GoalRuntimeStatus =
    state.status === "blocked"
      ? "blocked"
      : hasRemainingTodos
        ? "running"
        : "completed";
  return {
    ...state,
    todoOrder,
    activeTodoId,
    lastReadTodoId:
      state.lastReadTodoId === activeTodoId ? activeTodoId : null,
    completedTodoIds,
    status,
    blockedReason: status === "blocked" ? state.blockedReason : null,
  };
}

export function normalizeGoalRuntimeSnapshot(
  snapshot: GoalRuntimeSnapshot,
): GoalRuntimeSnapshot {
  const goal = normalizeGoalRuntimeGoal(snapshot.goal);

  return {
    ...snapshot,
    goal,
    state: normalizeGoalRuntimeState(goal, snapshot.state),
  };
}

export function createGoalRuntimeState(
  goal: PodGoal | null | undefined,
): GoalRuntimeState {
  const normalizedGoal = normalizeGoalRuntimeGoal(goal);
  const todoOrder = normalizedGoal.todos.map((todo) => todo.id);
  return {
    todoOrder,
    activeTodoId: todoOrder[0] ?? null,
    lastReadTodoId: null,
    completedTodoIds: [],
    status: todoOrder.length > 0 ? "running" : "completed",
    blockedReason: null,
    handoffSummary: null,
    updatedAt: new Date().toISOString(),
  };
}

function withUpdatedAt(state: GoalRuntimeState): GoalRuntimeState {
  return {
    ...state,
    updatedAt: new Date().toISOString(),
  };
}

export function markActiveGoalTodoRead(
  goal: PodGoal,
  state: GoalRuntimeState,
): GoalRuntimeState {
  const normalizedState = normalizeGoalRuntimeState(goal, state);
  return withUpdatedAt({
    ...normalizedState,
    lastReadTodoId: normalizedState.activeTodoId,
  });
}

function getGoalTodoCompletionErrorFromState(
  state: GoalRuntimeState,
  todoId?: string,
): string | null {
  const targetTodoId = todoId ?? state.activeTodoId;

  if (!state.activeTodoId) {
    return "目前沒有可完成的 active todo，請先呼叫 get_active_goal_todo 確認目前狀態。";
  }

  if (state.lastReadTodoId !== state.activeTodoId) {
    return "請先呼叫 get_active_goal_todo 讀取目前的 active todo，再呼叫 complete_goal_todo。";
  }

  if (targetTodoId !== state.lastReadTodoId) {
    return "todoId 與最近透過 get_active_goal_todo 讀取的 active todo 不一致，請重新呼叫 get_active_goal_todo 後再完成。";
  }

  return null;
}

export function getGoalTodoCompletionError(
  goal: PodGoal,
  state: GoalRuntimeState,
  todoId?: string,
): string | null {
  return getGoalTodoCompletionErrorFromState(
    normalizeGoalRuntimeState(goal, state),
    todoId,
  );
}

export function completeGoalTodo(
  goal: PodGoal,
  state: GoalRuntimeState,
  todoId?: string,
  handoffSummary: string | null = null,
): GoalRuntimeState {
  const normalizedState = normalizeGoalRuntimeState(goal, state);
  if (getGoalTodoCompletionErrorFromState(normalizedState, todoId)) {
    return normalizedState;
  }

  const targetTodoId = todoId ?? normalizedState.activeTodoId ?? "";
  const completedTodoIds = [...normalizedState.completedTodoIds, targetTodoId];
  const completedTodoIdSet = new Set(completedTodoIds);
  const activeTodoId =
    normalizedState.todoOrder.find((id) => !completedTodoIdSet.has(id)) ?? null;

  return withUpdatedAt({
    ...normalizedState,
    activeTodoId,
    lastReadTodoId: null,
    completedTodoIds,
    status: activeTodoId ? "running" : "completed",
    blockedReason: null,
    handoffSummary,
  });
}

export function blockGoalRuntime(
  state: GoalRuntimeState,
  blockedReason: string,
  handoffSummary: string | null = null,
): GoalRuntimeState {
  return withUpdatedAt({
    ...state,
    status: "blocked",
    blockedReason,
    handoffSummary,
  });
}

export function formatGoalTodos(
  goal: PodGoal | null | undefined,
): string | null {
  if (!goal?.todos.length) return null;

  return goal.todos
    .map((todo, index) => `${index + 1}. ${todo.text}`)
    .join("\n");
}

const GOAL_RUNTIME_ROOT_DIR = path.join(
  os.tmpdir(),
  "agent-canvas-goal-runtime",
);

export function getGoalRuntimeRunDir(runId: string): string {
  return path.join(GOAL_RUNTIME_ROOT_DIR, runId);
}

export function getGoalRuntimeStatePath(
  runContext: RunContext,
  podId: string,
): string {
  const scopeSuffix = runContext.goalRuntimeScopeId
    ? `.${runContext.goalRuntimeScopeId}`
    : "";
  return path.join(
    getGoalRuntimeRunDir(runContext.runId),
    `${podId}${scopeSuffix}.json`,
  );
}

function getBaseGoalRuntimeStatePath(
  runContext: RunContext,
  podId: string,
): string {
  return getGoalRuntimeStatePath(
    {
      ...runContext,
      goalRuntimeScopeId: undefined,
    },
    podId,
  );
}

function createGoalRuntimeSnapshot(
  pod: Pick<Pod, "id" | "name" | "goal">,
  runContext: RunContext,
): GoalRuntimeSnapshot {
  const goal = normalizeGoalRuntimeGoal(pod.goal);
  const state = createGoalRuntimeState(goal);

  return {
    runId: runContext.runId,
    podId: pod.id,
    podName: pod.name,
    goal,
    state,
  };
}

function ensureGoalRuntimeDir(statePath: string): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
}

export function writeGoalRuntimeSnapshot(
  statePath: string,
  snapshot: GoalRuntimeSnapshot,
): void {
  ensureGoalRuntimeDir(statePath);
  const normalizedSnapshot = normalizeGoalRuntimeSnapshot(snapshot);
  fs.writeFileSync(
    statePath,
    JSON.stringify(normalizedSnapshot, null, 2),
    "utf-8",
  );
}

export function readGoalRuntimeSnapshot(
  statePath: string,
): GoalRuntimeSnapshot | null {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as GoalRuntimeSnapshot;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.goal?.todos) ||
      !parsed.state
    ) {
      throw new Error(`Invalid Goal Runtime snapshot: ${statePath}`);
    }
    return normalizeGoalRuntimeSnapshot(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export function ensureGoalRuntime(
  pod: Pick<Pod, "id" | "name" | "goal">,
  runContext?: RunContext,
): GoalRuntimeSnapshot | null {
  if (!runContext) return null;

  const statePath = getGoalRuntimeStatePath(runContext, pod.id);
  const existing = readGoalRuntimeSnapshot(statePath);
  if (existing) return existing;

  if (runContext.goalRuntimeScopeId) {
    const baseSnapshot = readGoalRuntimeSnapshot(
      getBaseGoalRuntimeStatePath(runContext, pod.id),
    );
    if (baseSnapshot) {
      const snapshot: GoalRuntimeSnapshot = {
        ...baseSnapshot,
        podName: pod.name,
        state: createGoalRuntimeState(baseSnapshot.goal),
      };
      writeGoalRuntimeSnapshot(statePath, snapshot);
      return snapshot;
    }
  }

  // snapshot 不存在時才以當下 pod goal 建立 run-scoped snapshot。
  // 建立後不再受 live pod goal 編輯影響，避免執行中的 workflow 被後續設定修改。
  const snapshot = createGoalRuntimeSnapshot(pod, runContext);
  writeGoalRuntimeSnapshot(statePath, snapshot);

  return snapshot;
}

function getGoalTodoText(goal: PodGoal, todoId: string | null): string | null {
  if (!todoId) return null;
  return goal.todos.find((todo) => todo.id === todoId)?.text ?? null;
}

export function buildGoalRuntimeToolResult(
  snapshot: GoalRuntimeSnapshot,
): GoalRuntimeToolResult {
  const { goal, state } = snapshot;

  // 找出排在 activeTodoId 之後、且尚未完成的第一個 todo 作為 nextTodoId
  const completedTodoIdSet = new Set(state.completedTodoIds);
  const activeIndex = state.activeTodoId
    ? state.todoOrder.indexOf(state.activeTodoId)
    : -1;
  const nextTodoId =
    activeIndex >= 0
      ? (state.todoOrder
          .slice(activeIndex + 1)
          .find((id) => !completedTodoIdSet.has(id)) ?? null)
      : null;

  return {
    status: state.status,
    activeTodoId: state.activeTodoId,
    activeTodoText: getGoalTodoText(goal, state.activeTodoId),
    lastReadTodoId: state.lastReadTodoId,
    nextTodoId,
    nextTodoText: getGoalTodoText(goal, nextTodoId),
    completedTodoIds: [...state.completedTodoIds],
    blockedReason: state.blockedReason,
    handoffSummary: state.handoffSummary,
    completedCount: state.completedTodoIds.length,
    totalCount: goal.todos.length,
  };
}

export function buildGoalRuntimeActiveTodoResult(
  snapshot: GoalRuntimeSnapshot | null,
): GoalRuntimeActiveTodoResult {
  if (!snapshot) {
    return {
      activeTodoId: null,
      activeTodoText: null,
    };
  }

  return {
    activeTodoId: snapshot.state.activeTodoId,
    activeTodoText: getGoalTodoText(snapshot.goal, snapshot.state.activeTodoId),
  };
}

export function buildGoalRuntimeMcpMetadata(
  snapshot: GoalRuntimeSnapshot,
): GoalRuntimeMcpMetadata {
  const hasTodos = snapshot.goal.todos.length > 0;
  return {
    ...buildGoalRuntimeToolResult(snapshot),
    name: GOAL_MCP_SERVER_NAME,
    type: "stdio",
    system: true,
    locked: true,
    description: !hasTodos
      ? "Goal Runtime 可用，但目前尚未設定 goal"
      : snapshot.state.status === "completed"
        ? "Goal Runtime 已完成目前 Pod 的所有 todo"
        : snapshot.state.activeTodoId
          ? `目前 active todo：${getGoalTodoText(snapshot.goal, snapshot.state.activeTodoId) ?? snapshot.state.activeTodoId}`
          : "Goal Runtime 可用，但目前沒有 active todo",
  };
}

export function buildGoalRuntimeMcpListItem(
  pod: Pick<Pod, "id" | "name" | "goal">,
): GoalRuntimeMcpMetadata {
  const goal = normalizeGoalRuntimeGoal(pod.goal);
  const snapshot: GoalRuntimeSnapshot = {
    runId: "preview",
    podId: pod.id,
    podName: pod.name,
    goal,
    state: createGoalRuntimeState(goal),
  };

  return buildGoalRuntimeMcpMetadata(snapshot);
}

export function buildGoalRuntimeMcpServerConfig(
  runContext: RunContext,
  pod: Pick<Pod, "id" | "name" | "goal">,
): GoalRuntimeMcpServerConfig | null {
  const snapshot = ensureGoalRuntime(pod, runContext);
  if (!snapshot) return null;

  const spawn = buildInternalSelfSpawn("--goal-bridge");
  return {
    name: GOAL_MCP_SERVER_NAME,
    command: spawn.command,
    args: spawn.args,
    env: {
      AGENT_CANVAS_GOAL_STATE_PATH: getGoalRuntimeStatePath(runContext, pod.id),
    },
  };
}

export function extractGoalRuntimeToolName(
  toolName: string,
): GoalRuntimeToolName | null {
  if (!toolName.includes(GOAL_MCP_SERVER_NAME)) return null;

  if (toolName.includes(GOAL_MCP_TOOL_NAMES.GET_ACTIVE_TODO)) {
    return GOAL_MCP_TOOL_NAMES.GET_ACTIVE_TODO;
  }
  if (toolName.includes(GOAL_MCP_TOOL_NAMES.GET_STATUS)) {
    return GOAL_MCP_TOOL_NAMES.GET_STATUS;
  }
  if (toolName.includes(GOAL_MCP_TOOL_NAMES.COMPLETE_TODO)) {
    return GOAL_MCP_TOOL_NAMES.COMPLETE_TODO;
  }
  if (toolName.includes(GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS)) {
    return GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS;
  }

  return null;
}

export function buildGoalRuntimeToolFullName(
  toolName: GoalRuntimeToolName,
): string {
  return `mcp__${GOAL_MCP_SERVER_NAME}__${toolName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isGoalRuntimeToolResult(
  value: unknown,
): value is GoalRuntimeToolResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    "status" in value &&
    "completedTodoIds" in value,
  );
}

function parseGoalRuntimeContentBlocks(
  content: unknown[],
): GoalRuntimeToolResult | null {
  for (const block of content) {
    if (!isRecord(block) || typeof block.text !== "string") continue;
    const parsed = parseGoalRuntimeToolResult(block.text);
    if (parsed) return parsed;
  }
  return null;
}

export function parseGoalRuntimeToolResult(
  output: unknown,
): GoalRuntimeToolResult | null {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isGoalRuntimeToolResult(parsed)) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  if (!isRecord(output)) return null;

  const structuredContent = output.structured_content;
  if (isGoalRuntimeToolResult(structuredContent)) {
    return structuredContent;
  }

  const content = output.content;
  return Array.isArray(content) ? parseGoalRuntimeContentBlocks(content) : null;
}

function inferGoalRuntimeToolNameFromInput(
  input: Record<string, unknown>,
): GoalRuntimeToolName | null {
  if (
    typeof input.blockedReason === "string" &&
    input.blockedReason.length > 0
  ) {
    return GOAL_MCP_TOOL_NAMES.BLOCK_PROGRESS;
  }
  if (
    typeof input.todoId === "string" ||
    typeof input.handoffSummary === "string"
  ) {
    return GOAL_MCP_TOOL_NAMES.COMPLETE_TODO;
  }
  return null;
}

export function canonicalizeGoalRuntimeToolName(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
): string {
  const explicit = extractGoalRuntimeToolName(toolName);
  if (explicit) {
    return buildGoalRuntimeToolFullName(explicit);
  }

  if (!GOAL_RUNTIME_GENERIC_WRAPPER_TOOL_NAMES.has(toolName)) {
    return toolName;
  }

  const inferredFromInput = inferGoalRuntimeToolNameFromInput(input);
  if (inferredFromInput) {
    return buildGoalRuntimeToolFullName(inferredFromInput);
  }

  const parsedOutput = parseGoalRuntimeToolResult(output);
  if (parsedOutput) {
    return buildGoalRuntimeToolFullName(GOAL_MCP_TOOL_NAMES.GET_STATUS);
  }

  return toolName;
}

export function consumeGoalRuntimeToolResult(
  runContext: RunContext | undefined,
  pod: Pick<Pod, "id" | "name" | "goal">,
  toolName: string,
  output: string,
): GoalRuntimeSnapshot | null {
  if (!runContext || extractGoalRuntimeToolName(toolName) === null) {
    return null;
  }

  const statePath = getGoalRuntimeStatePath(runContext, pod.id);
  const existing = readGoalRuntimeSnapshot(statePath);
  const parsed = parseGoalRuntimeToolResult(output);
  const goal = existing?.goal ?? normalizeGoalRuntimeGoal(pod.goal);

  if (parsed) {
    const baseSnapshot =
      existing ??
      ensureGoalRuntime(
        {
          ...pod,
          goal,
        },
        runContext,
      );
    if (!baseSnapshot) return null;

    const snapshot = normalizeGoalRuntimeSnapshot({
      ...baseSnapshot,
      goal,
      podName: pod.name,
      state: {
        ...baseSnapshot.state,
        activeTodoId: parsed.activeTodoId,
        completedTodoIds: [...parsed.completedTodoIds],
        status: parsed.status,
        blockedReason: parsed.blockedReason,
        handoffSummary: parsed.handoffSummary,
        updatedAt: new Date().toISOString(),
      },
    });
    writeGoalRuntimeSnapshot(statePath, snapshot);
    return snapshot;
  }

  if (existing) return existing;

  return ensureGoalRuntime(pod, runContext);
}

export function forceBlockGoalRuntime(
  runContext: RunContext | undefined,
  pod: Pick<Pod, "id" | "name" | "goal">,
  reason: string,
): GoalRuntimeSnapshot | null {
  if (!runContext) return null;

  const statePath = getGoalRuntimeStatePath(runContext, pod.id);
  const existing = readGoalRuntimeSnapshot(statePath);
  const goal = existing?.goal ?? normalizeGoalRuntimeGoal(pod.goal);

  const baseSnapshot =
    existing ??
    ensureGoalRuntime(
      {
        ...pod,
        goal,
      },
      runContext,
    );
  if (!baseSnapshot) return null;

  const snapshot: GoalRuntimeSnapshot = {
    ...baseSnapshot,
    goal,
    podName: pod.name,
    state: blockGoalRuntime(
      baseSnapshot.state,
      reason,
      baseSnapshot.state.handoffSummary,
    ),
  };
  writeGoalRuntimeSnapshot(statePath, snapshot);
  return snapshot;
}

export function removeGoalRuntimeRun(runId: string): void {
  fs.rmSync(getGoalRuntimeRunDir(runId), { recursive: true, force: true });
}
