import type { Connection, WorkflowRole } from "@/types/connection";

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
