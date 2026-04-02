import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AnchorPosition,
  Connection,
  ConnectionStatus,
  DraggingConnection,
  TriggerMode,
  WorkflowRole,
} from "@/types/connection";
import type { ModelType } from "@/types/pod";
import { usePodStore } from "@/stores/pod/podStore";
import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import { t } from "@/i18n";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { DEFAULT_SUMMARY_MODEL, DEFAULT_AI_DECIDE_MODEL } from "@/types/config";
import { createWorkflowEventHandlers } from "./workflowEventHandlers";
import { removeById } from "@/lib/arrayHelpers";
import type {
  ConnectionCreatedPayload,
  ConnectionUpdatedPayload,
  ConnectionCreatePayload,
  ConnectionDeletedPayload,
  ConnectionDeletePayload,
  ConnectionListPayload,
  ConnectionListResultPayload,
  ConnectionUpdatePayload,
} from "@/types/websocket";

interface RawConnection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: "auto" | "ai-decide" | "direct";
  summaryModel?: ModelType;
  aiDecideModel?: ModelType;
  connectionStatus?: string;
  decideReason?: string | null;
}

type WorkflowHandlers = ReturnType<typeof createWorkflowEventHandlers>;
type WorkflowHandlerPayload<K extends keyof WorkflowHandlers> = Parameters<
  WorkflowHandlers[K]
>[0];

function castHandler<T>(
  handler: (payload: T) => void,
): (payload: unknown) => void {
  return handler as (payload: unknown) => void;
}

function normalizeConnection(raw: RawConnection): Connection {
  return {
    ...raw,
    triggerMode: (raw.triggerMode ?? "auto") as TriggerMode,
    summaryModel: raw.summaryModel ?? DEFAULT_SUMMARY_MODEL,
    aiDecideModel: raw.aiDecideModel ?? DEFAULT_AI_DECIDE_MODEL,
    status: (raw.connectionStatus as ConnectionStatus) ?? "idle",
    decideReason: raw.decideReason ?? undefined,
  };
}

const RUNNING_CONNECTION_STATUSES = new Set<ConnectionStatus>([
  "active",
  "queued",
  "waiting",
  "ai-deciding",
  "ai-approved",
]);

const RUNNING_POD_STATUSES = new Set(["chatting", "summarizing"]);

function shouldUpdateConnection(
  connection: Connection,
  targetPodId: string,
  status: ConnectionStatus,
): boolean {
  if (connection.targetPodId !== targetPodId) return false;
  if (
    connection.triggerMode !== "auto" &&
    connection.triggerMode !== "ai-decide"
  )
    return false;
  // ai-deciding 表示 AI 仍在判斷中，不應被強制設為 active（事件亂序保護）
  if (connection.status === "ai-deciding" && status === "active") return false;
  return true;
}

/**
 * 使用 BFS 而非 DFS，確保在循環或極長鏈中不會發生堆疊溢位，
 * 並能在找到第一個執行中節點時提前返回，避免遍歷整條鏈。
 */
function isAnyNeighborRunning(
  neighbors: { neighborId: string; connection: Connection }[],
  visited: Set<string>,
  queue: string[],
): boolean {
  for (const { neighborId, connection } of neighbors) {
    if (connection.status && RUNNING_CONNECTION_STATUSES.has(connection.status))
      return true;
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }
  return false;
}

function processBfsNode(
  currentId: string,
  getNeighbors: (
    podId: string,
  ) => { neighborId: string; connection: Connection }[],
  isRunningPod: (podId: string) => boolean,
  visited: Set<string>,
  queue: string[],
): boolean {
  if (isRunningPod(currentId)) return true;
  return isAnyNeighborRunning(getNeighbors(currentId), visited, queue);
}

function runBFS(
  startId: string,
  getNeighbors: (
    podId: string,
  ) => { neighborId: string; connection: Connection }[],
  isRunningPod: (podId: string) => boolean,
): boolean {
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    if (processBfsNode(currentId, getNeighbors, isRunningPod, visited, queue))
      return true;
  }
  return false;
}

function buildIsRunningPod(
  podStore: ReturnType<typeof usePodStore>,
): (podId: string) => boolean {
  return (podId: string) => {
    const pod = podStore.getPodById(podId);
    return pod !== undefined && RUNNING_POD_STATUSES.has(pod.status ?? "");
  };
}

export const useConnectionStore = defineStore("connection", () => {
  const { executeAction } = useCanvasWebSocketAction();
  const { toast } = useToast();

  const connections = ref<Connection[]>([]);
  const selectedConnectionId = ref<string | null>(null);
  const draggingConnection = ref<DraggingConnection | null>(null);

  const getConnectionsByPodId = computed(
    () =>
      (podId: string): Connection[] => {
        return connections.value.filter(
          (connection) =>
            connection.sourcePodId === podId ||
            connection.targetPodId === podId,
        );
      },
  );

  const getOutgoingConnections = computed(
    () =>
      (podId: string): Connection[] => {
        return connections.value.filter(
          (connection) => connection.sourcePodId === podId,
        );
      },
  );

  const getConnectionsByTargetPodId = computed(
    () =>
      (podId: string): Connection[] => {
        return connections.value.filter(
          (connection) => connection.targetPodId === podId,
        );
      },
  );

  const selectedConnection = computed((): Connection | null => {
    if (!selectedConnectionId.value) return null;
    return (
      connections.value.find(
        (connection) => connection.id === selectedConnectionId.value,
      ) || null
    );
  });

  const isSourcePod = computed(() => (podId: string): boolean => {
    return !connections.value.some(
      (connection) => connection.targetPodId === podId,
    );
  });

  const hasUpstreamConnections = computed(() => (podId: string): boolean => {
    return connections.value.some(
      (connection) => connection.targetPodId === podId,
    );
  });

  const getAiDecideConnectionsBySourcePodId = computed(
    () =>
      (sourcePodId: string): Connection[] => {
        return connections.value.filter(
          (connection) =>
            connection.sourcePodId === sourcePodId &&
            connection.triggerMode === "ai-decide",
        );
      },
  );

  const getPodWorkflowRole = computed(() => (podId: string): WorkflowRole => {
    const hasUpstream = connections.value.some(
      (connection) => connection.targetPodId === podId,
    );
    const hasDownstream = connections.value.some(
      (connection) => connection.sourcePodId === podId,
    );

    if (!hasUpstream && !hasDownstream) return "independent";
    if (!hasUpstream && hasDownstream) return "head";
    if (hasUpstream && !hasDownstream) return "tail";
    return "middle";
  });

  /**
   * 雙向 BFS 遍歷整條 Workflow 鏈（上游 + 下游），
   * 讓 head、tail 或任何連線中的 Pod 都能感知整條鏈的執行狀態，
   * 用於在 Workflow 執行中時封鎖對應 Pod 的輸入。
   */
  const isPartOfRunningWorkflow = computed(() => (podId: string): boolean => {
    const podStore = usePodStore();

    return runBFS(
      podId,
      (currentId) => {
        const neighbors: { neighborId: string; connection: Connection }[] = [];
        for (const connection of connections.value) {
          if (connection.sourcePodId === currentId) {
            neighbors.push({ neighborId: connection.targetPodId, connection });
          }
          if (connection.targetPodId === currentId && connection.sourcePodId) {
            neighbors.push({ neighborId: connection.sourcePodId, connection });
          }
        }
        return neighbors;
      },
      buildIsRunningPod(podStore),
    );
  });

  /**
   * 單向下游 BFS，從指定 Pod 出發往下游遍歷，
   * 用於判斷從某個 head Pod 觸發的 Workflow 是否仍在執行中，
   * 以決定是否允許再次觸發。
   */
  const isWorkflowRunning = computed(() => (sourcePodId: string): boolean => {
    const podStore = usePodStore();

    return runBFS(
      sourcePodId,
      (currentId) => {
        return connections.value
          .filter((connection) => connection.sourcePodId === currentId)
          .map((connection) => ({
            neighborId: connection.targetPodId,
            connection,
          }));
      },
      buildIsRunningPod(podStore),
    );
  });

  function findConnectionById(connectionId: string): Connection | undefined {
    return connections.value.find(
      (connection) => connection.id === connectionId,
    );
  }

  function updateAutoGroupStatus(
    targetPodId: string,
    status: ConnectionStatus,
  ): void {
    connections.value.forEach((connection) => {
      if (shouldUpdateConnection(connection, targetPodId, status)) {
        connection.status = status;
      }
    });
  }

  function setConnectionStatus(
    connectionId: string,
    status: ConnectionStatus,
  ): void {
    const connection = findConnectionById(connectionId);
    if (connection) {
      connection.status = status;
    }
  }

  function getWorkflowHandlers(): WorkflowHandlers {
    return createWorkflowEventHandlers({
      connections: connections.value,
      findConnectionById,
      updateAutoGroupStatus,
      setConnectionStatus,
    });
  }

  function getWorkflowEventMap(): Array<[string, (payload: unknown) => void]> {
    return [
      [
        WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
        castHandler(handleWorkflowAutoTriggered),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_COMPLETE,
        castHandler(handleWorkflowComplete),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_AI_DECIDE_PENDING,
        castHandler(handleAiDecidePending),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_AI_DECIDE_RESULT,
        castHandler(handleAiDecideResult),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_AI_DECIDE_ERROR,
        castHandler(handleAiDecideError),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_AI_DECIDE_CLEAR,
        castHandler(handleAiDecideClear),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_AI_DECIDE_TRIGGERED,
        castHandler(handleWorkflowAiDecideTriggered),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED,
        castHandler(handleWorkflowDirectTriggered),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_DIRECT_WAITING,
        castHandler(handleWorkflowDirectWaiting),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_QUEUED,
        castHandler(handleWorkflowQueued),
      ],
      [
        WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED,
        castHandler(handleWorkflowQueueProcessed),
      ],
    ];
  }

  async function loadConnectionsFromBackend(): Promise<void> {
    const canvasId = getActiveCanvasIdOrWarn("ConnectionStore");
    if (!canvasId) return;

    const response = await createWebSocketRequest<
      ConnectionListPayload,
      ConnectionListResultPayload
    >({
      requestEvent: WebSocketRequestEvents.CONNECTION_LIST,
      responseEvent: WebSocketResponseEvents.CONNECTION_LIST_RESULT,
      payload: {
        canvasId,
      },
    });

    if (response.connections) {
      connections.value = response.connections.map((connection) =>
        normalizeConnection(connection),
      );
    }
  }

  function validateNewConnection(
    sourcePodId: string | undefined | null,
    targetPodId: string,
  ): boolean {
    if (sourcePodId === targetPodId) {
      console.warn("[ConnectionStore] 無法將 Pod 連接到自身");
      return false;
    }

    if (!sourcePodId) return true;

    const alreadyConnected = connections.value.some(
      (connection) =>
        connection.sourcePodId === sourcePodId &&
        connection.targetPodId === targetPodId,
    );
    if (alreadyConnected) {
      toast({
        title: t("store.connection.alreadyExists"),
        description: t("store.connection.alreadyExistsDesc"),
        duration: DEFAULT_TOAST_DURATION_MS,
      });
      return false;
    }

    return true;
  }

  async function createConnection(
    sourcePodId: string | undefined | null,
    sourceAnchor: AnchorPosition,
    targetPodId: string,
    targetAnchor: AnchorPosition,
  ): Promise<Connection | null> {
    if (!validateNewConnection(sourcePodId, targetPodId)) return null;

    const basePayload: {
      sourceAnchor: AnchorPosition;
      targetPodId: string;
      targetAnchor: AnchorPosition;
      sourcePodId?: string;
    } = {
      sourceAnchor,
      targetPodId,
      targetAnchor,
    };
    if (sourcePodId) {
      basePayload.sourcePodId = sourcePodId;
    }

    const result = await executeAction<
      ConnectionCreatePayload,
      ConnectionCreatedPayload
    >(
      {
        requestEvent: WebSocketRequestEvents.CONNECTION_CREATE,
        responseEvent: WebSocketResponseEvents.CONNECTION_CREATED,
        payload: basePayload,
      },
      {
        errorCategory: "Connection",
        errorAction: t("common.error.create"),
        errorMessage: t("store.connection.createFailed"),
      },
    );

    if (!result.success || !result.data.connection) return null;

    return normalizeConnection(result.data.connection);
  }

  async function deleteConnection(connectionId: string): Promise<void> {
    await executeAction<ConnectionDeletePayload, ConnectionDeletedPayload>(
      {
        requestEvent: WebSocketRequestEvents.CONNECTION_DELETE,
        responseEvent: WebSocketResponseEvents.CONNECTION_DELETED,
        payload: { connectionId },
      },
      {
        errorCategory: "Connection",
        errorAction: t("common.error.delete"),
        errorMessage: t("store.connection.deleteFailed"),
      },
    );
  }

  function deleteConnectionsByPodId(podId: string): void {
    connections.value = connections.value.filter(
      (connection) =>
        connection.sourcePodId !== podId && connection.targetPodId !== podId,
    );

    if (selectedConnectionId.value) {
      const stillExists = connections.value.some(
        (connection) => connection.id === selectedConnectionId.value,
      );
      if (!stillExists) {
        selectedConnectionId.value = null;
      }
    }
  }

  function selectConnection(connectionId: string | null): void {
    selectedConnectionId.value = connectionId;
  }

  function startDragging(
    sourcePodId: string | undefined | null,
    sourceAnchor: AnchorPosition,
    startPoint: { x: number; y: number },
  ): void {
    draggingConnection.value = {
      sourcePodId: sourcePodId ?? undefined,
      sourceAnchor,
      startPoint,
      currentPoint: startPoint,
    };
  }

  function updateDraggingPosition(currentPoint: {
    x: number;
    y: number;
  }): void {
    if (draggingConnection.value) {
      draggingConnection.value.currentPoint = currentPoint;
    }
  }

  function endDragging(): void {
    draggingConnection.value = null;
  }

  async function executeConnectionUpdate(
    connectionId: string,
    updates: Pick<
      ConnectionUpdatePayload,
      "triggerMode" | "summaryModel" | "aiDecideModel"
    >,
    errorMessage: string,
  ): Promise<Connection | null> {
    const result = await executeAction<
      ConnectionUpdatePayload,
      ConnectionUpdatedPayload
    >(
      {
        requestEvent: WebSocketRequestEvents.CONNECTION_UPDATE,
        responseEvent: WebSocketResponseEvents.CONNECTION_UPDATED,
        payload: { connectionId, ...updates },
      },
      {
        errorCategory: "Connection",
        errorAction: t("common.error.update"),
        errorMessage,
      },
    );

    if (!result.success || !result.data.connection) return null;

    return normalizeConnection(result.data.connection);
  }

  async function updateConnectionTriggerMode(
    connectionId: string,
    triggerMode: TriggerMode,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { triggerMode },
      t("store.connection.updateFailed"),
    );
  }

  async function updateConnectionSummaryModel(
    connectionId: string,
    summaryModel: ModelType,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { summaryModel },
      t("store.connection.summaryModelUpdateFailed"),
    );
  }

  async function updateConnectionAiDecideModel(
    connectionId: string,
    aiDecideModel: ModelType,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { aiDecideModel },
      t("store.connection.aiDecideModelUpdateFailed"),
    );
  }

  function setupWorkflowListeners(): void {
    getWorkflowEventMap().forEach(([event, handler]) => {
      websocketClient.on(event, handler);
    });
  }

  function cleanupWorkflowListeners(): void {
    getWorkflowEventMap().forEach(([event, handler]) => {
      websocketClient.off(event, handler);
    });
  }

  function handleWorkflowAutoTriggered(
    payload: WorkflowHandlerPayload<"handleWorkflowAutoTriggered">,
  ): void {
    getWorkflowHandlers().handleWorkflowAutoTriggered(payload);
  }

  function handleWorkflowAiDecideTriggered(
    payload: WorkflowHandlerPayload<"handleWorkflowAiDecideTriggered">,
  ): void {
    getWorkflowHandlers().handleWorkflowAiDecideTriggered(payload);
  }

  function handleWorkflowComplete(
    payload: WorkflowHandlerPayload<"handleWorkflowComplete">,
  ): void {
    getWorkflowHandlers().handleWorkflowComplete(payload);
  }

  function handleWorkflowDirectTriggered(
    payload: WorkflowHandlerPayload<"handleWorkflowDirectTriggered">,
  ): void {
    getWorkflowHandlers().handleWorkflowDirectTriggered(payload);
  }

  function handleWorkflowDirectWaiting(
    payload: WorkflowHandlerPayload<"handleWorkflowDirectWaiting">,
  ): void {
    getWorkflowHandlers().handleWorkflowDirectWaiting(payload);
  }

  function handleWorkflowQueued(
    payload: WorkflowHandlerPayload<"handleWorkflowQueued">,
  ): void {
    getWorkflowHandlers().handleWorkflowQueued(payload);
  }

  function handleWorkflowQueueProcessed(
    payload: WorkflowHandlerPayload<"handleWorkflowQueueProcessed">,
  ): void {
    getWorkflowHandlers().handleWorkflowQueueProcessed(payload);
  }

  function handleAiDecidePending(
    payload: WorkflowHandlerPayload<"handleAiDecidePending">,
  ): void {
    getWorkflowHandlers().handleAiDecidePending(payload);
  }

  function handleAiDecideResult(
    payload: WorkflowHandlerPayload<"handleAiDecideResult">,
  ): void {
    getWorkflowHandlers().handleAiDecideResult(payload);
  }

  function handleAiDecideError(
    payload: WorkflowHandlerPayload<"handleAiDecideError">,
  ): void {
    getWorkflowHandlers().handleAiDecideError(payload);
  }

  function handleAiDecideClear(
    payload: WorkflowHandlerPayload<"handleAiDecideClear">,
  ): void {
    getWorkflowHandlers().handleAiDecideClear(payload);
  }

  function clearAiDecideStatusByConnectionIds(connectionIds: string[]): void {
    getWorkflowHandlers().clearAiDecideStatusByConnectionIds(connectionIds);
  }

  function addConnectionFromEvent(
    connection: Omit<Connection, "status">,
  ): void {
    const enrichedConnection: Connection = {
      ...connection,
      triggerMode: connection.triggerMode ?? "auto",
      status: "idle" as ConnectionStatus,
    };

    const exists = connections.value.some(
      (existingConnection) => existingConnection.id === enrichedConnection.id,
    );
    if (!exists) {
      connections.value.push(enrichedConnection);
    }
  }

  function updateConnectionFromEvent(
    connection: Omit<Connection, "status">,
  ): void {
    const index = connections.value.findIndex(
      (existing) => existing.id === connection.id,
    );
    if (index === -1) return;

    const existingConnection = connections.value[index];
    const enrichedConnection: Connection = {
      ...connection,
      triggerMode: connection.triggerMode ?? "auto",
      summaryModel:
        connection.summaryModel ??
        existingConnection?.summaryModel ??
        DEFAULT_SUMMARY_MODEL,
      aiDecideModel:
        connection.aiDecideModel ??
        existingConnection?.aiDecideModel ??
        DEFAULT_AI_DECIDE_MODEL,
      status: existingConnection?.status ?? ("idle" as ConnectionStatus),
      decideReason: connection.decideReason ?? existingConnection?.decideReason,
    };

    connections.value.splice(index, 1, enrichedConnection);
  }

  function removeConnectionFromEvent(connectionId: string): void {
    connections.value = removeById(connections.value, connectionId);
  }

  return {
    connections,
    selectedConnectionId,
    draggingConnection,
    getConnectionsByPodId,
    getOutgoingConnections,
    getConnectionsByTargetPodId,
    selectedConnection,
    isSourcePod,
    hasUpstreamConnections,
    getAiDecideConnectionsBySourcePodId,
    getPodWorkflowRole,
    isPartOfRunningWorkflow,
    isWorkflowRunning,
    findConnectionById,
    getWorkflowEventMap,
    loadConnectionsFromBackend,
    validateNewConnection,
    createConnection,
    deleteConnection,
    deleteConnectionsByPodId,
    selectConnection,
    startDragging,
    updateDraggingPosition,
    endDragging,
    updateAutoGroupStatus,
    setConnectionStatus,
    updateConnectionTriggerMode,
    updateConnectionSummaryModel,
    updateConnectionAiDecideModel,
    getWorkflowHandlers,
    setupWorkflowListeners,
    cleanupWorkflowListeners,
    handleWorkflowAutoTriggered,
    handleWorkflowAiDecideTriggered,
    handleWorkflowComplete,
    handleWorkflowDirectTriggered,
    handleWorkflowDirectWaiting,
    handleWorkflowQueued,
    handleWorkflowQueueProcessed,
    handleAiDecidePending,
    handleAiDecideResult,
    handleAiDecideError,
    handleAiDecideClear,
    clearAiDecideStatusByConnectionIds,
    addConnectionFromEvent,
    updateConnectionFromEvent,
    removeConnectionFromEvent,
  };
});
