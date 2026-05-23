import type {
  Connection,
  ConnectionStatus,
  WorkflowRole,
} from "@/types/connection";

interface ConnectionNeighbor {
  neighborId: string;
  connection: Connection;
}

const RUNNING_CONNECTION_STATUSES = new Set<ConnectionStatus>([
  "active",
  "queued",
  "waiting",
]);

export function getPodWorkflowRoleFromConnections(
  connections: Connection[],
  podId: string,
): WorkflowRole {
  const hasUpstream = connections.some(
    (connection) => connection.targetPodId === podId,
  );
  const hasDownstream = connections.some(
    (connection) => connection.sourcePodId === podId,
  );

  if (!hasUpstream && !hasDownstream) return "independent";
  if (!hasUpstream && hasDownstream) return "head";
  if (hasUpstream && !hasDownstream) return "tail";
  return "middle";
}

export function buildBidirectionalConnectionGraph(
  connections: Connection[],
): Map<string, ConnectionNeighbor[]> {
  const map = new Map<string, ConnectionNeighbor[]>();
  for (const connection of connections) {
    if (connection.sourcePodId) {
      const sourceList = map.get(connection.sourcePodId) ?? [];
      sourceList.push({ neighborId: connection.targetPodId, connection });
      map.set(connection.sourcePodId, sourceList);

      const targetList = map.get(connection.targetPodId) ?? [];
      targetList.push({ neighborId: connection.sourcePodId, connection });
      map.set(connection.targetPodId, targetList);
    }
  }
  return map;
}

export function buildDownstreamConnectionGraph(
  connections: Connection[],
): Map<string, ConnectionNeighbor[]> {
  const map = new Map<string, ConnectionNeighbor[]>();
  for (const connection of connections) {
    if (connection.sourcePodId) {
      const list = map.get(connection.sourcePodId) ?? [];
      list.push({ neighborId: connection.targetPodId, connection });
      map.set(connection.sourcePodId, list);
    }
  }
  return map;
}

function isRunningConnection(connection: Connection): boolean {
  return (
    (connection.status !== undefined &&
      RUNNING_CONNECTION_STATUSES.has(connection.status)) ||
    connection.decideStatus === "pending"
  );
}

/**
 * 使用 BFS 而非 DFS：在循環或極長鏈中不會堆疊溢位，找到第一個執行中節點即提前返回。
 */
export function hasRunningWorkflowInGraph(
  startId: string,
  graph: Map<string, ConnectionNeighbor[]>,
  isRunningPod: (podId: string) => boolean = () => false,
): boolean {
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    if (isRunningPod(currentId)) return true;

    for (const { neighborId, connection } of graph.get(currentId) ?? []) {
      if (isRunningConnection(connection)) return true;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return false;
}

export function isPodPartOfRunningWorkflow(
  connections: Connection[],
  podId: string,
): boolean {
  return hasRunningWorkflowInGraph(
    podId,
    buildBidirectionalConnectionGraph(connections),
  );
}

export function isDownstreamWorkflowRunning(
  connections: Connection[],
  sourcePodId: string,
): boolean {
  return hasRunningWorkflowInGraph(
    sourcePodId,
    buildDownstreamConnectionGraph(connections),
  );
}
