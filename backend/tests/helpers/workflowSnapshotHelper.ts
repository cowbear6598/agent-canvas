import type { Connection, Pod } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";
import type { ConnectionLineModelConfig } from "../../src/services/configStore.js";
import {
  runWorkflowSnapshotStore,
  type RunWorkflowSnapshot,
} from "../../src/services/workflow/runWorkflowSnapshotStore.js";

export function makeTestWorkflowPod(
  id: string,
  overrides: Partial<Pod> = {},
): Pod {
  return {
    id,
    name: id,
    workspacePath: `/tmp/${id}`,
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    mcpServerNames: [],
    agentCanvasMcpEnabled: false,
    pluginIds: [],
    provider: "claude",
    providerConfig: { model: "sonnet" },
    fastModeEnabled: false,
    repositoryId: null,
    memoryEnabled: false,
    repoMemoryEnabled: false,
    ...overrides,
  };
}

export function installRunWorkflowSnapshot(
  runContext: RunContext,
  options: {
    pods?: Pod[];
    connections?: Connection[];
    connectionLineConfig?: ConnectionLineModelConfig;
  } = {},
): RunWorkflowSnapshot {
  const pods = options.pods ?? [makeTestWorkflowPod(runContext.sourcePodId)];
  const connections = options.connections ?? [];
  const snapshot: RunWorkflowSnapshot = Object.freeze({
    canvasId: runContext.canvasId,
    sourcePodId: runContext.sourcePodId,
    connectionLineConfig: Object.freeze(
      options.connectionLineConfig ?? {
        connectionLineProvider: "claude",
        connectionLineModel: "sonnet",
        connectionLineThinkingLevel: "high",
      },
    ),
    pods: new Map(pods.map((pod) => [pod.id, Object.freeze(pod)])),
    connections: new Map(
      connections.map((connection) => [
        connection.id,
        Object.freeze(connection),
      ]),
    ),
  });
  runWorkflowSnapshotStore.set(runContext.runId, snapshot);
  return snapshot;
}
