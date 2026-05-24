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
  ToolUseInfo,
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
  mergeToolResultIntoMessage,
  mergeToolUseIntoMessage,
  upsertMessage,
} from "@/stores/chat/messageHelpers";
import {
  finalizeSubMessages,
  finalizeToolUse,
  updateMainMessageState,
} from "@/stores/chat/subMessageHelpers";
import {
  createAssistantMessageWithTool,
  toRunChatTimelineItem,
} from "@/stores/run/runStoreHelpers";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import { logger } from "@/utils/logger";

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

function createEmptyRunChatPageInfo(): RunMessagesPageInfo {
  return {
    hasMore: false,
    nextCursor: null,
  };
}

function isRunChatMessage(item: RunChatTimelineItem): item is Message {
  return !("type" in item && item.type === "goal-round-divider");
}

function findMessageIndex(
  timelineItems: RunChatTimelineItem[],
  messageId: string,
): number {
  return timelineItems.findIndex(
    (item) => isRunChatMessage(item) && item.id === messageId,
  );
}

function getRunChatMessagesFromTimeline(
  timelineItems: RunChatTimelineItem[],
): Message[] {
  return timelineItems.filter(isRunChatMessage);
}

function mergeLoadedTimelineItems(
  loadedItems: RunChatTimelineItem[],
  liveItems: RunChatTimelineItem[],
): RunChatTimelineItem[] {
  if (liveItems.length === 0) {
    return loadedItems;
  }

  const mergedById = new Map<string, RunChatTimelineItem>();
  const orderedIds: string[] = [];

  for (const item of loadedItems) {
    orderedIds.push(item.id);
    mergedById.set(item.id, item);
  }

  for (const item of liveItems) {
    const existing = mergedById.get(item.id);
    if (existing && isRunChatMessage(existing) && isRunChatMessage(item)) {
      mergedById.set(item.id, {
        ...existing,
        ...item,
        metadata: item.metadata ?? existing.metadata,
        toolUse: item.toolUse ?? existing.toolUse,
        subMessages: item.subMessages ?? existing.subMessages,
      });
      continue;
    }

    if (existing) {
      mergedById.set(item.id, item);
      continue;
    }

    orderedIds.push(item.id);
    mergedById.set(item.id, item);
  }

  return orderedIds
    .map((itemId) => mergedById.get(itemId))
    .filter((item): item is RunChatTimelineItem => Boolean(item));
}

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
          payload: { canvasId },
        });

        if (response.success && response.runs) {
          this.runsById = new Map(response.runs.map((r) => [r.id, r]));
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

      podInstance.status = payload.status;
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
      for (const message of getRunChatMessagesFromTimeline(timelineItems)) {
        this.accumulatedLengthByMessageId.delete(message.id);
        this.messageIndexCache.delete(message.id);
      }
    },

    cleanupRunTranscript(runId: string): void {
      const podMap = this.runChatMessages.get(runId);
      if (!podMap) return;

      for (const timelineItems of podMap.values()) {
        this.clearMessageCaches(timelineItems);
      }

      this.runChatMessages.delete(runId);
    },

    resetRunChatState(): void {
      this.runChatMessages = new Map();
      this.isLoadingPodMessages = false;
      this.accumulatedLengthByMessageId = new Map();
      this.messageIndexCache = new Map();
      this.activeRunChatPageInfo = createEmptyRunChatPageInfo();
      this.isLoadingOlderPodMessages = false;
    },

    rebuildActiveMessageCaches(timelineItems: RunChatTimelineItem[]): void {
      this.messageIndexCache = new Map(
        timelineItems.flatMap((item, index) =>
          isRunChatMessage(item) ? [[item.id, index] as const] : [],
        ),
      );
      this.accumulatedLengthByMessageId = new Map(
        getRunChatMessagesFromTimeline(timelineItems)
          .filter((message) => message.isPartial)
          .map((message) => [message.id, message.content.length]),
      );
    },

    setActiveRunChatTimelineItems(
      runId: string,
      podId: string,
      timelineItems: RunChatTimelineItem[],
    ) {
      let podMap = this.runChatMessages.get(runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(runId, podMap);
      }

      podMap.set(podId, timelineItems);
      this.rebuildActiveMessageCaches(timelineItems);
    },

    setActiveRunChatMessages(
      runId: string,
      podId: string,
      messages: Message[],
    ) {
      this.setActiveRunChatTimelineItems(runId, podId, messages);
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
          payload: {
            canvasId,
            runId,
          },
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
          payload: {
            canvasId,
            runId,
            podId,
            limit: RUN_CHAT_PAGE_SIZE,
          },
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
          payload: {
            canvasId,
            runId: activeTarget.runId,
            podId: activeTarget.podId,
            limit: RUN_CHAT_PAGE_SIZE,
            cursor: this.activeRunChatPageInfo.nextCursor,
          },
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
      let podMap = this.runChatMessages.get(runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(runId, podMap);
      }
      const timelineItems = [...(podMap.get(podId) ?? [])];

      const cachedIndex = this.messageIndexCache.get(messageId);
      const cachedItem =
        cachedIndex !== undefined ? timelineItems[cachedIndex] : undefined;
      const knownIndex =
        cachedItem !== undefined &&
        isRunChatMessage(cachedItem) &&
        cachedItem.id === messageId
          ? cachedIndex
          : undefined;
      const existingIndex =
        knownIndex ?? findMessageIndex(timelineItems, messageId);
      const existingMessage =
        existingIndex !== -1 ? timelineItems[existingIndex] : undefined;
      const existingContent =
        existingMessage !== undefined && isRunChatMessage(existingMessage)
          ? existingMessage.content
          : "";
      const lastLength = this.accumulatedLengthByMessageId.get(messageId) ?? 0;
      const delta =
        receivedDelta ??
        (content.length < lastLength ? content : content.slice(lastLength));
      const nextContent =
        receivedDelta !== undefined ? `${existingContent}${receivedDelta}` : content;

      if (isPartial) {
        this.accumulatedLengthByMessageId.set(messageId, nextContent.length);
      } else {
        this.accumulatedLengthByMessageId.delete(messageId);
      }

      upsertMessage(
        timelineItems as Message[],
        messageId,
        nextContent,
        isPartial,
        role,
        delta,
        metadata,
        knownIndex,
      );

      // 新訊息被 push 到陣列末尾，快取其 index
      if (knownIndex === undefined) {
        const newIndex = findMessageIndex(timelineItems, messageId);
        if (newIndex !== -1) {
          this.messageIndexCache.set(messageId, newIndex);
        }
      }

      podMap.set(podId, timelineItems);
    },

    appendRunChatDivider(divider: RunGoalRoundDivider): void {
      let podMap = this.runChatMessages.get(divider.runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(divider.runId, podMap);
      }

      const timelineItems = podMap.get(divider.podId) ?? [];
      const existingIndex = timelineItems.findIndex(
        (item) =>
          "type" in item &&
          item.type === "goal-round-divider" &&
          item.id === divider.id,
      );

      if (existingIndex !== -1) {
        const updatedItems = [...timelineItems];
        updatedItems[existingIndex] = divider;
        podMap.set(divider.podId, updatedItems);
        return;
      }

      podMap.set(divider.podId, [...timelineItems, divider]);
    },

    handleRunChatToolUse(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }): void {
      let podMap = this.runChatMessages.get(payload.runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(payload.runId, podMap);
      }
      const timelineItems = podMap.get(payload.podId) ?? [];

      const toolUseInfo: ToolUseInfo = {
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        input: payload.input,
        status: "running",
      };

      const messageIndex = findMessageIndex(timelineItems, payload.messageId);

      // 訊息尚不存在時（tool use 先於 text 到達），建立新 assistant 訊息
      if (messageIndex === -1) {
        const nextMessages = [
          ...timelineItems,
          createAssistantMessageWithTool(payload.messageId, toolUseInfo),
        ];
        this.messageIndexCache.set(payload.messageId, nextMessages.length - 1);
        podMap.set(payload.podId, nextMessages);
        return;
      }

      const message = timelineItems[messageIndex];
      if (!message || !isRunChatMessage(message)) return;

      const toolAlreadyExists = message.toolUse?.some(
        (t) => t.toolUseId === payload.toolUseId,
      );
      if (toolAlreadyExists) return;

      const updatedMessages = [...timelineItems];
      updatedMessages[messageIndex] = mergeToolUseIntoMessage(
        message,
        toolUseInfo,
      );
      podMap.set(payload.podId, updatedMessages);
    },

    handleRunChatToolResult(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      output: string;
    }): void {
      let podMap = this.runChatMessages.get(payload.runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(payload.runId, podMap);
      }

      const timelineItems = podMap.get(payload.podId) ?? [];
      const messageIndex = findMessageIndex(timelineItems, payload.messageId);
      const toolUseInfo: ToolUseInfo = {
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        input: {},
        status: "running",
      };

      if (messageIndex === -1) {
        const createdMessage = mergeToolResultIntoMessage(
          createAssistantMessageWithTool(payload.messageId, toolUseInfo),
          payload.toolUseId,
          payload.output,
          payload.toolName,
        );
        const nextMessages = [...timelineItems, createdMessage];
        this.messageIndexCache.set(payload.messageId, nextMessages.length - 1);
        podMap.set(payload.podId, nextMessages);
        return;
      }

      const updatedMessages = [...timelineItems];
      const message = updatedMessages[messageIndex];
      if (!message || !isRunChatMessage(message)) return;

      const hasToolUse = message.toolUse?.some(
        (tool) => tool.toolUseId === payload.toolUseId,
      );
      const messageWithToolUse = hasToolUse
        ? message
        : mergeToolUseIntoMessage(message, toolUseInfo);

      updatedMessages[messageIndex] = mergeToolResultIntoMessage(
        messageWithToolUse,
        payload.toolUseId,
        payload.output,
        payload.toolName,
      );
      podMap.set(payload.podId, updatedMessages);
    },

    handleRunChatComplete(
      runId: string,
      podId: string,
      messageId: string,
      fullContent: string,
    ): void {
      let podMap = this.runChatMessages.get(runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(runId, podMap);
      }

      const currentTimelineItems = podMap.get(podId) ?? [];
      let messageIndex = findMessageIndex(currentTimelineItems, messageId);

      if (messageIndex === -1) {
        this.appendRunChatMessage(
          runId,
          podId,
          messageId,
          fullContent,
          false,
          "assistant",
        );
      }

      const timelineItems = podMap.get(podId);
      if (!timelineItems) return;

      messageIndex = findMessageIndex(timelineItems, messageId);
      if (messageIndex === -1) return;

      this.accumulatedLengthByMessageId.delete(messageId);
      // complete 後清除 index 快取，防止 stale 快取污染後續串流
      this.messageIndexCache.delete(messageId);

      // findIndex 已確認 index 有效，斷言元素一定存在
      const message = timelineItems[messageIndex];
      if (!message || !isRunChatMessage(message)) return;
      const updatedToolUse = finalizeToolUse(message.toolUse);
      const finalizedSubMessages = finalizeSubMessages(message.subMessages);

      const updatedMessages = [...timelineItems];
      updatedMessages[messageIndex] = updateMainMessageState(
        message,
        fullContent,
        updatedToolUse,
        finalizedSubMessages,
      );
      podMap.set(podId, updatedMessages);
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
