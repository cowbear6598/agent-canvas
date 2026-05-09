import type { Connection, ConnectionStatus } from "@/types/connection";
import { isAutoTriggerable } from "@/lib/workflowUtils";
import type {
  WorkflowAutoTriggeredPayload,
  WorkflowCompletePayload,
  WorkflowBranchTriggeredPayload,
  WorkflowDirectTriggeredPayload,
  WorkflowDirectWaitingPayload,
  WorkflowQueuedPayload,
  WorkflowQueueProcessedPayload,
} from "@/types/websocket";

interface WorkflowHandlerStore {
  connections: Connection[];
  updateAutoGroupStatus: (
    targetPodId: string,
    status: ConnectionStatus,
  ) => void;
  setConnectionStatus: (connectionId: string, status: ConnectionStatus) => void;
}

function updateConnectionOrGroupStatus(
  store: WorkflowHandlerStore,
  connectionId: string,
  targetPodId: string,
  triggerMode: string | undefined,
  status: ConnectionStatus,
): void {
  if (isAutoTriggerable(triggerMode)) {
    store.updateAutoGroupStatus(targetPodId, status);
  } else {
    store.setConnectionStatus(connectionId, status);
  }
}

export function createWorkflowEventHandlers(store: WorkflowHandlerStore): {
  handleWorkflowAutoTriggered: (payload: WorkflowAutoTriggeredPayload) => void;
  handleWorkflowBranchTriggered: (
    payload: WorkflowBranchTriggeredPayload,
  ) => void;
  handleWorkflowComplete: (payload: WorkflowCompletePayload) => void;
  handleWorkflowDirectTriggered: (
    payload: WorkflowDirectTriggeredPayload,
  ) => void;
  handleWorkflowDirectWaiting: (payload: WorkflowDirectWaitingPayload) => void;
  handleWorkflowQueued: (payload: WorkflowQueuedPayload) => void;
  handleWorkflowQueueProcessed: (
    payload: WorkflowQueueProcessedPayload,
  ) => void;
} {
  const handleWorkflowAutoTriggered = (
    payload: WorkflowAutoTriggeredPayload,
  ): void => {
    store.updateAutoGroupStatus(payload.targetPodId, "active");
  };

  const handleWorkflowBranchTriggered = (
    payload: WorkflowBranchTriggeredPayload,
  ): void => {
    store.updateAutoGroupStatus(payload.targetPodId, "active");
  };

  const handleWorkflowComplete = (payload: WorkflowCompletePayload): void => {
    updateConnectionOrGroupStatus(
      store,
      payload.connectionId,
      payload.targetPodId,
      payload.triggerMode,
      "idle",
    );
  };

  const handleWorkflowDirectTriggered = (
    payload: WorkflowDirectTriggeredPayload,
  ): void => {
    store.setConnectionStatus(payload.connectionId, "active");
  };

  const handleWorkflowDirectWaiting = (
    payload: WorkflowDirectWaitingPayload,
  ): void => {
    store.setConnectionStatus(payload.connectionId, "waiting");
  };

  const handleWorkflowQueued = (payload: WorkflowQueuedPayload): void => {
    updateConnectionOrGroupStatus(
      store,
      payload.connectionId,
      payload.targetPodId,
      payload.triggerMode,
      "queued",
    );
  };

  const handleWorkflowQueueProcessed = (
    payload: WorkflowQueueProcessedPayload,
  ): void => {
    updateConnectionOrGroupStatus(
      store,
      payload.connectionId,
      payload.targetPodId,
      payload.triggerMode,
      "active",
    );
  };

  return {
    handleWorkflowAutoTriggered,
    handleWorkflowBranchTriggered,
    handleWorkflowComplete,
    handleWorkflowDirectTriggered,
    handleWorkflowDirectWaiting,
    handleWorkflowQueued,
    handleWorkflowQueueProcessed,
  };
}
