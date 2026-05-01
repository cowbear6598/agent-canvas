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
import type { ModelType, PodProvider } from "@/types/pod";
import { usePodStore } from "@/stores/pod/podStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
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
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { createWorkflowEventHandlers } from "./workflowEventHandlers";
import { removeById } from "@/lib/arrayHelpers";
import { logger } from "@/utils/logger";
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
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /** Summary 功能獨立選用的 Provider；升級前 Connection 為 null/undefined */
  summaryProvider?: PodProvider | null;
  aiDecideModel?: ModelType;
  connectionStatus?: string;
  decideReason?: string | null;
}

type WorkflowHandlers = ReturnType<typeof createWorkflowEventHandlers>;

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
    // summaryProvider 直接帶入，不加 fallback；UI 層自行決定如何顯示 null/undefined
    summaryProvider: raw.summaryProvider,
    aiDecideModel: raw.aiDecideModel ?? DEFAULT_AI_DECIDE_MODEL,
    status: (raw.connectionStatus ?? "idle") as ConnectionStatus,
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

/**
 * 事件亂序保護：當 connection 正在 AI 決策中，不允許被 active 事件覆蓋。
 * 防止排程或其他觸發路徑的 active 事件在 ai-deciding 期間改變狀態，
 * 導致 AI 決策結果被忽略或狀態機進入不一致情況。
 */
function isOutOfOrderUpdate(
  currentStatus: ConnectionStatus | undefined,
  incomingStatus: ConnectionStatus,
): boolean {
  return currentStatus === "ai-deciding" && incomingStatus === "active";
}

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
  if (isOutOfOrderUpdate(connection.status, status)) return false;
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
    if (
      connection.status !== undefined &&
      RUNNING_CONNECTION_STATUSES.has(connection.status)
    )
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
    return (
      pod !== undefined &&
      (pod.status ? RUNNING_POD_STATUSES.has(pod.status) : false)
    );
  };
}

export const useConnectionStore = defineStore("connection", () => {
  const { executeAction } = useCanvasWebSocketAction();
  const { toast, showErrorToast } = useToast();
  const podStore = usePodStore();
  const providerCapabilityStore = useProviderCapabilityStore();

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
   * 一次性建立雙向鄰接表（Map<podId, neighbors>），
   * 供同一次 BFS 呼叫內的所有節點共用，避免每個節點都全表掃描（O(n) 建表，O(degree) 查詢）。
   */
  function buildBidirectionalAdjacencyMap(): Map<
    string,
    { neighborId: string; connection: Connection }[]
  > {
    const map = new Map<
      string,
      { neighborId: string; connection: Connection }[]
    >();
    for (const connection of connections.value) {
      if (connection.sourcePodId) {
        // 下游方向：source → target
        const srcList = map.get(connection.sourcePodId) ?? [];
        srcList.push({ neighborId: connection.targetPodId, connection });
        map.set(connection.sourcePodId, srcList);
        // 上游方向：target → source
        const tgtList = map.get(connection.targetPodId) ?? [];
        tgtList.push({ neighborId: connection.sourcePodId, connection });
        map.set(connection.targetPodId, tgtList);
      }
    }
    return map;
  }

  /**
   * 一次性建立下游鄰接表（Map<podId, neighbors>），
   * 供下游單向 BFS 共用，避免 filter 全表掃描。
   */
  function buildDownstreamAdjacencyMap(): Map<
    string,
    { neighborId: string; connection: Connection }[]
  > {
    const map = new Map<
      string,
      { neighborId: string; connection: Connection }[]
    >();
    for (const connection of connections.value) {
      if (connection.sourcePodId) {
        const list = map.get(connection.sourcePodId) ?? [];
        list.push({ neighborId: connection.targetPodId, connection });
        map.set(connection.sourcePodId, list);
      }
    }
    return map;
  }

  /**
   * 雙向 BFS 遍歷整條 Workflow 鏈（上游 + 下游），
   * 讓 head、tail 或任何連線中的 Pod 都能感知整條鏈的執行狀態，
   * 用於在 Workflow 執行中時封鎖對應 Pod 的輸入。
   * 每次呼叫預先建立鄰接表（O(n)），BFS 查詢降為 O(degree)。
   */
  const isPartOfRunningWorkflow = computed(() => (podId: string): boolean => {
    const adjMap = buildBidirectionalAdjacencyMap();
    return runBFS(
      podId,
      (currentId) => adjMap.get(currentId) ?? [],
      buildIsRunningPod(podStore),
    );
  });

  /**
   * 單向下游 BFS，從指定 Pod 出發往下游遍歷，
   * 用於判斷從某個 head Pod 觸發的 Workflow 是否仍在執行中，
   * 以決定是否允許再次觸發。
   * 每次呼叫預先建立鄰接表（O(n)），BFS 查詢降為 O(degree)。
   */
  const isWorkflowRunning = computed(() => (sourcePodId: string): boolean => {
    const adjMap = buildDownstreamAdjacencyMap();
    return runBFS(
      sourcePodId,
      (currentId) => adjMap.get(currentId) ?? [],
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

  // 快取 handlers 與 event map，確保 setupWorkflowListeners / cleanupWorkflowListeners
  // 拿到的是同一份 handler reference，讓 websocketClient.off() 能正確移除監聽器。
  const workflowHandlers: WorkflowHandlers = createWorkflowEventHandlers({
    connections: connections.value,
    findConnectionById,
    updateAutoGroupStatus,
    setConnectionStatus,
  });

  const workflowEventMap: Array<[string, (payload: unknown) => void]> = [
    [
      WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
      castHandler(workflowHandlers.handleWorkflowAutoTriggered),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_COMPLETE,
      castHandler(workflowHandlers.handleWorkflowComplete),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_AI_DECIDE_PENDING,
      castHandler(workflowHandlers.handleAiDecidePending),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_AI_DECIDE_RESULT,
      castHandler(workflowHandlers.handleAiDecideResult),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_AI_DECIDE_ERROR,
      castHandler(workflowHandlers.handleAiDecideError),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_AI_DECIDE_CLEAR,
      castHandler(workflowHandlers.handleAiDecideClear),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_AI_DECIDE_TRIGGERED,
      castHandler(workflowHandlers.handleWorkflowAiDecideTriggered),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED,
      castHandler(workflowHandlers.handleWorkflowDirectTriggered),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_DIRECT_WAITING,
      castHandler(workflowHandlers.handleWorkflowDirectWaiting),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_QUEUED,
      castHandler(workflowHandlers.handleWorkflowQueued),
    ],
    [
      WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED,
      castHandler(workflowHandlers.handleWorkflowQueueProcessed),
    ],
  ];

  function getWorkflowHandlers(): WorkflowHandlers {
    return workflowHandlers;
  }

  function getWorkflowEventMap(): Array<[string, (payload: unknown) => void]> {
    return workflowEventMap;
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
      logger.warn("[ConnectionStore] 無法將 Pod 連接到自身");
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

    // 依上游 Pod 的 provider 解析預設 summaryModel；
    // 查不到 Pod 或 capability 尚未推送時 fallback 為 DEFAULT_SUMMARY_MODEL
    const sourcePod = sourcePodId
      ? podStore.getPodById(sourcePodId)
      : undefined;
    const resolvedSummaryModel: string =
      (sourcePod
        ? providerCapabilityStore.getDefaultModel(sourcePod.provider)
        : undefined) ?? DEFAULT_SUMMARY_MODEL;

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

    // 後端若未帶回 summaryModel，以上游 provider 預設模型填入
    const rawConnection = result.data.connection;
    if (!rawConnection.summaryModel) {
      rawConnection.summaryModel = resolvedSummaryModel;
    }

    return normalizeConnection(rawConnection);
  }

  async function deleteConnection(connectionId: string): Promise<void> {
    const result = await executeAction<
      ConnectionDeletePayload,
      ConnectionDeletedPayload
    >(
      {
        requestEvent: WebSocketRequestEvents.CONNECTION_DELETE,
        responseEvent: WebSocketResponseEvents.CONNECTION_DELETED,
        payload: { connectionId },
      },
      {
        errorCategory: "Connection",
        errorAction: t("common.error.delete"),
        errorMessage: t("store.connection.deleteFailed"),
        suppressErrorToast: true,
      },
    );

    if (!result.success) {
      // 若 connection 已不存在於 store，代表後端廣播的 CONNECTION_DELETED 已先到達
      // 視為刪除成功，不顯示錯誤 toast
      const stillExists = connections.value.some((c) => c.id === connectionId);
      if (stillExists) {
        showErrorToast("Connection", t("common.error.delete"));
      }
    }
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
    // 選擇 connection 時清除 pod 選擇（互斥），null 代表取消選擇不觸發
    if (connectionId !== null) {
      const selectionStore = useSelectionStore();
      selectionStore.clearSelection();
    }
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
      "triggerMode" | "summaryModel" | "summaryProvider" | "aiDecideModel"
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
    summaryModel: string,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { summaryModel },
      t("store.connection.summaryModelUpdateFailed"),
    );
  }

  /**
   * 同時更新 summaryProvider 與 summaryModel，確保單一 WS 請求送出，
   * 避免 provider/model 出現不一致的中間狀態。
   * 呼叫端負責在呼叫前解析好對應 provider 的預設 model。
   */
  async function updateConnectionSummaryProvider(
    connectionId: string,
    summaryProvider: PodProvider,
    summaryModel: string,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { summaryProvider, summaryModel },
      t("store.connection.summaryModelUpdateFailed"),
    );
  }

  async function updateConnectionAiDecideModel(
    connectionId: string,
    aiDecideModel: string,
  ): Promise<Connection | null> {
    const MODEL_TYPES: ModelType[] = ["opus", "sonnet", "haiku"];
    const validatedModel: ModelType = MODEL_TYPES.includes(
      aiDecideModel as ModelType,
    )
      ? (aiDecideModel as ModelType)
      : "sonnet";
    return executeConnectionUpdate(
      connectionId,
      { aiDecideModel: validatedModel },
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

    const existingConnection = connections.value[index]!;
    const enrichedConnection: Connection = {
      ...connection,
      triggerMode: connection.triggerMode ?? "auto",
      summaryModel:
        connection.summaryModel ??
        existingConnection.summaryModel ??
        DEFAULT_SUMMARY_MODEL,
      // summaryProvider 未帶欄位（undefined）時保留既有值；帶入 null 或具體值則直接寫入
      summaryProvider:
        connection.summaryProvider !== undefined
          ? connection.summaryProvider
          : existingConnection.summaryProvider,
      aiDecideModel:
        connection.aiDecideModel ??
        existingConnection.aiDecideModel ??
        DEFAULT_AI_DECIDE_MODEL,
      status: existingConnection.status,
      decideReason: connection.decideReason ?? existingConnection.decideReason,
    };

    connections.value.splice(index, 1, enrichedConnection);
  }

  function removeConnectionFromEvent(connectionId: string): void {
    connections.value = removeById(connections.value, connectionId);
  }

  /**
   * 當上游 Pod 的 provider 被切換時，自動修正所有以該 Pod 為 source 的 connection summaryModel。
   * 僅在「使用者主動切換 provider」的路徑呼叫，不在初始化載入時觸發，
   * 避免 capability 尚未載入時把合法的 summaryModel 誤重置。
   *
   * 流程：
   * 1. 找出所有 sourcePodId === podId 的 connection
   * 2. 取上游 Pod 當前的 provider
   * 3. 用 isModelValidForProvider 判斷 summaryModel 是否仍合法
   * 4. 若不合法，取 getDefaultModel 作為新值，呼叫 updateConnectionSummaryModel
   */
  /**
   * 純函數：回傳所有 summaryModel 不合法的 connection 及其對應的修正 model。
   * 不發出任何更新，供 reconcileSummaryModelsForPod 使用。
   */
  function getInvalidConnectionsForPod(
    podId: string,
  ): Array<{ connectionId: string; newModel: string }> {
    const pod = podStore.getPodById(podId);
    if (!pod) return [];

    const provider = pod.provider;

    return connections.value
      .filter((conn) => conn.sourcePodId === podId)
      .flatMap((conn) => {
        const currentModel = conn.summaryModel ?? DEFAULT_SUMMARY_MODEL;
        const isValid = providerCapabilityStore.isModelValidForProvider(
          provider,
          currentModel,
        );
        if (isValid) return [];
        const newModel = providerCapabilityStore.getDefaultModel(provider);
        if (!newModel) return [];
        return [{ connectionId: conn.id, newModel }];
      });
  }

  async function reconcileSummaryModelsForPod(podId: string): Promise<void> {
    const invalidConnections = getInvalidConnectionsForPod(podId);
    await Promise.all(
      invalidConnections.map(({ connectionId, newModel }) =>
        updateConnectionSummaryModel(connectionId, newModel),
      ),
    );
  }

  // 切換 canvas 時重設 connection 相關狀態
  function resetForCanvasSwitch(): void {
    connections.value = [];
    selectedConnectionId.value = null;
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
    updateConnectionSummaryProvider,
    updateConnectionAiDecideModel,
    getWorkflowHandlers,
    setupWorkflowListeners,
    cleanupWorkflowListeners,
    clearAiDecideStatusByConnectionIds,
    addConnectionFromEvent,
    updateConnectionFromEvent,
    removeConnectionFromEvent,
    resetForCanvasSwitch,
    reconcileSummaryModelsForPod,
  };
});
