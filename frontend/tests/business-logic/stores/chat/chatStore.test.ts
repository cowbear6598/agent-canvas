import { describe, it, expect, vi, afterEach } from "vitest";
import { setupStoreTest, mockToastFactory } from "@tests/helpers/testSetup";
import { createMockPod } from "@tests/helpers/factories";
import { startFakeWebSocketServer } from "@tests/helpers/fakeWebSocketServer";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type {
  ContentBlock,
  PodChatSendPayload,
  TextContentBlock,
} from "@/types/websocket";
import {
  connectChatStoreToFakeServer,
  disconnectChatStoreFromFakeServer,
  expectMessagePayload,
  waitForExpect,
} from "@tests/helpers/chatWebSocketFlowTestUtils";

vi.mock("@/composables/useToast", () => mockToastFactory());

function createExecutablePod(overrides = {}) {
  return createMockPod({
    goal: {
      todos: [{ id: "goal-1", text: "Ship it" }],
    },
    ...overrides,
  });
}

describe("chatStore", () => {
  let fakeServer: ReturnType<typeof startFakeWebSocketServer> | undefined;

  setupStoreTest(() => {
    resetChatActionsCache();
  });

  afterEach(async () => {
    await disconnectChatStoreFromFakeServer(fakeServer);
    fakeServer = undefined;
  });

  describe("getters", () => {
    describe("getDisconnectReason", () => {
      it("應回傳 disconnectReason", () => {
        const store = useChatStore();
        store.disconnectReason = "Server timeout";

        expect(store.getDisconnectReason).toBe("Server timeout");
      });

      it("disconnectReason 為 null 時應回傳 null", () => {
        const store = useChatStore();
        store.disconnectReason = null;

        expect(store.getDisconnectReason).toBeNull();
      });
    });
  });

  describe("sendMessage", () => {
    it("成功時應透過 WebSocket 送出事件並設定 isTyping 為 true", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "Hello");

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      expect(expectMessagePayload<PodChatSendPayload>(message)).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        message: "Hello",
      });
      expect(store.isTypingByPodId.get("pod-1")).toBe(true);
    });

    it("送出純文字時 message 維持原樣", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "run this");

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      expect(expectMessagePayload<PodChatSendPayload>(message)).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        message: "run this",
      });
    });

    it("含 contentBlocks 時應組裝 blocks 格式", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "Check this" },
        { type: "image", mediaType: "image/png", base64Data: "abc123" },
      ];

      await store.sendMessage("pod-1", "", contentBlocks);

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      expect(expectMessagePayload<PodChatSendPayload>(message)).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        message: contentBlocks,
      });
    });

    it("contentBlocks 含 text 時，第一個 text block 維持原樣", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "this file" },
        { type: "image", mediaType: "image/png", base64Data: "xyz" },
      ];

      await store.sendMessage("pod-1", "", contentBlocks);

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      const emittedBlocks = expectMessagePayload<PodChatSendPayload>(message)
        .message as ContentBlock[];
      expect((emittedBlocks[0] as TextContentBlock).text).toBe("this file");
    });

    it("activeCanvasId 為 null 時不應發送 WebSocket 事件", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "Hello");

      expect(fakeServer.receivedMessages).toHaveLength(0);
    });

    it("空白訊息時不應發送", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "   ");

      expect(fakeServer.receivedMessages).toHaveLength(0);
    });

    it("空白訊息且無 contentBlocks 時不應發送", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "", []);

      expect(fakeServer.receivedMessages).toHaveLength(0);
    });

    it("未連線時應 throw Error", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "disconnected";

      await expect(store.sendMessage("pod-1", "Hello")).rejects.toThrow(
        "WebSocket 尚未連線",
      );
    });

    it("Pod 沒有 Goal 時仍應正常送出（Goal 已改為可選）", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({
          id: "pod-1",
          goal: null,
        }),
      ];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "Hello");

      await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
    });

    it("Codex Pod message 為原始文字", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({
        id: "pod-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "run this");

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      expect(expectMessagePayload<PodChatSendPayload>(message)).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        message: "run this",
      });
    });

    it('使用者輸入 "/foo 請幫我" 時 message 照原樣送出', async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.sendMessage("pod-1", "/foo 請幫我");

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
      );
      expect(expectMessagePayload<PodChatSendPayload>(message)).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
        message: "/foo 請幫我",
      });
    });
  });

  describe("abortChat", () => {
    it("已連線時應 emit POD_CHAT_ABORT 事件", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.abortChat("pod-1");

      const message = await fakeServer.waitForMessage(
        (candidate) =>
          candidate.type === WebSocketRequestEvents.POD_CHAT_ABORT,
      );
      expect(message.payload).toMatchObject({
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
      });
    });

    it("activeCanvasId 為 null 時不應發送 WebSocket 事件", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      await store.abortChat("pod-1");

      expect(fakeServer.receivedMessages).toHaveLength(0);
    });

    it("未連線時不應發送 WebSocket 事件", async () => {
      const store = useChatStore();
      store.connectionStatus = "disconnected";
      fakeServer = startFakeWebSocketServer();

      await store.abortChat("pod-1");

      expect(fakeServer.receivedMessages).toHaveLength(0);
    });

    it("未連線時應立即重設 isTyping 狀態，避免卡在 chatting", async () => {
      const store = useChatStore();
      store.connectionStatus = "disconnected";
      store.isTypingByPodId.set("pod-1", true);

      await store.abortChat("pod-1");

      expect(store.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("已連線時若 10 秒後仍在 typing，應強制重設 isTyping", async () => {
      vi.useFakeTimers();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";
      store.isTypingByPodId.set("pod-1", true);

      await store.abortChat("pod-1");

      // 尚未超時，isTyping 仍為 true
      expect(store.isTypingByPodId.get("pod-1")).toBe(true);

      // 觸發 10 秒超時
      vi.advanceTimersByTime(10000);

      expect(store.isTypingByPodId.get("pod-1")).toBe(false);

      vi.useRealTimers();
    });

    it("已連線時若 10 秒內 isTyping 已被正常重設，安全超時不應重複觸發", async () => {
      vi.useFakeTimers();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";
      store.isTypingByPodId.set("pod-1", true);

      await store.abortChat("pod-1");

      // 模擬正常收到 abort 回應後 isTyping 被重設
      store.setTyping("pod-1", false);

      vi.advanceTimersByTime(10000);

      // isTyping 應維持 false（安全超時不應造成額外影響）
      expect(store.isTypingByPodId.get("pod-1")).toBe(false);

      vi.useRealTimers();
    });

    it("setTyping(false) 後安全超時 timer 應被清除，不再觸發", async () => {
      vi.useFakeTimers();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";
      store.isTypingByPodId.set("pod-1", true);

      await store.abortChat("pod-1");

      // 模擬正常收到 abort 回應後 isTyping 被重設，timer 應被清除
      store.setTyping("pod-1", false);

      // 手動將 isTyping 再設回 true，模擬新的 chat 開始
      store.isTypingByPodId.set("pod-1", true);

      // 舊的 timer 應已被清除，不應干擾新的 chat
      vi.advanceTimersByTime(10000);
      expect(store.isTypingByPodId.get("pod-1")).toBe(true);

      vi.useRealTimers();
    });

    it("連續兩次 abort 時，新的 abort 應覆蓋舊的 timer", async () => {
      vi.useFakeTimers();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";
      store.isTypingByPodId.set("pod-1", true);

      // 第一次 abort
      await store.abortChat("pod-1");

      // 推進 5 秒（舊 timer 尚未觸發）
      vi.advanceTimersByTime(5000);
      expect(store.isTypingByPodId.get("pod-1")).toBe(true);

      // 第二次 abort，應清除舊 timer 並設置新的 10 秒 timer
      await store.abortChat("pod-1");

      // 再推進 5 秒（若舊 timer 未清除，應在此觸發；但新 timer 剩 10 秒）
      vi.advanceTimersByTime(5000);
      expect(store.isTypingByPodId.get("pod-1")).toBe(true);

      // 再推進 5 秒，新 timer 觸發
      vi.advanceTimersByTime(5000);
      expect(store.isTypingByPodId.get("pod-1")).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("handleChatAborted", () => {
    it("收到 aborted 事件後 currentStreamingMessageId 應被清為 null", () => {
      const store = useChatStore();
      store.currentStreamingMessageId = "msg-1";

      store.handleChatAborted({ podId: "pod-1", messageId: "msg-1" });

      expect(store.currentStreamingMessageId).toBeNull();
    });

    it("收到 aborted 事件且訊息存在時，訊息的 isPartial 應被設為 false", () => {
      const store = useChatStore();
      store.messagesByPodId.set("pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "部分回應...",
          isPartial: true,
          timestamp: "2024-01-01",
        },
      ]);
      store.currentStreamingMessageId = "msg-1";

      store.handleChatAborted({ podId: "pod-1", messageId: "msg-1" });

      const messages = store.messagesByPodId.get("pod-1");
      expect(messages?.[0]?.isPartial).toBe(false);
    });

    it("收到 aborted 事件且訊息不存在時（messageIndex === -1），isTyping 仍應被設為 false", () => {
      const store = useChatStore();
      store.isTypingByPodId.set("pod-1", true);

      store.handleChatAborted({
        podId: "pod-1",
        messageId: "non-existent-msg",
      });

      expect(store.isTypingByPodId.get("pod-1")).toBe(false);
    });
  });

  describe("resetForCanvasSwitch", () => {
    it("應清空所有 Map（messagesByPodId / isTypingByPodId / accumulatedLengthByMessageId）", () => {
      const store = useChatStore();

      store.messagesByPodId.set("pod-1", [
        { id: "msg-1", role: "user", content: "Hi", timestamp: "" },
      ]);
      store.isTypingByPodId.set("pod-1", true);
      store.accumulatedLengthByMessageId.set("msg-1", 100);

      store.resetForCanvasSwitch();

      expect(store.messagesByPodId.size).toBe(0);
      expect(store.isTypingByPodId.size).toBe(0);
      expect(store.accumulatedLengthByMessageId.size).toBe(0);
    });
  });

  describe("clearMessagesByPodIds", () => {
    it("應清除指定 podIds 的 messages", () => {
      const store = useChatStore();
      store.messagesByPodId.set("pod-1", [
        { id: "msg-1", role: "user", content: "Hi", timestamp: "" },
      ]);
      store.messagesByPodId.set("pod-2", [
        { id: "msg-2", role: "user", content: "Hello", timestamp: "" },
      ]);
      store.messagesByPodId.set("pod-3", [
        { id: "msg-3", role: "user", content: "Hey", timestamp: "" },
      ]);

      store.clearMessagesByPodIds(["pod-1", "pod-2"]);

      expect(store.messagesByPodId.has("pod-1")).toBe(false);
      expect(store.messagesByPodId.has("pod-2")).toBe(false);
      expect(store.messagesByPodId.has("pod-3")).toBe(true);
    });

    it("應清除指定 podIds 的 typing 狀態", () => {
      const store = useChatStore();
      store.isTypingByPodId.set("pod-1", true);
      store.isTypingByPodId.set("pod-2", true);
      store.isTypingByPodId.set("pod-3", true);

      store.clearMessagesByPodIds(["pod-1", "pod-2"]);

      expect(store.isTypingByPodId.has("pod-1")).toBe(false);
      expect(store.isTypingByPodId.has("pod-2")).toBe(false);
      expect(store.isTypingByPodId.has("pod-3")).toBe(true);
    });

    it("空陣列時不應清除任何資料", () => {
      const store = useChatStore();
      store.messagesByPodId.set("pod-1", [
        { id: "msg-1", role: "user", content: "Hi", timestamp: "" },
      ]);
      store.isTypingByPodId.set("pod-1", true);

      store.clearMessagesByPodIds([]);

      expect(store.messagesByPodId.has("pod-1")).toBe(true);
      expect(store.isTypingByPodId.has("pod-1")).toBe(true);
    });
  });

  describe("registerListeners", () => {
    it("註冊後應能接收 server 事件並更新 chat 狀態", async () => {
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();

      store.registerListeners();
      store.connectionStatus = "connecting";
      const readyClientPromise = fakeServer.waitForConnection();
      const { websocketClient } = await import("@/services/websocket");
      websocketClient.connect(fakeServer.url);
      const client = await readyClientPromise;

      client.send(WebSocketResponseEvents.CONNECTION_READY, {
        socketId: "socket-listener",
      });

      await waitForExpect(() => {
        expect(store.connectionStatus).toBe("connected");
        expect(store.socketId).toBe("socket-listener");
      });
    });

    it("重複註冊後收到事件只套用目前的 listener 狀態", async () => {
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();

      store.registerListeners();
      store.registerListeners();
      await connectChatStoreToFakeServer(fakeServer, "socket-repeat");

      fakeServer.emit(WebSocketResponseEvents.POD_ERROR, {
        podId: "pod-1",
        error: "Server failed",
        code: "SERVER_ERROR",
      });

      await waitForExpect(() => {
        expect(store.messagesByPodId.get("pod-1")).toHaveLength(1);
      });
    });
  });

  describe("unregisterListeners", () => {
    it("取消註冊後 server 事件不再更新 chat 狀態", async () => {
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);

      store.unregisterListeners();
      fakeServer.emit(WebSocketResponseEvents.POD_ERROR, {
        podId: "pod-1",
        error: "Server failed",
        code: "SERVER_ERROR",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(store.messagesByPodId.get("pod-1")).toBeUndefined();
    });

    it("取消註冊 chat listener 時不應移除同事件的外部 listener", async () => {
      const store = useChatStore();
      fakeServer = startFakeWebSocketServer();
      await connectChatStoreToFakeServer(fakeServer);
      const { websocketClient } = await import("@/services/websocket");
      const runListener = vi.fn();

      websocketClient.on(WebSocketResponseEvents.RUN_MESSAGE, runListener);

      try {
        store.unregisterListeners();
        fakeServer.emit(WebSocketResponseEvents.RUN_MESSAGE, {
          runId: "run-1",
          canvasId: "canvas-1",
          podId: "pod-1",
          messageId: "message-1",
          content: "run output",
          isPartial: true,
          role: "assistant",
        });

        await waitForExpect(() => {
          expect(runListener).toHaveBeenCalledWith(
            expect.objectContaining({
              runId: "run-1",
              messageId: "message-1",
              content: "run output",
            }),
          );
        });
        expect(store.messagesByPodId.get("pod-1")).toBeUndefined();
      } finally {
        websocketClient.off(WebSocketResponseEvents.RUN_MESSAGE, runListener);
      }
    });
  });
});
