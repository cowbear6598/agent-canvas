import { WebSocketResponseEvents } from "../schemas";
import type {
  RunDeletePayload,
  RunLoadHistoryPayload,
  RunLoadPodMessagesPayload,
} from "../schemas";
import { runExecutionService } from "../services/workflow/runExecutionService.js";
import { runStore } from "../services/runStore.js";
import { podStore } from "../services/podStore.js";
import { emitSuccess, emitError } from "../utils/websocketResponse.js";
import { createI18nError } from "../utils/i18nError.js";
import { withCanvasId } from "../utils/handlerHelpers.js";
import type { WorkflowRun } from "../services/runStore.js";
import { sanitizePersistedMessageForClient } from "../services/systemMessageMetadata.js";
import type { RunChatTimelineItem } from "../types/run.js";
import type { PersistedRunGoalRoundDivider } from "../types/persistence.js";

function isRunGoalRoundDivider(
  item: RunChatTimelineItem,
): item is PersistedRunGoalRoundDivider {
  return "type" in item && item.type === "goal-round-divider";
}

function findRunOrEmitNotFound(
  connectionId: string,
  canvasId: string,
  runId: string,
  event: WebSocketResponseEvents,
  requestId: string,
): WorkflowRun | undefined {
  const run = runStore.getRun(runId);
  if (!run || run.canvasId !== canvasId) {
    emitError(
      connectionId,
      event,
      createI18nError("errors.runNotFound"),
      canvasId,
      requestId,
      undefined,
      "NOT_FOUND",
    );
    return undefined;
  }
  return run;
}

export const handleRunDelete = withCanvasId<RunDeletePayload>(
  WebSocketResponseEvents.RUN_DELETED,
  async (
    connectionId: string,
    canvasId: string,
    payload: RunDeletePayload,
    requestId: string,
  ): Promise<void> => {
    const { runId } = payload;

    const run = findRunOrEmitNotFound(
      connectionId,
      canvasId,
      runId,
      WebSocketResponseEvents.RUN_DELETED,
      requestId,
    );
    if (!run) return;

    try {
      await runExecutionService.deleteRun(runId);
      emitSuccess(connectionId, WebSocketResponseEvents.RUN_DELETED, {
        requestId,
        success: true,
        canvasId,
        runId,
      });
    } catch (error) {
      emitError(
        connectionId,
        WebSocketResponseEvents.RUN_DELETED,
        error instanceof Error ? error : new Error(String(error)),
        canvasId,
        requestId,
      );
    }
  },
);

export const handleRunLoadHistory = withCanvasId<RunLoadHistoryPayload>(
  WebSocketResponseEvents.RUN_HISTORY_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    _payload: RunLoadHistoryPayload,
    requestId: string,
  ): Promise<void> => {
    const runs = runStore.getRunsByCanvasId(canvasId);

    const runsWithInstances = runs.map((run) => {
      const instances = runStore.getPodInstancesByRunId(run.id);
      const sourcePod = podStore.getById(canvasId, run.sourcePodId);
      const sourcePodName = sourcePod?.name ?? run.sourcePodId;

      const podInstances = instances.map((instance) => {
        const {
          runRepoPath: _runRepoPath,
          workspacePath: _workspacePath,
          sessionId: _sessionId,
          ...instanceData
        } = instance;
        const pod = podStore.getById(canvasId, instance.podId);
        return {
          ...instanceData,
          podName: pod?.name ?? instance.podId,
        };
      });

      return { ...run, podInstances, sourcePodName };
    });

    emitSuccess(connectionId, WebSocketResponseEvents.RUN_HISTORY_RESULT, {
      requestId,
      success: true,
      runs: runsWithInstances,
    });
  },
);

export const handleRunLoadPodMessages = withCanvasId<RunLoadPodMessagesPayload>(
  WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
  async (
    connectionId: string,
    canvasId: string,
    payload: RunLoadPodMessagesPayload,
    requestId: string,
  ): Promise<void> => {
    const { runId, podId, cursor, limit } = payload;

    const run = findRunOrEmitNotFound(
      connectionId,
      canvasId,
      runId,
      WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
      requestId,
    );
    if (!run) return;

    const result = runStore.getRunMessagesPage(runId, podId, {
      cursor,
      limit,
    });

    emitSuccess(connectionId, WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT, {
      requestId,
      success: true,
      runId,
      podId,
      timelineItems: result.timelineItems.map((item) =>
        isRunGoalRoundDivider(item)
          ? item
          : sanitizePersistedMessageForClient(item),
      ),
      pageInfo: result.pageInfo,
    });
  },
);
