import { defineStore } from "pinia";
import {
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { generateRequestId } from "@/services/utils";
import type { HistoryLoadingStatus, Message } from "@/types/chat";
import type {
  ConnectionReadyPayload,
  ContentBlock,
  HeartbeatPingPayload,
  PodChatAbortedPayload,
  PodChatAbortPayload,
  PodChatCompletePayload,
  PodChatMessagePayload,
  PodChatSendPayload,
  PodChatToolResultPayload,
  PodChatToolUsePayload,
  PodErrorPayload,
  PodMessagesClearedPayload,
} from "@/types/websocket";
import { createMessageActions } from "./chatMessageActions";
import { createConnectionActions } from "./chatConnectionActions";
import { createHistoryActions } from "./chatHistoryActions";
import { abortSafetyTimers } from "./abortSafetyTimers";
import { usePodStore } from "../pod/podStore";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { isMultiInstanceSourcePod } from "@/utils/multiInstanceGuard";
import { t } from "@/i18n";

/** 單一 ContentBlock base64Data 大小上限（5MB decoded） */
const MAX_CONTENT_BLOCK_SIZE_BYTES = 5 * 1024 * 1024;
/** 所有 contentBlocks base64Data 加總大小上限（20MB decoded） */
const MAX_CONTENT_BLOCKS_TOTAL_BYTES = 20 * 1024 * 1024;

const ABORT_TIMEOUT_MS = 10_000;

// 單例 store 的 actions 快取，避免每次呼叫都重新建立物件
let cachedConnectionActions: ReturnType<typeof createConnectionActions> | null =
  null;
let cachedMessageActions: ReturnType<typeof createMessageActions> | null = null;
let cachedHistoryActions: ReturnType<typeof createHistoryActions> | null = null;

export function resetChatActionsCache(): void {
  cachedConnectionActions = null;
  cachedMessageActions = null;
  cachedHistoryActions = null;
}

function hasMessageContent(
  content: string,
  contentBlocks: ContentBlock[] | undefined,
): boolean {
  return (contentBlocks?.length ?? 0) > 0 || content.trim().length > 0;
}

export type ChatStoreInstance = ReturnType<typeof useChatStore>;

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ChatState {
  messagesByPodId: Map<string, Message[]>;
  isTypingByPodId: Map<string, boolean>;
  currentStreamingMessageId: string | null;
  connectionStatus: ConnectionStatus;
  socketId: string | null;
  historyLoadingStatus: Map<string, HistoryLoadingStatus>;
  historyLoadingError: Map<string, string>;
  allHistoryLoaded: boolean;
  disconnectReason: string | null;
  lastHeartbeatAt: number | null;
  heartbeatCheckTimer: number | null;
  accumulatedLengthByMessageId: Map<string, number>;
}

export const useChatStore = defineStore("chat", {
  state: (): ChatState => ({
    messagesByPodId: new Map(),
    isTypingByPodId: new Map(),
    currentStreamingMessageId: null,
    connectionStatus: "disconnected",
    socketId: null,
    historyLoadingStatus: new Map(),
    historyLoadingError: new Map(),
    allHistoryLoaded: false,
    disconnectReason: null,
    lastHeartbeatAt: null,
    heartbeatCheckTimer: null,
    accumulatedLengthByMessageId: new Map(),
  }),

  getters: {
    getMessages: (state) => {
      return (podId: string): Message[] => {
        return state.messagesByPodId.get(podId) ?? [];
      };
    },

    isTyping: (state) => {
      return (podId: string): boolean => {
        return state.isTypingByPodId.get(podId) ?? false;
      };
    },

    isConnected: (state): boolean => {
      return state.connectionStatus === "connected";
    },

    getHistoryLoadingStatus: (state) => {
      return (podId: string): HistoryLoadingStatus => {
        return state.historyLoadingStatus.get(podId) ?? "idle";
      };
    },

    isHistoryLoading: (state) => {
      return (podId: string): boolean => {
        return state.historyLoadingStatus.get(podId) === "loading";
      };
    },

    isAllHistoryLoaded: (state): boolean => {
      return state.allHistoryLoaded;
    },

    getDisconnectReason: (state): string | null => {
      return state.disconnectReason;
    },
  },

  actions: {
    initWebSocket(): void {
      const connectionActions = this.getConnectionActions();
      connectionActions.initWebSocket();
    },

    disconnectWebSocket(): void {
      // 在 WebSocket 斷線時清除 actions 快取，避免跨測試或跨 session 的狀態污染
      resetChatActionsCache();
      const connectionActions = this.getConnectionActions();
      connectionActions.disconnectWebSocket();
    },

    getEventListenerConfig(): Array<{
      event: string;
      handler: (payload: unknown) => void;
    }> {
      return [
        {
          event: WebSocketResponseEvents.CONNECTION_READY,
          handler: this.handleConnectionReady as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
          handler: this.handleChatMessage as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_CHAT_TOOL_USE,
          handler: this.handleChatToolUse as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_CHAT_TOOL_RESULT,
          handler: this.handleChatToolResult as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_CHAT_COMPLETE,
          handler: this.handleChatComplete as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_CHAT_ABORTED,
          handler: this.handleChatAborted as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_ERROR,
          handler: this.handleError as (payload: unknown) => void,
        },
        {
          event: WebSocketResponseEvents.POD_MESSAGES_CLEARED,
          handler: this.handleMessagesClearedEvent as (
            payload: unknown,
          ) => void,
        },
        {
          event: WebSocketResponseEvents.HEARTBEAT_PING,
          handler: this.handleHeartbeatPing as (payload: unknown) => void,
        },
      ];
    },

    registerListeners(): void {
      this.unregisterListeners();
      this.getEventListenerConfig().forEach(({ event, handler }) => {
        websocketClient.on(event, handler);
      });
      websocketClient.onDisconnect(this.handleSocketDisconnect);
    },

    unregisterListeners(): void {
      this.getEventListenerConfig().forEach(({ event }) => {
        websocketClient.offAll(event);
      });
      websocketClient.offDisconnect(this.handleSocketDisconnect);
    },

    handleConnectionReady(payload: ConnectionReadyPayload): Promise<void> {
      const connectionActions = this.getConnectionActions();
      return connectionActions.handleConnectionReady(payload);
    },

    handleHeartbeatPing(payload: HeartbeatPingPayload): void {
      const connectionActions = this.getConnectionActions();
      connectionActions.handleHeartbeatPing(payload);
    },

    handleSocketDisconnect(code: string): void {
      const connectionActions = this.getConnectionActions();
      connectionActions.handleSocketDisconnect(code);
    },

    handleError(payload: PodErrorPayload): void {
      const connectionActions = this.getConnectionActions();
      connectionActions.handleError(payload);
    },

    async sendMessage(
      podId: string,
      content: string,
      contentBlocks?: ContentBlock[],
    ): Promise<void> {
      if (!this.isConnected) {
        throw new Error(t("composable.chat.websocketNotConnected"));
      }

      if (!hasMessageContent(content, contentBlocks)) return;

      // contentBlocks 大小驗證：單 block < 5MB，總計 < 20MB（decoded bytes 估算）
      if (contentBlocks && contentBlocks.length > 0) {
        let totalBytes = 0;
        for (const block of contentBlocks) {
          if (block.type === "image") {
            // base64 字串長度 * 3/4 ≈ decoded bytes
            const blockBytes = Math.ceil((block.base64Data.length * 3) / 4);
            if (blockBytes > MAX_CONTENT_BLOCK_SIZE_BYTES) {
              throw new Error(t("composable.chat.imageTooLarge"));
            }
            totalBytes += blockBytes;
          }
        }
        if (totalBytes > MAX_CONTENT_BLOCKS_TOTAL_BYTES) {
          throw new Error(t("composable.chat.imageTooLarge"));
        }
      }

      // 後端會根據 pod 綁定的 commandId 自行展開指令，前端直接送原文
      const messagePayload: string | ContentBlock[] =
        contentBlocks && contentBlocks.length > 0 ? contentBlocks : content;

      const podStore = usePodStore();
      const canvasId = getActiveCanvasIdOrWarn("ChatStore");
      if (!canvasId) return;

      websocketClient.emit<PodChatSendPayload>(
        WebSocketRequestEvents.POD_CHAT_SEND,
        {
          requestId: generateRequestId(),
          canvasId,
          podId,
          message: messagePayload,
        },
      );

      this.setTyping(podId, true);
      // 前端發送時立即更新，不等待 WebSocket 事件來回
      // multi-instance run 模式下源頭 pod 狀態由 run 流程管控，不應覆蓋為 chatting
      if (!isMultiInstanceSourcePod(podId)) {
        podStore.updatePodStatus(podId, "chatting");
      }
    },

    addUserMessage(podId: string, content: string): void {
      const messageActions = this.getMessageActions();
      messageActions.addUserMessage(podId, content);
    },

    addRemoteUserMessage(
      podId: string,
      messageId: string,
      content: string,
      timestamp: string,
    ): void {
      const messageActions = this.getMessageActions();
      messageActions.addRemoteUserMessage(podId, messageId, content, timestamp);
    },

    handleChatMessage(payload: PodChatMessagePayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleChatMessage(payload);
    },

    handleChatToolUse(payload: PodChatToolUsePayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleChatToolUse(payload);
    },

    handleChatToolResult(payload: PodChatToolResultPayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleChatToolResult(payload);
    },

    handleChatComplete(payload: PodChatCompletePayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleChatComplete(payload);
    },

    async abortChat(podId: string): Promise<void> {
      if (!this.isConnected) {
        this.setTyping(podId, false);
        return;
      }

      const canvasId = getActiveCanvasIdOrWarn("ChatStore");
      if (!canvasId) return;

      websocketClient.emit<PodChatAbortPayload>(
        WebSocketRequestEvents.POD_CHAT_ABORT,
        {
          requestId: generateRequestId(),
          canvasId,
          podId,
        },
      );

      const existingTimer = abortSafetyTimers.get(podId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        abortSafetyTimers.delete(podId);
        if (this.isTypingByPodId.get(podId)) {
          this.setTyping(podId, false);
        }
      }, ABORT_TIMEOUT_MS);
      abortSafetyTimers.set(podId, timer);
    },

    handleChatAborted(payload: PodChatAbortedPayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleChatAborted(payload);
    },

    setTyping(podId: string, isTyping: boolean): void {
      const messageActions = this.getMessageActions();
      messageActions.setTyping(podId, isTyping);
    },

    clearMessagesByPodIds(podIds: string[]): void {
      const messageActions = this.getMessageActions();
      messageActions.clearMessagesByPodIds(podIds);

      podIds.forEach((podId) => {
        this.historyLoadingStatus.delete(podId);
        this.historyLoadingError.delete(podId);
      });
    },

    handleMessagesClearedEvent(payload: PodMessagesClearedPayload): void {
      const messageActions = this.getMessageActions();
      messageActions.handleMessagesClearedEvent(payload);
    },

    loadPodChatHistory(podId: string): Promise<void> {
      const historyActions = this.getHistoryActions();
      return historyActions.loadPodChatHistory(podId);
    },

    loadAllPodsHistory(podIds: string[]): Promise<void> {
      const historyActions = this.getHistoryActions();
      return historyActions.loadAllPodsHistory(podIds);
    },

    getConnectionActions() {
      if (!cachedConnectionActions) {
        cachedConnectionActions = createConnectionActions(this);
      }
      return cachedConnectionActions;
    },

    getMessageActions() {
      if (!cachedMessageActions) {
        cachedMessageActions = createMessageActions(this);
      }
      return cachedMessageActions;
    },

    getHistoryActions() {
      if (!cachedHistoryActions) {
        const messageActions = this.getMessageActions();
        cachedHistoryActions = createHistoryActions(this, messageActions);
      }
      return cachedHistoryActions;
    },

    // 切換 canvas 時重設 chat 相關狀態
    resetForCanvasSwitch(): void {
      this.messagesByPodId.clear();
      this.isTypingByPodId.clear();
      this.historyLoadingStatus.clear();
      this.historyLoadingError.clear();
      // 清除累積長度追蹤，避免跨 canvas 的舊 messageId 殘留導致計算錯誤
      this.accumulatedLengthByMessageId.clear();
    },
  },
});
