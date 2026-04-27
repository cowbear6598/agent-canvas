import type { Pod, Connection, TriggerMode } from "../../types/index.js";
import type {
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "../../types/responses/workflow.js";
import type { RunContext } from "../../types/run.js";
import { connectionStore } from "../connectionStore.js";
import { workflowEventEmitter } from "./workflowEventEmitter.js";
import { logger } from "../../utils/logger.js";
import type {
  CompletionContext,
  QueuedContext,
  QueueProcessedContext,
  SettlementPathway,
} from "./types.js";

const WORKFLOW_SOURCE_HEADING = "## Source:";
const WORKFLOW_SECTION_SEPARATOR = "---";

export function resolvePendingKey(
  targetPodId: string,
  runContext?: RunContext,
): string {
  return runContext ? `${runContext.runId}:${targetPodId}` : targetPodId;
}

export function buildRunQueueKey(runId: string, podId: string): string {
  return `${runId}:${podId}`;
}

export function isAutoTriggerable(triggerMode: string): boolean {
  return triggerMode === "auto" || triggerMode === "ai-decide";
}

export function resolveSettlementPathway(
  triggerMode: TriggerMode,
): SettlementPathway {
  return isAutoTriggerable(triggerMode) ? "auto" : "direct";
}

export function getMultiInputGroupConnections(
  canvasId: string,
  targetPodId: string,
): Connection[] {
  const allIncomingConnections = connectionStore.findByTargetPodId(
    canvasId,
    targetPodId,
  );
  return allIncomingConnections.filter((conn) =>
    isAutoTriggerable(conn.triggerMode),
  );
}

export function forEachMultiInputGroupConnection(
  canvasId: string,
  targetPodId: string,
  callback: (conn: Connection) => void,
): void {
  const connections = getMultiInputGroupConnections(canvasId, targetPodId);
  if (connections.length === 0) {
    logger.warn(
      "Workflow",
      "Warn",
      `[forEachMultiInputGroupConnection] 未找到 targetPod ${targetPodId} 的 auto/ai-decide 連線`,
    );
    return;
  }
  for (const conn of connections) {
    callback(conn);
  }
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
  const isolatedContent = `<source-summary>\n${escapeXmlTags(content)}\n</source-summary>`;
  return `以下是從另一個 POD 傳遞過來的內容,請根據這些資訊繼續處理:

${isolatedContent}`;
}

export interface ConnectionLogInfo {
  connectionId: string;
  sourceName: string | undefined;
  sourcePodId: string;
  targetName: string | undefined;
  targetPodId: string;
}

export function formatConnectionLog(info: ConnectionLogInfo): string {
  const { connectionId, sourceName, sourcePodId, targetName, targetPodId } =
    info;
  return `連線 ${connectionId}（「${sourceName ?? sourcePodId}」→「${targetName ?? targetPodId}」）`;
}

export function completeMultiInputConnections(
  context: CompletionContext,
  success: boolean,
  error?: string,
): void {
  forEachMultiInputGroupConnection(
    context.canvasId,
    context.targetPodId,
    (conn) => {
      if (!context.runContext) {
        workflowEventEmitter.emitWorkflowComplete({
          canvasId: context.canvasId,
          connectionId: conn.id,
          sourcePodId: conn.sourcePodId,
          targetPodId: context.targetPodId,
          success,
          error,
          triggerMode: context.triggerMode,
        });
        connectionStore.updateConnectionStatus(
          context.canvasId,
          conn.id,
          "idle",
        );
      }
    },
  );
}

export function buildQueuedPayload(
  context: QueuedContext,
  connectionId: string,
  sourcePodId: string,
): WorkflowQueuedPayload {
  return {
    canvasId: context.canvasId,
    targetPodId: context.targetPodId,
    connectionId,
    sourcePodId,
    position: context.position,
    queueSize: context.queueSize,
    triggerMode: context.triggerMode,
  };
}

export function createMultiInputCompletionHandlers(): {
  onComplete(
    context: CompletionContext,
    success: boolean,
    error?: string,
  ): void;
  onError(context: CompletionContext, errorMessage: string): void;
} {
  return {
    onComplete(
      context: CompletionContext,
      success: boolean,
      error?: string,
    ): void {
      completeMultiInputConnections(context, success, error);
    },
    onError(context: CompletionContext, errorMessage: string): void {
      completeMultiInputConnections(context, false, errorMessage);
    },
  };
}

export function buildQueueProcessedPayload(
  context: QueueProcessedContext,
): WorkflowQueueProcessedPayload {
  return {
    canvasId: context.canvasId,
    targetPodId: context.targetPodId,
    connectionId: context.connectionId,
    sourcePodId: context.sourcePodId,
    remainingQueueSize: context.remainingQueueSize,
    triggerMode: context.triggerMode,
  };
}

export function emitQueueProcessed(context: QueueProcessedContext): void {
  if (context.runContext) return;
  workflowEventEmitter.emitWorkflowQueueProcessed(
    context.canvasId,
    buildQueueProcessedPayload(context),
  );
}
