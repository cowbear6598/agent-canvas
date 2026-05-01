import { defineStore } from "pinia";
import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { generateRequestId } from "@/services/utils";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { MAX_RUNS_PER_CANVAS } from "@/lib/constants";
import type {
  WorkflowRun,
  RunStatus,
  RunPodStatus,
  PathwayState,
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
  toMessage,
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
  runChatMessages: Map<string, Map<string, Message[]>>;
  isLoadingPodMessages: boolean;
  accumulatedLengthByMessageId: Map<string, number>;
  /** 串流期間的 O(1) 定位快取：key 為 messageId，value 為陣列 index。
   *  complete 時或訊息被刪除時需同步清除，避免 stale index。 */
  messageIndexCache: Map<string, number>;
}

export const useRunStore = defineStore("run", {
  state: (): RunState => ({
    runsById: new Map(),
    isHistoryPanelOpen: false,
    expandedRunIds: new Set(),
    activeRunChatModal: null,
    runChatMessages: new Map(),
    isLoadingPodMessages: false,
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
          this.runsById.delete(sorted[0].id);
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

    removeRun(runId: string): void {
      // O(1) 刪除（Map），不再需要 filter 整個陣列
      this.runsById.delete(runId);
      this.expandedRunIds.delete(runId);

      if (this.activeRunChatModal?.runId === runId) {
        this.activeRunChatModal = null;
      }

      // #44 巢狀 Map：一次 delete(runId) 清除該 run 所有 pod 的訊息
      this.runChatMessages.delete(runId);
    },

    deleteRun(runId: string): void {
      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) return;

      websocketClient.emit<RunDeletePayload>(
        WebSocketRequestEvents.RUN_DELETE,
        {
          requestId: generateRequestId(),
          canvasId,
          runId,
        },
      );

      this.removeRun(runId);
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
      this.activeRunChatModal = { runId, podId };
      this.isLoadingPodMessages = true;

      const canvasId = getActiveCanvasIdOrWarn("RunStore");
      if (!canvasId) {
        this.isLoadingPodMessages = false;
        return;
      }

      try {
        const response = await createWebSocketRequest<
          RunLoadPodMessagesPayload,
          RunPodMessagesResultPayload
        >({
          requestEvent: WebSocketRequestEvents.RUN_LOAD_POD_MESSAGES,
          responseEvent: WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT,
          payload: { canvasId, runId, podId },
        });

        if (response.success && response.messages) {
          // #44 巢狀 Map：取得或建立 runId 子 Map 後寫入 podId 訊息
          let podMap = this.runChatMessages.get(runId);
          if (!podMap) {
            podMap = new Map();
            this.runChatMessages.set(runId, podMap);
          }
          podMap.set(podId, response.messages.map(toMessage));
        }
      } finally {
        this.isLoadingPodMessages = false;
      }
    },

    closeRunChatModal(): void {
      this.activeRunChatModal = null;
    },

    appendRunChatMessage(
      runId: string,
      podId: string,
      messageId: string,
      content: string,
      isPartial: boolean,
      role: MessageRole,
      metadata?: SystemMessageMetadata,
    ): void {
      // #44 巢狀 Map：取得 podId 層訊息陣列
      let podMap = this.runChatMessages.get(runId);
      if (!podMap) {
        podMap = new Map();
        this.runChatMessages.set(runId, podMap);
      }
      const messages = podMap.get(podId) ?? [];

      const lastLength = this.accumulatedLengthByMessageId.get(messageId) ?? 0;
      // 後端重傳導致 content 長度倒退時，重置累積長度並以整段 content 作為 delta
      const delta =
        content.length < lastLength ? content : content.slice(lastLength);
      this.accumulatedLengthByMessageId.set(messageId, content.length);

      // messageIndexCache：串流期間提供 O(1) 定位，避免 findIndex 線性掃描
      const knownIndex = this.messageIndexCache.get(messageId);

      upsertMessage(
        messages,
        messageId,
        content,
        isPartial,
        role,
        delta,
        metadata,
        knownIndex,
      );

      // 新訊息被 push 到陣列末尾，快取其 index
      if (knownIndex === undefined) {
        const newIndex = messages.findIndex((m) => m.id === messageId);
        if (newIndex !== -1) {
          this.messageIndexCache.set(messageId, newIndex);
        }
      }

      podMap.set(podId, [...messages]);
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
      const messages = podMap.get(payload.podId) ?? [];

      const toolUseInfo: ToolUseInfo = {
        toolUseId: payload.toolUseId,
        toolName: payload.toolName,
        input: payload.input,
        status: "running",
      };

      const messageIndex = messages.findIndex(
        (m) => m.id === payload.messageId,
      );

      // 訊息尚不存在時（tool use 先於 text 到達），建立新 assistant 訊息
      if (messageIndex === -1) {
        podMap.set(payload.podId, [
          ...messages,
          createAssistantMessageWithTool(payload.messageId, toolUseInfo),
        ]);
        return;
      }

      const message = messages[messageIndex];
      if (!message) return;

      const toolAlreadyExists = message.toolUse?.some(
        (t) => t.toolUseId === payload.toolUseId,
      );
      if (toolAlreadyExists) return;

      const updatedMessages = [...messages];
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
      const podMap = this.runChatMessages.get(payload.runId);
      const messages = podMap?.get(payload.podId);
      if (!messages) return;

      const messageIndex = messages.findIndex(
        (m) => m.id === payload.messageId,
      );
      if (messageIndex === -1) return;

      const updatedMessages = [...messages];
      const message = updatedMessages[messageIndex];
      if (!message?.toolUse) return;

      updatedMessages[messageIndex] = mergeToolResultIntoMessage(
        message,
        payload.toolUseId,
        payload.output,
      );
      podMap!.set(payload.podId, updatedMessages);
    },

    handleRunChatComplete(
      runId: string,
      podId: string,
      messageId: string,
      fullContent: string,
    ): void {
      const podMap = this.runChatMessages.get(runId);
      const messages = podMap?.get(podId);
      if (!messages) return;

      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      this.accumulatedLengthByMessageId.delete(messageId);
      // complete 後清除 index 快取，防止 stale 快取污染後續串流
      this.messageIndexCache.delete(messageId);

      // findIndex 已確認 index 有效，斷言元素一定存在
      const message = messages[messageIndex] as Message;
      const updatedToolUse = finalizeToolUse(message.toolUse);
      const finalizedSubMessages = finalizeSubMessages(message.subMessages);

      const updatedMessages = [...messages];
      updatedMessages[messageIndex] = updateMainMessageState(
        message,
        fullContent,
        updatedToolUse,
        finalizedSubMessages,
      );
      podMap!.set(podId, updatedMessages);
    },

    resetOnCanvasSwitch(): void {
      this.runsById = new Map();
      this.expandedRunIds = new Set();
      this.activeRunChatModal = null;
      this.runChatMessages = new Map();
      this.isHistoryPanelOpen = false;
      this.accumulatedLengthByMessageId = new Map();
    },
  },
});
