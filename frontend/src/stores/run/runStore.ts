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
  buildRunPodCacheKey,
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

interface RunState {
  runs: WorkflowRun[];
  isHistoryPanelOpen: boolean;
  expandedRunIds: Set<string>;
  activeRunChatModal: { runId: string; podId: string } | null;
  runChatMessages: Map<string, Message[]>;
  isLoadingPodMessages: boolean;
  accumulatedLengthByMessageId: Map<string, number>;
}

export const useRunStore = defineStore("run", {
  state: (): RunState => ({
    runs: [],
    isHistoryPanelOpen: false,
    expandedRunIds: new Set(),
    activeRunChatModal: null,
    runChatMessages: new Map(),
    isLoadingPodMessages: false,
    accumulatedLengthByMessageId: new Map(),
  }),

  getters: {
    sortedRuns: (state): WorkflowRun[] => {
      return [...state.runs]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, MAX_RUNS_PER_CANVAS);
    },

    runningRunsCount: (state): number => {
      return state.runs.filter((run) => run.status === "running").length;
    },

    getRunById:
      (state) =>
      (runId: string): WorkflowRun | undefined => {
        return state.runs.find((run) => run.id === runId);
      },

    getActiveRunChatMessages(state): Message[] {
      if (!state.activeRunChatModal) return [];
      const { runId, podId } = state.activeRunChatModal;
      return state.runChatMessages.get(buildRunPodCacheKey(runId, podId)) ?? [];
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
          this.runs = response.runs;
        }
      } catch {
        const { showErrorToast } = useToast();
        showErrorToast("Run", t("store.run.loadFailed"));
      }
    },

    addRun(run: WorkflowRun): void {
      const exists = this.runs.some((r) => r.id === run.id);
      if (exists) return;

      this.runs.unshift(run);

      if (this.runs.length > MAX_RUNS_PER_CANVAS) {
        this.runs = this.runs.slice(0, MAX_RUNS_PER_CANVAS);
      }
    },

    updateRunStatus(
      runId: string,
      status: RunStatus,
      completedAt?: string,
    ): void {
      const run = this.runs.find((r) => r.id === runId);
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
      const run = this.runs.find((r) => r.id === payload.runId);
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
      this.runs = this.runs.filter((r) => r.id !== runId);
      this.expandedRunIds.delete(runId);

      if (this.activeRunChatModal?.runId === runId) {
        this.activeRunChatModal = null;
      }

      for (const key of this.runChatMessages.keys()) {
        if (key.startsWith(`${runId}:`)) {
          this.runChatMessages.delete(key);
        }
      }
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
          this.runChatMessages.set(
            buildRunPodCacheKey(runId, podId),
            response.messages.map(toMessage),
          );
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
      const key = buildRunPodCacheKey(runId, podId);
      const messages = this.runChatMessages.get(key) ?? [];

      const lastLength = this.accumulatedLengthByMessageId.get(messageId) ?? 0;
      // 後端重傳導致 content 長度倒退時，重置累積長度並以整段 content 作為 delta
      const delta =
        content.length < lastLength ? content : content.slice(lastLength);
      this.accumulatedLengthByMessageId.set(messageId, content.length);

      upsertMessage(
        messages,
        messageId,
        content,
        isPartial,
        role,
        delta,
        metadata,
      );

      this.runChatMessages.set(key, [...messages]);
    },

    handleRunChatToolUse(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }): void {
      const key = buildRunPodCacheKey(payload.runId, payload.podId);
      const messages = this.runChatMessages.get(key) ?? [];

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
        this.runChatMessages.set(key, [
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
      this.runChatMessages.set(key, updatedMessages);
    },

    handleRunChatToolResult(payload: {
      runId: string;
      podId: string;
      messageId: string;
      toolUseId: string;
      toolName: string;
      output: string;
    }): void {
      const key = buildRunPodCacheKey(payload.runId, payload.podId);
      const messages = this.runChatMessages.get(key);
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
      this.runChatMessages.set(key, updatedMessages);
    },

    handleRunChatComplete(
      runId: string,
      podId: string,
      messageId: string,
      fullContent: string,
    ): void {
      const key = buildRunPodCacheKey(runId, podId);
      const messages = this.runChatMessages.get(key);
      if (!messages) return;

      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      this.accumulatedLengthByMessageId.delete(messageId);

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
      this.runChatMessages.set(key, updatedMessages);
    },

    resetOnCanvasSwitch(): void {
      this.runs = [];
      this.expandedRunIds = new Set();
      this.activeRunChatModal = null;
      this.runChatMessages = new Map();
      this.isHistoryPanelOpen = false;
      this.accumulatedLengthByMessageId = new Map();
    },
  },
});
