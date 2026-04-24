import path from "path";
import { vi } from "vitest";
import { workflowQueueService } from "../../src/services/workflow/index.js";
import { workflowExecutionService } from "../../src/services/workflow/index.js";
import type {
  Pod,
  Connection,
  TriggerMode,
  PersistedMessage,
} from "../../src/types/index.js";
import type { TriggerStrategy } from "../../src/services/workflow/types.js";
import type { RunContext } from "../../src/types/run.js";
import type {
  WorkflowRun,
  RunPodInstance,
} from "../../src/services/runStore.js";
import { config } from "../../src/config/index.js";

// 常用測試 ID
export const TEST_IDS = {
  canvasId: "canvas-1",
  sourcePodId: "source-pod",
  targetPodId: "target-pod",
  connectionId: "conn-1",
} as const;

// Pod Factory
// workspacePath 必須位於 config.repositoriesRoot 之下，以通過路徑安全驗證
export function createMockPod(overrides?: Partial<Pod>): Pod {
  return {
    id: "test-pod",
    name: "Test Pod",
    provider: "claude",
    providerConfig: { model: "sonnet" },
    sessionId: null,
    repositoryId: null,
    workspacePath: path.join(config.repositoriesRoot, "test-workspace"),
    commandId: null,
    outputStyleId: null,
    status: "idle",
    x: 0,
    y: 0,
    rotation: 0,
    multiInstance: false,
    skillIds: [],
    subAgentIds: [],
    ...overrides,
  } as Pod;
}

// Connection Factory
export function createMockConnection(
  overrides?: Partial<Connection>,
): Connection {
  return {
    id: "conn-1",
    sourcePodId: "source-pod",
    sourceAnchor: "right",
    targetPodId: "target-pod",
    targetAnchor: "left",
    triggerMode: "auto" as TriggerMode,
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    ...overrides,
  } as Connection;
}

// Message Factory
export function createMockMessages(): PersistedMessage[] {
  return [
    {
      id: "msg-1",
      role: "user" as const,
      content: "Test user message",
      timestamp: new Date().toISOString(),
    },
    {
      id: "msg-2",
      role: "assistant" as const,
      content: "Test assistant response",
      timestamp: new Date().toISOString(),
    },
  ] as PersistedMessage[];
}

// Strategy Factory
export function createMockStrategy(
  mode: TriggerMode,
  overrides?: Partial<TriggerStrategy>,
): TriggerStrategy {
  const base: Partial<TriggerStrategy> = {
    mode,
    decide: vi.fn().mockResolvedValue([]),
    onTrigger: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onQueued: vi.fn(),
    onQueueProcessed: vi.fn(),
    ...overrides,
  };

  if (mode === "direct" && !overrides?.collectSources) {
    base.collectSources = vi.fn();
  }

  return base as TriggerStrategy;
}

// Queue 初始化 Helper
export function initializeQueueService(strategies: {
  auto: TriggerStrategy;
  direct: TriggerStrategy;
  "ai-decide": TriggerStrategy;
}) {
  workflowQueueService.init({
    executionService: workflowExecutionService,
    strategies,
  });
}

// Queue 清空 Helper
export function clearAllQueues(targetPodIds: string[]) {
  targetPodIds.forEach((podId) => {
    while (workflowQueueService.getQueueSize(podId) > 0)
      workflowQueueService.dequeue(podId);
  });
}

export function createMockRunContext(
  overrides?: Partial<RunContext>,
): RunContext {
  return {
    runId: "test-run-id",
    canvasId: TEST_IDS.canvasId,
    sourcePodId: TEST_IDS.sourcePodId,
    ...overrides,
  };
}

export function createMockWorkflowRun(
  overrides?: Partial<WorkflowRun>,
): WorkflowRun {
  return {
    id: "test-run-id",
    canvasId: TEST_IDS.canvasId,
    sourcePodId: TEST_IDS.sourcePodId,
    triggerMessage: "Test trigger message",
    status: "running",
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

export function createMockRunPodInstance(
  overrides?: Partial<RunPodInstance>,
): RunPodInstance {
  return {
    id: "test-instance-id",
    runId: "test-run-id",
    podId: TEST_IDS.targetPodId,
    status: "pending",
    sessionId: null,
    errorMessage: null,
    triggeredAt: null,
    completedAt: null,
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    ...overrides,
  };
}
