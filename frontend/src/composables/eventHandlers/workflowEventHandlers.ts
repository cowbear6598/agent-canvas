import { WebSocketResponseEvents } from "@/services/websocket";
import { useConnectionStore } from "@/stores/connectionStore";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowBranchTriggeredPayload,
  WorkflowCompletePayload,
  WorkflowDirectTriggeredPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "@/types/websocket/responses";

const handleWorkflowAutoTriggered = (
  payload: WorkflowAutoTriggeredPayload,
): void => {
  useConnectionStore().updateAutoGroupStatus(payload.targetPodId, "active");
};

const handleWorkflowBranchTriggered = (
  payload: WorkflowBranchTriggeredPayload,
): void => {
  useConnectionStore().updateAutoGroupStatus(payload.targetPodId, "active");
};

const handleWorkflowComplete = (payload: WorkflowCompletePayload): void => {
  const store = useConnectionStore();

  if (payload.triggerMode === "auto" || payload.triggerMode === "branch") {
    store.updateAutoGroupStatus(payload.targetPodId, "idle");
    return;
  }

  store.setConnectionStatus(payload.connectionId, "idle");
};

const handleWorkflowDirectTriggered = (
  payload: WorkflowDirectTriggeredPayload,
): void => {
  useConnectionStore().setConnectionStatus(payload.connectionId, "active");
};

const handleWorkflowQueued = (payload: WorkflowQueuedPayload): void => {
  const store = useConnectionStore();

  if (payload.triggerMode === "auto" || payload.triggerMode === "branch") {
    store.updateAutoGroupStatus(payload.targetPodId, "queued");
    return;
  }

  store.setConnectionStatus(payload.connectionId, "queued");
};

const handleWorkflowQueueProcessed = (
  payload: WorkflowQueueProcessedPayload,
): void => {
  const store = useConnectionStore();

  if (payload.triggerMode === "auto" || payload.triggerMode === "branch") {
    store.updateAutoGroupStatus(payload.targetPodId, "active");
    return;
  }

  store.setConnectionStatus(payload.connectionId, "active");
};

export function getWorkflowEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
      handler: handleWorkflowAutoTriggered as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_COMPLETE,
      handler: handleWorkflowComplete as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_BRANCH_TRIGGERED,
      handler: handleWorkflowBranchTriggered as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED,
      handler: handleWorkflowDirectTriggered as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_QUEUED,
      handler: handleWorkflowQueued as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED,
      handler: handleWorkflowQueueProcessed as (payload: unknown) => void,
    },
  ];
}
