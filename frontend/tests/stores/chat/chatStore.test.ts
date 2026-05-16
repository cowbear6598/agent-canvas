import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockWebSocketClient,
} from "../../helpers/mockWebSocket";
import { setupStoreTest, mockToastFactory } from "../../helpers/testSetup";
import { createMockPod } from "../../helpers/factories";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ContentBlock, TextContentBlock } from "@/types/websocket";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/composables/useToast", () => mockToastFactory());

function createExecutablePod(overrides = {}) {
  return createMockPod({
    goal: {
      todos: [{ id: "goal-1", text: "Ship it" }],
    },
    goalStatus: "ready",
    canExecute: true,
    ...overrides,
  });
}

describe("chatStore", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
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
    it("成功時應 emit WebSocket 事件並設定 isTyping 為 true", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      const pod = createExecutablePod({ id: "pod-1" });
      podStore.pods = [pod];
      const store = useChatStore();
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "Hello");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:send", {
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
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "run this");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:send", {
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
      store.connectionStatus = "connected";

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "Check this" },
        { type: "image", mediaType: "image/png", base64Data: "abc123" },
      ];

      await store.sendMessage("pod-1", "", contentBlocks);

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:send", {
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
      store.connectionStatus = "connected";

      const contentBlocks: ContentBlock[] = [
        { type: "text", text: "this file" },
        { type: "image", mediaType: "image/png", base64Data: "xyz" },
      ];

      await store.sendMessage("pod-1", "", contentBlocks);

      const emittedBlocks = (mockWebSocketClient.emit.mock.calls[0]![1] as any)
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
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "Hello");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
    });

    it("空白訊息時不應發送", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "   ");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
    });

    it("空白訊息且無 contentBlocks 時不應發送", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const store = useChatStore();
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "", []);

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
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

    it("Pod 沒有 Goal 時應阻止送出", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      const podStore = usePodStore();
      podStore.pods = [
        createMockPod({
          id: "pod-1",
          goal: null,
          goalStatus: "unset",
          canExecute: false,
        }),
      ];
      const store = useChatStore();
      store.connectionStatus = "connected";

      await expect(store.sendMessage("pod-1", "Hello")).rejects.toThrow(
        "請先設定 Goal 再執行這個 Pod",
      );
      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
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
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "run this");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:send", {
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
      store.connectionStatus = "connected";

      await store.sendMessage("pod-1", "/foo 請幫我");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:send", {
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
      store.connectionStatus = "connected";

      await store.abortChat("pod-1");

      expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:chat:abort", {
        requestId: expect.any(String),
        canvasId: "canvas-1",
        podId: "pod-1",
      });
    });

    it("activeCanvasId 為 null 時不應發送 WebSocket 事件", async () => {
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      const store = useChatStore();
      store.connectionStatus = "connected";

      await store.abortChat("pod-1");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
    });

    it("未連線時不應發送 WebSocket 事件", async () => {
      const store = useChatStore();
      store.connectionStatus = "disconnected";

      await store.abortChat("pod-1");

      expect(mockWebSocketClient.emit).not.toHaveBeenCalled();
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
    it("應註冊所有事件 listener", () => {
      const store = useChatStore();

      store.registerListeners();

      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        "connection:ready",
        expect.any(Function),
      );
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        "pod:chat:aborted",
        expect.any(Function),
      );
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        "pod:error",
        expect.any(Function),
      );
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        "heartbeat:ping",
        expect.any(Function),
      );
      expect(mockWebSocketClient.onDisconnect).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("註冊前應先取消註冊（呼叫 unregisterListeners）", () => {
      const store = useChatStore();
      const unregisterSpy = vi.spyOn(store, "unregisterListeners");

      store.registerListeners();

      expect(unregisterSpy).toHaveBeenCalled();
    });
  });

  describe("unregisterListeners", () => {
    it("應使用 offAll 取消所有事件 listener", () => {
      const store = useChatStore();
      store.registerListeners();
      mockWebSocketClient.offAll.mockClear();
      mockWebSocketClient.offDisconnect.mockClear();

      store.unregisterListeners();

      expect(mockWebSocketClient.offAll).toHaveBeenCalledWith(
        "connection:ready",
      );
      expect(mockWebSocketClient.offAll).toHaveBeenCalledWith(
        "pod:chat:aborted",
      );
      expect(mockWebSocketClient.offAll).toHaveBeenCalledWith("pod:error");
      expect(mockWebSocketClient.offAll).toHaveBeenCalledWith("heartbeat:ping");
      expect(mockWebSocketClient.offDisconnect).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("重複呼叫 registerListeners 不會造成 listener 累積", () => {
      const store = useChatStore();

      store.registerListeners();
      store.registerListeners();
      store.registerListeners();

      // 每次 registerListeners 都會先呼叫 unregisterListeners（offAll），
      // 確保每個事件只有一個 listener，不會因重複註冊而累積
      const onCallsForReady = mockWebSocketClient.on.mock.calls.filter(
        ([event]) => event === "connection:ready",
      );
      // 3 次 registerListeners，每次都 offAll 後重新 on，最終 on 被呼叫 3 次
      expect(onCallsForReady.length).toBe(3);
      // offAll 被呼叫次數：第 1 次 registerListeners 先 offAll（但 Map 為空），
      // 第 2、3 次各 offAll 一次，共 3 次
      const offAllCallsForReady = mockWebSocketClient.offAll.mock.calls.filter(
        ([event]) => event === "connection:ready",
      );
      expect(offAllCallsForReady.length).toBe(3);
    });
  });
});
