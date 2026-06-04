import { defineStore } from "pinia";
import {
  createWebSocketRequest,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { MAX_RUNS_PER_CANVAS } from "@/lib/constants";
import type {
  WorkflowRun,
  RunStatus,
  RunPodStatus,
  PathwayState,
  RunMessagesPageInfo,
  RunChatTimelineItem,
  RunGoalRoundDivider,
} from "@/types/run";
import type {
  Message,
  MessageRole,
  SystemMessageMetadata,
} from "@/types/chat";
import type {
  RunDeletePayload,
  RunLoadHistoryPayload,
  RunLoadPodMessagesPayload,
} from "@/types/websocket/requests";
import type {
  RunDeletedPayload,
  RunHistoryResultPayload,
  RunPodMessagesResultPayload,
} from "@/types/websocket/responses";
import {
  toRunChatTimelineItem,
} from "@/stores/run/runStoreHelpers";
import { normalizeRunHistoryResponse } from "@/stores/run/runHistoryNormalizer";
import {
  buildCanvasCommandPayload,
  buildCanvasPodCommandPayload,
} from "@/stores/canvasScopedCommand";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import { logger } from "@/utils/logger";
import {
  appendRunChatDivider,
  appendRunChatMessage,
  cleanupRunTranscript,
  clearMessageCaches,
  createEmptyRunChatPageInfo,
  getRunChatMessagesFromTimeline,
  handleRunChatComplete,
  handleRunChatToolResult,
  handleRunChatToolUse,
  mergeLoadedTimelineItems,
  rebuildActiveMessageCaches,
  resetRunChatState,
  setActiveRunChatMessages,
  setActiveRunChatTimelineItems,
} from "@/stores/run/runTranscriptController";

interface RunState {
  /** #38 runs 改 Map：key 為 run.id，提供 O(1) 插入 / 刪除 / 查找。
   *  對外透過 runs getter 取出陣列，對外 API 不變。 */
  runsById: Map<string, WorkflowRun>;
  isHistoryPanelOpen: boolean;
  expandedRunIds: Set<string>;
  activeRunChatModal: { runId: string; podId: string } | null;
  /** #44 runChatMessages 改巢狀 Map：外層 key 為 runId，內層 key 為 podId。
   *  removeRun 時只需 delete(runId)，不再需要遍歷所有 key。 */
  runChatMessages: Map<string, Map<string, RunChatTimelineItem[]>>;
  isLoadingPodMessages: boolean;
  isLoadingOlderPodMessages: boolean;
  activeRunChatPageInfo: RunMessagesPageInfo;
  activeRunChatRequestToken: number;
  accumulatedLengthByMessageId: Map<string, number>;
  /** 串流期間的 O(1) 定位快取：key 為 messageId，value 為陣列 index。
   *  complete 時或訊息被刪除時需同步清除，避免 stale index。 */
  messageIndexCache: Map<string, number>;
}

const RUN_CHAT_PAGE_SIZE = 50;

export const useRunStore = defineStore("run", {
  state: (): RunState => ({
    runsById: new Map(),
    isHistoryPanelOpen: false,
    expandedRunIds: new Set(),
    activeRunChatModal: null,
    runChatMessages: new Map(),
    isLoadingPodMessages: false,
    isLoadingOlderPodMessages: false,
    activeRunChatPageInfo: createEmptyRunChatPageInfo(),
    activeRunChatRequestToken: 0,
    accumulatedLengthByMessageId: new Map(),
    messageIndexCache: new Map(),
  }),

  getters: {
    /** runs 陣列（由 runsById Map 派生）。外層元件透過此 getter 取得陣列語意。 */
    runs: (state): WorkflowRun[] => Array.from(state.runsById.values()),

    sortedRuns: (state): WorkflowRun[] => {
      // Schwartzian transform：先將 createdAt 轉為時間戳，避免每次比較都重新建立 Date 物件
      return Array.from(state.runsById.values())
        .map((run) => ({ run, ts: new Date(run.createdAt).getTime() }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_RUNS_PER_CANVAS)
        .map(({ run }) => run);
    },

    runningRunsCount: (state): number => {
      let count = 0;
      for (const run of state.runsById.values()) {
        if (run.status === "running") count++;
      }
      return count;
    },

    getRunById:
      (state) =>
      (runId: string): WorkflowRun | undefined => {
        return state.runsById.get(runId);
      },

    getActiveRunChatMessages(state): Message[] {
      if (!state.activeRunChatModal) return [];
      const { runId, podId } = state.activeRunChatModal;
      return getRunChatMessagesFromTimeline(
        state.runChatMessages.get(runId)?.get(podId) ?? [],
      );
    },

    getActiveRunChatTimelineItems(state): RunChatTimelineItem[] {
      if (!state.activeRunChatModal) return [];
      const { runId, podId } = state.activeRunChatModal;
      return state.runChatMessages.get(runId)?.get(podId) ?? [];
    },
  },

  actions: {
    async loadRuns(): Promise<void> {
      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) return;

      try {
        const response = await createWebSocketRequest<
          RunLoadHistoryPayload,
          RunHistoryResultPayload
        >({
          requestEvent: WebSocketRequestEvents.RUN_LOAD_HISTORY,
          responseEvent: WebSocketResponseEvents.RUN_HISTORY_RESULT,
          payload: buildCanvasCommandPayload(canvasId, {}),
        });

        const normalizedRuns = normalizeRunHistoryResponse(response);
        if (normalizedRuns) {
          this.runsById = normalizedRuns;
        }
      } catch (e) {
        logger.error("[RunStore] 載入 Run 歷史失敗", e);
        const { showErrorToast } = useToast();
        showErrorToast("Run", t("store.run.loadFailed"));
      }
    },

    addRun(run: WorkflowRun): void {
      // runsById Map 提供 O(1) 重複檢查
      if (this.runsById.has(run.id)) return;

      this.runsById.set(run.id, run);

      // 超過上限時移除最舊的 run（按 createdAt 升冪取末尾）
      if (this.runsById.size > MAX_RUNS_PER_CANVAS) {
        const sorted = Array.from(this.runsById.values()).sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        // 移除最舊的一筆（超出一筆就夠）
        if (sorted[0]) {
          this.removeRun(sorted[0].id);
        }
      }
    },

    updateRunStatus(
      runId: string,
      status: RunStatus,
      completedAt?: string,
    ): void {
      // runsById Map 提供 O(1) 查找，直接修改物件（Pinia reactive Map 會追蹤屬性變更）
      const run = this.runsById.get(runId);
      if (!run) return;

      run.status = status;
      if (completedAt) {
        run.completedAt = completedAt;
      }
    },

    updatePodInstanceStatus(payload: {
      runId: string;
      podId: string;
      status: RunPodStatus;
      lastResponseSummary?: string;
      errorMessage?: string;
      triggeredAt?: string;
      completedAt?: string;
      autoPathwaySettled?: PathwayState;
      directPathwaySettled?: PathwayState;
    }): void {
      // runsById Map 提供 O(1) 查找
      const run = this.runsById.get(payload.runId);
      if (!run) return;

      const podInstance = run.podInstances.find(
        (p) => p.podId === payload.podId,
      );
      if (!podInstance) return;

      const shouldPreserveBlockedStatus =
        podInstance.status === "blocked" && payload.status === "error";

      if (!shouldPreserveBlockedStatus) {
        podInstance.status = payload.status;
      }

      if (payload.lastResponseSummary !== undefined) {
        podInstance.lastResponseSummary = payload.lastResponseSummary;
      }
      if (payload.errorMessage !== undefined) {
        podInstance.errorMessage = payload.errorMessage;
      }
      if (payload.triggeredAt !== undefined) {
        podInstance.triggeredAt = payload.triggeredAt;
      }
      if (payload.completedAt !== undefined) {
        podInstance.completedAt = payload.completedAt;
      }
      if (payload.autoPathwaySettled !== undefined) {
        podInstance.autoPathwaySettled = payload.autoPathwaySettled;
      }
      if (payload.directPathwaySettled !== undefined) {
        podInstance.directPathwaySettled = payload.directPathwaySettled;
      }
    },

    isActiveRunChatTarget(runId: string, podId: string): boolean {
      return (
        this.activeRunChatModal?.runId === runId &&
        this.activeRunChatModal?.podId === podId
      );
    },

    clearMessageCaches(timelineItems: RunChatTimelineItem[]): void {
      clearMessageCaches(this, timelineItems);
    },

    cleanupRunTranscript(runId: string): void {
      cleanupRunTranscript(this, runId);
    },

    resetRunChatState(): void {
      resetRunChatState(this);
    },

    rebuildActiveMessageCaches(timelineItems: RunChatTimelineItem[]): void {
      rebuildActiveMessageCaches(this, timelineItems);
    },

    setActiveRunChatTimelineItems(
      runId: string,
      podId: string,
      timelineItems: RunChatTimelineItem[],
    ) {
      setActiveRunChatTimelineItems(this, runId, podId, timelineItems);
    },

    setActiveRunChatMessages(
      runId: string,
      podId: string,
      messages: Message[],
    ) {
      setActiveRunChatMessages(this, runId, podId, messages);
    },

    removeRun(runId: string): void {
      // O(1) 刪除（Map），不再需要 filter 整個陣列
      this.runsById.delete(runId);
      this.expandedRunIds.delete(runId);
      this.cleanupRunTranscript(runId);

      if (this.activeRunChatModal?.runId === runId) {
        this.activeRunChatRequestToken += 1;
        this.activeRunChatModal = null;
        this.resetRunChatState();
      }
    },

    async deleteRun(runId: string): Promise<void> {
      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) return;

      const { showErrorToast } = useToast();

      try {
        await createWebSocketRequest<RunDeletePayload, RunDeletedPayload>({
          requestEvent: WebSocketRequestEvents.RUN_DELETE,
          responseEvent: WebSocketResponseEvents.RUN_DELETED,
          payload: buildCanvasCommandPayload(canvasId, { runId }),
        });

        this.removeRun(runId);
      } catch (error) {
        logger.error("[RunStore] 刪除 Run 失敗", error);
        showErrorToast("Run", t("common.error.delete"));
      }
    },

    toggleHistoryPanel(): void {
      this.isHistoryPanelOpen = !this.isHistoryPanelOpen;
    },

    openHistoryPanel(): void {
      this.isHistoryPanelOpen = true;
    },

    toggleRunExpanded(runId: string): void {
      if (this.expandedRunIds.has(runId)) {
        this.expandedRunIds.delete(runId);
      } else {
        this.expandedRunIds.add(runId);
      }
    },

    async openRunChatModal(runId: string, podId: string): Promise<void> {
      this.activeRunChatRequestToken += 1;
      const requestToken = this.activeRunChatRequestToken;
      this.resetRunChatState();
      this.activeRunChatModal = { runId, podId };
      this.isLoadingPodMessages = true;

      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) {
        this.isLoadingPodMessages = false;
        return;
      }
      const { showErrorToast } = useToast();

      try {
        const response = await createWebSocketRequest<
          RunLoadPodMessagesPayload,
          RunPodMessagesResultPayload
        >({
          requestEvent: WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES,
          responseEvent: WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
          payload: buildCanvasPodCommandPayload(canvasId, podId, {
            runId,
            limit: RUN_CHAT_PAGE_SIZE,
          }),
        });

        if (response.success && response.timelineItems) {
          if (
            requestToken !== this.activeRunChatRequestToken ||
            !this.isActiveRunChatTarget(runId, podId)
          ) {
            return;
          }

          const loadedTimelineItems =
            response.timelineItems.map(toRunChatTimelineItem);
          const liveTimelineItems =
            this.runChatMessages.get(runId)?.get(podId) ?? [];
          this.setActiveRunChatTimelineItems(
            runId,
            podId,
            mergeLoadedTimelineItems(loadedTimelineItems, liveTimelineItems),
          );
          this.activeRunChatPageInfo =
            response.pageInfo ?? createEmptyRunChatPageInfo();
        }
      } catch (error) {
        logger.error("[RunStore] 載入 Run 對話失敗", error);
        showErrorToast("Run", t("common.error.load"));
      } finally {
        if (requestToken === this.activeRunChatRequestToken) {
          this.isLoadingPodMessages = false;
        }
      }
    },

    closeRunChatModal(): void {
      this.activeRunChatRequestToken += 1;
      this.activeRunChatModal = null;
      this.resetRunChatState();
    },

    async loadOlderActiveRunChatMessages(): Promise<void> {
      const activeTarget = this.activeRunChatModal;
      if (!activeTarget) return;
      if (this.isLoadingOlderPodMessages) return;
      if (!this.activeRunChatPageInfo.hasMore) return;
      if (!this.activeRunChatPageInfo.nextCursor) return;

      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) return;
      const { showErrorToast } = useToast();

      this.isLoadingOlderPodMessages = true;

      try {
        const response = await createWebSocketRequest<
          RunLoadPodMessagesPayload,
          RunPodMessagesResultPayload
        >({
          requestEvent: WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES,
          responseEvent: WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
          payload: buildCanvasPodCommandPayload(canvasId, activeTarget.podId, {
            runId: activeTarget.runId,
            limit: RUN_CHAT_PAGE_SIZE,
            cursor: this.activeRunChatPageInfo.nextCursor,
          }),
        });

        if (
          !response.success ||
          !this.isActiveRunChatTarget(activeTarget.runId, activeTarget.podId)
        ) {
          return;
        }

        const olderTimelineItems =
          response.timelineItems.map(toRunChatTimelineItem);
        const currentTimelineItems =
          this.runChatMessages.get(activeTarget.runId)?.get(activeTarget.podId) ??
          [];
        this.setActiveRunChatTimelineItems(
          activeTarget.runId,
          activeTarget.podId,
          [...olderTimelineItems, ...currentTimelineItems],
        );
        this.activeRunChatPageInfo =
          response.pageInfo ?? createEmptyRunChatPageInfo();
      } catch (error) {
        logger.error("[RunStore] 載入較舊 Run 對話失敗", error);
        showErrorToast("Run", t("common.error.load"));
      } finally {
        if (this.isActiveRunChatTarget(activeTarget.runId, activeTarget.podId)) {
          this.isLoadingOlderPodMessages = false;
        }
      }
    },

    appendRunChatMessage(
      runId: string,
      podId: string,
      messageId: string,
      content: string,
      isPartial: boolean,
      role: MessageRole,
      metadata?: SystemMessageMetadata,
      receivedDelta?: string,
    ): void {
      appendRunChatMessage(this, {
        runId,
        podId,
        messageId,
        content,
        isPartial,
        role,
        metadata,
        receivedDelta,
      });
    },

    appendRunChatDivider(divider: RunGoalRoundDivider): void {
      appendRunChatDivider(this, divider);
    },

    handleRunChatToolUse(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }): void {
      handleRunChatToolUse(this, payload);
    },

    handleRunChatToolResult(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      output: string;
    }): void {
      handleRunChatToolResult(this, payload);
    },

    handleRunChatComplete(
      runId: string,
      podId: string,
      messageId: string,
      fullContent: string,
    ): void {
      handleRunChatComplete(this, {
        runId,
        podId,
        messageId,
        fullContent,
      });
    },

    resetOnCanvasSwitch(): void {
      this.runsById = new Map();
      this.expandedRunIds = new Set();
      this.activeRunChatRequestToken += 1;
      this.activeRunChatModal = null;
      this.isHistoryPanelOpen = false;
      this.resetRunChatState();
    },
  },
});
