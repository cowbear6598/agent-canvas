import type { Pod, Connection, TriggerMode } from "../../types/index.js";
import type { RunContext } from "../../types/run.js";
import type { SettlementPathway } from "./types.js";
import { runWorkflowSnapshotStore } from "./runWorkflowSnapshotStore.js";

const WORKFLOW_SOURCE_HEADING = "## Source:";
const WORKFLOW_SECTION_SEPARATOR = "---";

export function resolvePendingKey(
  targetPodId: string,
  runContext: RunContext,
): string {
  return `${runContext.runId}:${targetPodId}`;
}

export function buildRunQueueKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}

export function isAutoTriggerable(triggerMode: string): boolean {
  return triggerMode === "auto" || triggerMode === "branch";
}

export function resolveSettlementPathway(
  triggerMode: TriggerMode,
): SettlementPathway {
  return isAutoTriggerable(triggerMode) ? "auto" : "direct";
}

export function getMultiInputGroupConnections(
  runContext: RunContext,
  targetPodId: string,
): Connection[] {
  const allIncomingConnections =
    runWorkflowSnapshotStore.findConnectionsByTargetPodId(
    runContext.runId,
    targetPodId,
  );
  return allIncomingConnections.filter(
    (conn) => isAutoTriggerable(conn.triggerMode) && !conn.direct,
  );
}

export function formatMergedSummaries(
  summaries: Map<string, string>,
  podLookup: (podId: string) => Pod | undefined,
): string {
  const formatted: string[] = [];

  for (const [sourcePodId, content] of summaries.entries()) {
    const sourcePod = podLookup(sourcePodId);
    const podName = sourcePod?.name || sourcePodId;

    formatted.push(
      `${WORKFLOW_SOURCE_HEADING} ${podName}\n${content}\n\n${WORKFLOW_SECTION_SEPARATOR}`,
    );
  }

  return formatted.join("\n\n").replace(/\n\n---$/, "");
}

function escapeXmlTags(content: string): string {
  return content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildTransferMessage(content: string): string {
  return `<source-summary>\n${escapeXmlTags(content)}\n</source-summary>`;
}
