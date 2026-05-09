import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AnchorPosition,
  Connection,
  ConnectionStatus,
  DecideStatus,
  DraggingConnection,
  TriggerMode,
  WorkflowRole,
} from "@/types/connection";
import {
  BRANCH_LABEL_MAX_LENGTH,
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_RESERVED_LABEL,
} from "@/types/connection";
import type { PodProvider } from "@/types/pod";
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
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
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
  triggerMode?: "auto" | "branch" | "direct";
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /** Summary 功能獨立選用的 Provider；升級前 Connection 為 null/undefined */
  summaryProvider?: PodProvider | null;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
  /** Branch 模式使用的 AI Provider */
  branchProvider?: PodProvider;
  /** Branch 模式使用的模型字串 */
  branchModel?: string;
  connectionStatus?: string;
  decideReason?: string | null;
  decideStatus?: string;
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
    // branch 欄位直接帶入，不加 fallback
    label: raw.label,
    description: raw.description,
    branchProvider: raw.branchProvider,
    branchModel: raw.branchModel,
    status: (raw.connectionStatus ?? "idle") as ConnectionStatus,
    decideReason: raw.decideReason ?? undefined,
    // decideStatus：?? "none" 僅做型別 narrowing 用，BE 正規路徑必然帶值
    decideStatus: (raw.decideStatus as DecideStatus) ?? "none",
  };
}

const RUNNING_CONNECTION_STATUSES = new Set<ConnectionStatus>([
  "active",
  "queued",
  "waiting",
]);

const RUNNING_POD_STATUSES = new Set(["chatting", "summarizing"]);

/**
 * 事件亂序保護：當 connection 的 decideStatus 為 pending（AI 決策中），不允許被 active 事件覆蓋。
 * 防止排程或其他觸發路徑的 active 事件在 AI 決策期間改變狀態，
 * 導致 AI 決策結果被忽略或狀態機進入不一致情況。
 */
function isOutOfOrderUpdate(
  currentDecideStatus: DecideStatus | undefined,
  incomingStatus: ConnectionStatus,
): boolean {
  return currentDecideStatus === "pending" && incomingStatus === "active";
}

function shouldUpdateConnection(
  connection: Connection,
  targetPodId: string,
  status: ConnectionStatus,
): boolean {
  if (connection.targetPodId !== targetPodId) return false;
  if (connection.triggerMode !== "auto" && connection.triggerMode !== "branch")
    return false;
  if (isOutOfOrderUpdate(connection.decideStatus, status)) return false;
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
      (connection.status !== undefined &&
        RUNNING_CONNECTION_STATUSES.has(connection.status)) ||
      connection.decideStatus === "pending"
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

  const getBranchConnectionsBySourcePodId = computed(
    () =>
      (sourcePodId: string): Connection[] => {
        return connections.value.filter(
          (connection) =>
            connection.sourcePodId === sourcePodId &&
            connection.triggerMode === "branch",
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
      WebSocketResponseEvents.WORKFLOW_BRANCH_TRIGGERED,
      castHandler(workflowHandlers.handleWorkflowBranchTriggered),
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
      | "triggerMode"
      | "summaryModel"
      | "summaryProvider"
      | "label"
      | "description"
      | "branchProvider"
      | "branchModel"
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
    triggerMode: "auto" | "branch" | "direct",
  ): Promise<Connection | null> {
    // 切換 triggerMode 時不在前端清空 branch 欄位；
    // 後端會清除並透過 ConnectionUpdated 廣播最新狀態
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

  /**
   * 驗證 branch label 是否合法。
   * 回傳 { valid: true } 或 { valid: false, errorKey: string }，
   * errorKey 為 i18n 的 key（不含前綴，呼叫端自行加 "store.connection." 前綴）。
   */
  function validateBranchLabel(
    sourcePodId: string,
    connectionId: string,
    label: string,
  ): { valid: true } | { valid: false; errorKey: string } {
    // 規則 1：label 不可為空字串
    if (label.trim() === "") {
      return { valid: false, errorKey: "branchLabelEmpty" };
    }

    // 規則 2：label 長度 ≤ BRANCH_LABEL_MAX_LENGTH（32）
    if (label.length > BRANCH_LABEL_MAX_LENGTH) {
      return { valid: false, errorKey: "branchLabelTooLong" };
    }

    // 規則 3：label 不可等於 BRANCH_RESERVED_LABEL（"None"，大小寫不敏感）
    if (label.toLowerCase() === BRANCH_RESERVED_LABEL.toLowerCase()) {
      return { valid: false, errorKey: "branchLabelReserved" };
    }

    // 規則 4：同一個 sourcePodId 出去的 branch connections（排除自己）label 不可重複
    const siblings = getBranchConnectionsBySourcePodId.value(sourcePodId);
    const isDuplicate = siblings.some(
      (conn) =>
        conn.id !== connectionId &&
        conn.label?.toLowerCase() === label.toLowerCase(),
    );
    if (isDuplicate) {
      return { valid: false, errorKey: "branchLabelDuplicate" };
    }

    return { valid: true };
  }

  /**
   * 驗證 branch description 是否合法。
   * 回傳 { valid: true } 或 { valid: false, errorKey: string }。
   */
  function validateBranchDescription(
    description: string,
  ): { valid: true } | { valid: false; errorKey: string } {
    if (description.length > BRANCH_DESCRIPTION_MAX_LENGTH) {
      return { valid: false, errorKey: "branchDescriptionTooLong" };
    }
    return { valid: true };
  }

  /**
   * 更新 branch label，先驗證再送出 WS 請求。
   * 驗證失敗時顯示對應 toast 並回傳 null。
   */
  async function updateConnectionBranchLabel(
    connectionId: string,
    label: string,
  ): Promise<Connection | null> {
    const connection = findConnectionById(connectionId);
    if (!connection?.sourcePodId) return null;

    const result = validateBranchLabel(
      connection.sourcePodId,
      connectionId,
      label,
    );
    if (!result.valid) {
      toast({
        title: t(`store.connection.${result.errorKey}`),
        duration: DEFAULT_TOAST_DURATION_MS,
        variant: "destructive",
      });
      return null;
    }

    return executeConnectionUpdate(
      connectionId,
      { label },
      t("store.connection.updateFailed"),
    );
  }

  /**
   * 更新 branch description，先驗證再送出 WS 請求。
   * 驗證失敗時顯示對應 toast 並回傳 null。
   */
  async function updateConnectionBranchDescription(
    connectionId: string,
    description: string,
  ): Promise<Connection | null> {
    const result = validateBranchDescription(description);
    if (!result.valid) {
      toast({
        title: t(`store.connection.${result.errorKey}`),
        duration: DEFAULT_TOAST_DURATION_MS,
        variant: "destructive",
      });
      return null;
    }

    return executeConnectionUpdate(
      connectionId,
      { description },
      t("store.connection.updateFailed"),
    );
  }

  /**
   * Branch Modal 一次送出 triggerMode 切換 + label + description 的合併更新。
   * 將原本三次 WS 請求合併為一次，避免 modal 儲存時的中間狀態。
   * sourcePodId 由呼叫端從 connection 取出傳入，避免 store 內再查一次。
   */
  async function updateConnectionBranchSettings(
    connectionId: string,
    sourcePodId: string,
    payload: {
      switchToBranch: boolean;
      label: string;
      description: string;
    },
  ): Promise<Connection | null> {
    const labelResult = validateBranchLabel(
      sourcePodId,
      connectionId,
      payload.label,
    );
    if (!labelResult.valid) {
      toast({
        title: t(`store.connection.${labelResult.errorKey}`),
        duration: DEFAULT_TOAST_DURATION_MS,
        variant: "destructive",
      });
      return null;
    }

    const descResult = validateBranchDescription(payload.description);
    if (!descResult.valid) {
      toast({
        title: t(`store.connection.${descResult.errorKey}`),
        duration: DEFAULT_TOAST_DURATION_MS,
        variant: "destructive",
      });
      return null;
    }

    const updates: Pick<
      ConnectionUpdatePayload,
      "triggerMode" | "label" | "description"
    > = {
      label: payload.label,
      description: payload.description,
    };
    if (payload.switchToBranch) {
      updates.triggerMode = "branch";
    }

    return executeConnectionUpdate(
      connectionId,
      updates,
      t("store.connection.updateFailed"),
    );
  }

  /**
   * 取得需要同步的 branch sibling connection ID 清單。
   *
   * 同一 sourcePodId 下所有 triggerMode='branch' 的連線共用一個決策模型，
   * 因為後端 branchDecisionService 實際只用 branchConnections[0] 的 provider/model
   * 做決策；UI 若讓各條獨立設定會與後端行為不一致。
   * 故任一條被改動時，需同步寫入同 source 的所有 branch sibling 與目標連線本身。
   */
  function collectBranchSiblingIds(connectionId: string): string[] {
    const target = connections.value.find((c) => c.id === connectionId);
    if (!target) return [connectionId];

    const ids = new Set<string>([connectionId]);
    for (const c of connections.value) {
      if (c.sourcePodId === target.sourcePodId && c.triggerMode === "branch") {
        ids.add(c.id);
      }
    }
    return Array.from(ids);
  }

  /**
   * 同時更新 branchProvider 與 branchModel，確保單一 WS 請求送出，
   * 避免 provider/model 出現不一致的中間狀態。
   * 同 sourcePod 下所有 branch sibling 一起同步（見 collectBranchSiblingIds 註解）。
   */
  async function updateConnectionBranchProvider(
    connectionId: string,
    branchProvider: PodProvider,
    branchModel: string,
  ): Promise<Connection | null> {
    const ids = collectBranchSiblingIds(connectionId);
    const results = await Promise.all(
      ids.map((id) =>
        executeConnectionUpdate(
          id,
          { branchProvider, branchModel },
          t("store.connection.updateFailed"),
        ),
      ),
    );
    return results.find((r) => r?.id === connectionId) ?? null;
  }

  /**
   * 更新 branch model（不變更 provider）。
   * 同 sourcePod 下所有 branch sibling 一起同步（見 collectBranchSiblingIds 註解）。
   */
  async function updateConnectionBranchModel(
    connectionId: string,
    branchModel: string,
  ): Promise<Connection | null> {
    const ids = collectBranchSiblingIds(connectionId);
    const results = await Promise.all(
      ids.map((id) =>
        executeConnectionUpdate(
          id,
          { branchModel },
          t("store.connection.updateFailed"),
        ),
      ),
    );
    return results.find((r) => r?.id === connectionId) ?? null;
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

  function addConnectionFromEvent(
    connection: Omit<Connection, "status">,
  ): void {
    const enrichedConnection: Connection = {
      ...connection,
      triggerMode: connection.triggerMode ?? "auto",
      status: "idle" as ConnectionStatus,
      decideStatus: "none" as DecideStatus,
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
      // branch 欄位直接以後端回傳值覆寫（包含 undefined → 視為清空）
      label: connection.label,
      description: connection.description,
      branchProvider: connection.branchProvider,
      branchModel: connection.branchModel,
      status: existingConnection.status,
      // decideStatus：incoming 有值則覆寫，undefined 則保留既有值
      decideStatus:
        connection.decideStatus !== undefined
          ? connection.decideStatus
          : existingConnection.decideStatus,
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
  function getInvalidConnectionsForPod(podId: string): Array<{
    connectionId: string;
    newModel: string;
    summaryProvider: PodProvider | null | undefined;
  }> {
    const pod = podStore.getPodById(podId);
    if (!pod) return [];

    return connections.value
      .filter((conn) => conn.sourcePodId === podId)
      .flatMap((conn) => {
        // 驗證時優先使用 conn.summaryProvider，若未設定則 fallback 到 sourcePod.provider
        const validationProvider = conn.summaryProvider ?? pod.provider;
        const currentModel = conn.summaryModel ?? DEFAULT_SUMMARY_MODEL;
        const isValid = providerCapabilityStore.isModelValidForProvider(
          validationProvider,
          currentModel,
        );
        if (isValid) return [];
        // newModel 從對應的 summaryProvider 取預設，而非固定用 sourcePod provider
        const newModel =
          providerCapabilityStore.getDefaultModel(validationProvider);
        if (!newModel) return [];
        return [
          {
            connectionId: conn.id,
            newModel,
            summaryProvider: conn.summaryProvider,
          },
        ];
      });
  }

  async function reconcileSummaryModelsForPod(podId: string): Promise<void> {
    const invalidConnections = getInvalidConnectionsForPod(podId);
    await Promise.all(
      invalidConnections.map(({ connectionId, newModel, summaryProvider }) => {
        // 若 connection 有明確設定 summaryProvider，需同時傳入確保不被清除
        if (summaryProvider != null) {
          return updateConnectionSummaryProvider(
            connectionId,
            summaryProvider,
            newModel,
          );
        }
        return updateConnectionSummaryModel(connectionId, newModel);
      }),
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
    getBranchConnectionsBySourcePodId,
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
    validateBranchLabel,
    validateBranchDescription,
    updateConnectionBranchLabel,
    updateConnectionBranchDescription,
    updateConnectionBranchSettings,
    updateConnectionBranchProvider,
    updateConnectionBranchModel,
    getWorkflowHandlers,
    setupWorkflowListeners,
    cleanupWorkflowListeners,
    addConnectionFromEvent,
    updateConnectionFromEvent,
    removeConnectionFromEvent,
    resetForCanvasSwitch,
    reconcileSummaryModelsForPod,
  };
});
