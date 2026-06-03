import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AnchorPosition,
  Connection,
  ConnectionStatus,
  DraggingConnection,
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
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  websocketClient,
} from "@/services/websocket";
import { useToast } from "@/composables/useToast";
import { useCanvasWebSocketAction } from "@/composables/useCanvasWebSocketAction";
import { t } from "@/i18n";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { DEFAULT_TOAST_DURATION_MS } from "@/lib/constants";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { createWorkflowEventHandlers } from "./workflowEventHandlers";
import { normalizePodProvider } from "@/lib/providerOptions";
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
import {
  buildBranchSettingsUpdates,
  resolveDefaultThinkingLevel,
  validateBranchDescription as validateBranchDescriptionRule,
  validateBranchLabel as validateBranchLabelRule,
  validateBranchSettingsPayload as validateBranchSettingsPayloadRule,
  type BranchSettingsPayload,
} from "@/stores/connection/connectionBranchRules";

import { shouldUpdateConnection } from "./connectionStoreHelpers";
import {
  getPodWorkflowRoleFromConnections,
  isDownstreamWorkflowRunning,
  isPodPartOfRunningWorkflow,
} from "./connectionGraphHelpers";
import {
  normalizeConnection,
  normalizeConnectionListPayload,
} from "./connectionPayloadMappers";
import { buildCanvasCommandPayload } from "./canvasScopedCommand";
import {
  addConnectionEvent,
  removeConnectionEvent,
  syncConnectionUpdateResponse as syncConnectionUpdateResponseReducer,
  updateConnectionEvent,
} from "@/stores/connection/connectionEventReducers";

type WorkflowHandlers = ReturnType<typeof createWorkflowEventHandlers>;

export const useConnectionStore = defineStore("connection", () => {
  const { executeAction } = useCanvasWebSocketAction();
  const { toast, showErrorToast, showSuccessToast } = useToast();
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

  const targetPodIds = computed(() => {
    return new Set(
      connections.value.map((connection) => connection.targetPodId),
    );
  });

  const isSourcePod = computed(() => (podId: string): boolean => {
    return !targetPodIds.value.has(podId);
  });

  const hasUpstreamConnections = computed(() => (podId: string): boolean => {
    return targetPodIds.value.has(podId);
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
    return getPodWorkflowRoleFromConnections(connections.value, podId);
  });

  /**
   * 雙向 BFS 遍歷整條 Workflow 鏈（上游 + 下游），
   * 讓 head、tail 或任何連線中的 Pod 都能感知整條鏈的執行狀態，
   * 用於在 Workflow 執行中時封鎖對應 Pod 的輸入。
   * 每次呼叫預先建立鄰接表（O(n)），BFS 查詢降為 O(degree)。
   */
  const isPartOfRunningWorkflow = computed(() => (podId: string): boolean => {
    return isPodPartOfRunningWorkflow(connections.value, podId);
  });

  /**
   * 單向下游 BFS，從指定 Pod 出發往下游遍歷，
   * 用於判斷從某個 head Pod 觸發的 Workflow 是否仍在執行中，
   * 以決定是否允許再次觸發。
   * 每次呼叫預先建立鄰接表（O(n)），BFS 查詢降為 O(degree)。
   */
  const isWorkflowRunning = computed(() => (sourcePodId: string): boolean => {
    return isDownstreamWorkflowRunning(connections.value, sourcePodId);
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

  const workflowHandlers: WorkflowHandlers = createWorkflowEventHandlers({
    connections: connections.value,
    updateAutoGroupStatus,
    setConnectionStatus,
  });
  const workflowListenerEntries = [
    {
      event: WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
      handler: workflowHandlers.handleWorkflowAutoTriggered as (
        payload: unknown,
      ) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_COMPLETE,
      handler: workflowHandlers.handleWorkflowComplete as (
        payload: unknown,
      ) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_BRANCH_TRIGGERED,
      handler: workflowHandlers.handleWorkflowBranchTriggered as (
        payload: unknown,
      ) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED,
      handler: workflowHandlers.handleWorkflowDirectTriggered as (
        payload: unknown,
      ) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_QUEUED,
      handler: workflowHandlers.handleWorkflowQueued as (
        payload: unknown,
      ) => void,
    },
    {
      event: WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED,
      handler: workflowHandlers.handleWorkflowQueueProcessed as (
        payload: unknown,
      ) => void,
    },
  ] as const;
  let workflowListenersRegistered = false;

  function getWorkflowHandlers(): WorkflowHandlers {
    return workflowHandlers;
  }

  function setupWorkflowListeners(): void {
    if (workflowListenersRegistered) return;

    for (const { event, handler } of workflowListenerEntries) {
      websocketClient.on(event, handler);
    }
    workflowListenersRegistered = true;
  }

  function cleanupWorkflowListeners(): void {
    if (!workflowListenersRegistered) return;

    for (const { event, handler } of workflowListenerEntries) {
      websocketClient.off(event, handler);
    }
    workflowListenersRegistered = false;
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
      payload: buildCanvasCommandPayload(canvasId, {}),
    });

    if (response.connections) {
      connections.value = normalizeConnectionListPayload(
        response.connections,
        (sourcePodId) => podStore.getPodById(sourcePodId)?.provider,
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

    // 依上游 Pod 的 provider 建立預設 Summary 設定。
    // OpenCode 優先使用 Pod 目前的 providerConfig.model，避免 alias/capability
    // 尚未載入時把 OpenCode 連線暫時建立成 Claude 或載入中狀態。
    const sourcePod = sourcePodId
      ? podStore.getPodById(sourcePodId)
      : undefined;
    const resolvedSummaryProvider = sourcePod?.provider;
    const sourcePodModel =
      typeof sourcePod?.providerConfig?.model === "string" &&
      sourcePod.providerConfig.model.trim().length > 0
        ? sourcePod.providerConfig.model
        : undefined;
    const resolvedSummaryModel: string =
      (sourcePod?.provider === "opencode" ? sourcePodModel : undefined) ??
      (sourcePod
        ? providerCapabilityStore.getDefaultModel(sourcePod.provider)
        : undefined) ??
      DEFAULT_SUMMARY_MODEL;

    const basePayload: {
      sourceAnchor: AnchorPosition;
      targetPodId: string;
      targetAnchor: AnchorPosition;
      sourcePodId?: string;
      summaryProvider?: PodProvider;
      summaryModel?: string;
      summaryThinkingLevel?: string | null;
    } = {
      sourceAnchor,
      targetPodId,
      targetAnchor,
    };
    if (sourcePodId) {
      basePayload.sourcePodId = sourcePodId;
    }
    if (resolvedSummaryProvider) {
      basePayload.summaryProvider = resolvedSummaryProvider;
      basePayload.summaryModel = resolvedSummaryModel;
      basePayload.summaryThinkingLevel =
        typeof sourcePod?.providerConfig?.thinkingLevel === "string"
          ? sourcePod.providerConfig.thinkingLevel
          : resolveDefaultThinkingLevel(
              providerCapabilityStore,
              resolvedSummaryProvider,
              resolvedSummaryModel,
            );
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

    if (!result.success || !result.data.connection) {
      return null;
    }

    // 後端若未帶回 summaryModel，以上游 provider 預設模型填入
    const rawConnection = result.data.connection;
    if (!rawConnection.summaryModel) {
      rawConnection.summaryModel = resolvedSummaryModel;
    }

    showSuccessToast("Connection", t("common.success.create"));
    return normalizeConnection(rawConnection, sourcePod?.provider);
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
      return;
    }

    showSuccessToast("Connection", t("common.success.delete"));
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
      | "direct"
      | "summaryModel"
      | "summaryProvider"
      | "summaryThinkingLevel"
      | "label"
      | "description"
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

    if (
      !result.success ||
      !result.data ||
      (!result.data.connection && !result.data.connections?.length)
    ) {
      return null;
    }

    const updatedConnections = syncConnectionUpdateResponse(result.data);
    return (
      updatedConnections.find((connection) => connection.id === connectionId) ??
      null
    );
  }

  function syncConnectionUpdateResponse(
    payload: ConnectionUpdatedPayload,
  ): Connection[] {
    const result = syncConnectionUpdateResponseReducer(
      connections.value,
      payload,
      (sourcePodId) => podStore.getPodById(sourcePodId)?.provider,
    );
    connections.value = result.connections;
    return result.updatedConnections;
  }

  async function updateConnectionTriggerMode(
    connectionId: string,
    triggerMode: "auto" | "branch" | "direct",
  ): Promise<Connection | null> {
    if (triggerMode === "direct") {
      return updateConnectionDirect(connectionId, true);
    }

    return executeConnectionUpdate(
      connectionId,
      {
        triggerMode,
        direct: false,
      },
      t("store.connection.updateFailed"),
    );
  }

  async function updateConnectionDirect(
    connectionId: string,
    direct: boolean,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { direct },
      t("store.connection.updateFailed"),
    );
  }

  async function updateConnectionSummaryModel(
    connectionId: string,
    summaryModel: string,
  ): Promise<Connection | null> {
    const connection = findConnectionById(connectionId);
    const provider = connection?.summaryProvider ?? "claude";
    return executeConnectionUpdate(
      connectionId,
      {
        summaryModel,
        summaryThinkingLevel: resolveDefaultThinkingLevel(
          providerCapabilityStore,
          provider,
          summaryModel,
        ),
      },
      t("store.connection.summaryModelUpdateFailed"),
    );
  }

  async function updateConnectionSummaryThinkingLevel(
    connectionId: string,
    summaryThinkingLevel: string | null,
  ): Promise<Connection | null> {
    return executeConnectionUpdate(
      connectionId,
      { summaryThinkingLevel },
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
      {
        summaryProvider,
        summaryModel,
        summaryThinkingLevel: resolveDefaultThinkingLevel(
          providerCapabilityStore,
          summaryProvider,
          summaryModel,
        ),
      },
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
    return validateBranchLabelRule(
      sourcePodId,
      connectionId,
      label,
      getBranchConnectionsBySourcePodId.value(sourcePodId),
      {
        labelMaxLength: BRANCH_LABEL_MAX_LENGTH,
        descriptionMaxLength: BRANCH_DESCRIPTION_MAX_LENGTH,
        reservedLabel: BRANCH_RESERVED_LABEL,
      },
    );
  }

  /**
   * 驗證 branch description 是否合法。
   * 回傳 { valid: true } 或 { valid: false, errorKey: string }。
   */
  function validateBranchDescription(
    description: string,
  ): { valid: true } | { valid: false; errorKey: string } {
    return validateBranchDescriptionRule(description, {
      labelMaxLength: BRANCH_LABEL_MAX_LENGTH,
      descriptionMaxLength: BRANCH_DESCRIPTION_MAX_LENGTH,
      reservedLabel: BRANCH_RESERVED_LABEL,
    });
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
    payload: BranchSettingsPayload,
  ): Promise<Connection | null> {
    const validationErrorKey = validateBranchSettingsPayload(
      sourcePodId,
      connectionId,
      payload,
    );
    if (validationErrorKey) {
      toast({
        title: t(`store.connection.${validationErrorKey}`),
        duration: DEFAULT_TOAST_DURATION_MS,
        variant: "destructive",
      });
      return null;
    }

    return executeConnectionUpdate(
      connectionId,
      buildBranchSettingsUpdates(payload),
      t("store.connection.updateFailed"),
    );
  }

  function validateBranchSettingsPayload(
    sourcePodId: string,
    connectionId: string,
    payload: BranchSettingsPayload,
  ): string | null {
    return validateBranchSettingsPayloadRule(
      sourcePodId,
      connectionId,
      payload,
      getBranchConnectionsBySourcePodId.value(sourcePodId),
      {
        labelMaxLength: BRANCH_LABEL_MAX_LENGTH,
        descriptionMaxLength: BRANCH_DESCRIPTION_MAX_LENGTH,
        reservedLabel: BRANCH_RESERVED_LABEL,
      },
    );
  }

  function addConnectionFromEvent(
    connection: Omit<Connection, "status">,
  ): void {
    connections.value = addConnectionEvent(
      connections.value,
      connection,
      (sourcePodId) => podStore.getPodById(sourcePodId)?.provider,
    );
  }

  function updateConnectionFromEvent(
    connection: ConnectionUpdatedPayload["connection"],
  ): void {
    connections.value = updateConnectionEvent(
      connections.value,
      connection,
      (sourcePodId) => podStore.getPodById(sourcePodId)?.provider,
    );
  }

  function removeConnectionFromEvent(connectionId: string): void {
    connections.value = removeConnectionEvent(connections.value, connectionId);
    if (selectedConnectionId.value === connectionId) {
      selectedConnectionId.value = null;
    }
  }

  /**
   * 純函數：回傳所有 summaryModel 不合法的 connection 及其對應的修正 model。
   * 不發出任何更新，供 reconcileSummaryModelsForPod 使用。
   */
  function getInvalidConnectionsForPod(podId: string): Array<{
    connectionId: string;
    newModel: string;
    summaryProvider: PodProvider | null | undefined;
    hasExplicitSummaryProvider: boolean;
  }> {
    const pod = podStore.getPodById(podId);
    if (!pod) return [];

    return connections.value
      .filter((conn) => conn.sourcePodId === podId)
      .flatMap((conn) => {
        const validationProvider =
          normalizePodProvider(conn.summaryProvider ?? pod.provider) ??
          "claude";
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
            hasExplicitSummaryProvider: conn.summaryProvider != null,
          },
        ];
      });
  }

  async function reconcileSummaryModelsForPod(podId: string): Promise<void> {
    const invalidConnections = getInvalidConnectionsForPod(podId);
    await Promise.all(
      invalidConnections.map(
        ({
          connectionId,
          newModel,
          summaryProvider,
          hasExplicitSummaryProvider,
        }) => {
          // 僅在 connection 原本就有明確 summaryProvider 時，才一併送出 provider；
          // follow-source 的 connection 要保留空值語意，不能被這次收斂釘死。
          if (hasExplicitSummaryProvider && summaryProvider != null) {
            return updateConnectionSummaryProvider(
              connectionId,
              summaryProvider,
              newModel,
            );
          }
          return updateConnectionSummaryModel(connectionId, newModel);
        },
      ),
    );
  }

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
    setupWorkflowListeners,
    cleanupWorkflowListeners,
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
    updateConnectionDirect,
    updateConnectionSummaryModel,
    updateConnectionSummaryThinkingLevel,
    updateConnectionSummaryProvider,
    validateBranchLabel,
    validateBranchDescription,
    updateConnectionBranchLabel,
    updateConnectionBranchDescription,
    updateConnectionBranchSettings,
    getWorkflowHandlers,
    addConnectionFromEvent,
    updateConnectionFromEvent,
    removeConnectionFromEvent,
    resetForCanvasSwitch,
    reconcileSummaryModelsForPod,
  };
});
