import { describe, it, expect, beforeEach, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod, createMockMessage } from "../../helpers/factories";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { createAssistantMessageShape } from "@/stores/chat/chatMessageActions";
import type {
  PodChatMessagePayload,
  PodChatToolUsePayload,
  PodChatToolResultPayload,
  PodChatCompletePayload,
  PodChatAbortedPayload,
  PodMessagesClearedPayload,
  PersistedMessage,
} from "@/types/websocket";
import type { Message, SubMessage, ToolUseInfo } from "@/types/chat";
import {
  CONTENT_PREVIEW_LENGTH,
  RESPONSE_PREVIEW_LENGTH,
} from "@/lib/constants";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

describe("chatMessageActions", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
  });

  describe("addUserMessage", () => {
    it("應新增 user 訊息到 messagesByPodId", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      await chatStore.addUserMessage("pod-1", "Hello World");

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages![0]).toMatchObject({
        role: "user",
        content: "Hello World",
      });
      expect(messages![0]!.id).toBeDefined();
      expect(messages![0]!.timestamp).toBeDefined();
    });

    it('應更新 Pod 的 output（含截斷的內容預覽，30 字元 + "> " prefix）', async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      const longContent = "a".repeat(50);
      await chatStore.addUserMessage("pod-1", longContent);

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(1);
      expect(updatedPod!.output[0]).toBe(
        `> ${"a".repeat(CONTENT_PREVIEW_LENGTH)}...`,
      );
    });

    it("應追加訊息到現有 messages 陣列", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      await chatStore.addUserMessage("pod-1", "First message");
      await chatStore.addUserMessage("pod-1", "Second message");

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(2);
      expect(messages![0]!.content).toBe("First message");
      expect(messages![1]!.content).toBe("Second message");
    });

    it("Pod 不存在時不應新增訊息也不應更新 output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();

      await chatStore.addUserMessage("non-existent", "Hello");

      expect(chatStore.messagesByPodId.has("non-existent")).toBe(false);
      expect(podStore.pods).toHaveLength(0);
    });

    it("應保留 Pod 既有的 output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: ["existing line"] });
      podStore.pods = [pod];

      await chatStore.addUserMessage("pod-1", "New message");

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(2);
      expect(updatedPod!.output[0]).toBe("existing line");
      expect(updatedPod!.output[1]).toMatch(/^> New message/);
    });
  });

  describe("handleChatMessage - 新訊息", () => {
    it("訊息不存在時應建立新 assistant 訊息", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages![0]).toMatchObject({
        id: "msg-1",
        role: "assistant",
        content: "Hello",
        isPartial: true,
      });
    });

    it("應設定 currentStreamingMessageId", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Streaming...",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      expect(chatStore.currentStreamingMessageId).toBe("msg-1");
    });

    it("isPartial 為 true 時應設定 isTyping", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Typing...",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(true);
    });

    it("應建立初始 subMessage", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.subMessages).toHaveLength(1);
      expect(messages![0]!.subMessages![0]).toMatchObject({
        id: "msg-1-sub-0",
        content: "Content",
        isPartial: true,
      });
    });

    it("新建立的 assistant 訊息不應帶 expectingNewBlock", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]).not.toHaveProperty("expectingNewBlock");
    });

    it("應記錄 accumulatedLengthByMessageId", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello World",
        isPartial: true,
      };

      chatStore.handleChatMessage(payload);

      expect(chatStore.accumulatedLengthByMessageId.get("msg-1")).toBe(11);
    });

    it("system 訊息應保留 metadata 且不建立 assistant 專用 subMessages", () => {
      const chatStore = useChatStore();
      const payload: PodChatMessagePayload = {
        podId: "pod-1",
        messageId: "msg-system",
        content: "Authentication failed",
        isPartial: false,
        role: "system",
        metadata: {
          provider: "claude",
          code: "AUTH_ERROR",
          severity: "error",
          rawContent: "Authentication failed",
        },
      };

      chatStore.handleChatMessage(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]).toMatchObject({
        id: "msg-system",
        role: "system",
        content: "Authentication failed",
        metadata: {
          provider: "claude",
          code: "AUTH_ERROR",
          severity: "error",
        },
      });
      expect(messages![0]!.subMessages).toBeUndefined();
    });
  });

  describe("handleChatMessage - 更新訊息", () => {
    it("應更新既有訊息的 content", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello",
        isPartial: true,
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello World",
        isPartial: true,
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.content).toBe("Hello World");
    });

    it("應計算 delta（content 增量）並累加到同一個 subMessage", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello",
        isPartial: true,
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello World",
        isPartial: true,
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(1);
      expect(subMessages[0]!.content).toBe("Hello World");
    });

    it("應更新 subMessage 的 content（delta 持續累加到同一個 subMessage）", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Part1",
        isPartial: true,
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Part1Part2",
        isPartial: true,
      });

      let messages = chatStore.messagesByPodId.get("pod-1");
      let subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(1);
      expect(subMessages[0]!.content).toBe("Part1Part2");

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Part1Part2Part3",
        isPartial: true,
      });

      messages = chatStore.messagesByPodId.get("pod-1");
      subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(1);
      expect(subMessages[0]!.content).toBe("Part1Part2Part3");
      expect(subMessages[0]!.isPartial).toBe(true);
    });

    it("toolUse 觸發 flush 後，後續 delta 應累加到新的 subMessage", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Block1",
        isPartial: true,
      });

      // toolUse 觸發 flush：建立新 subMessage
      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Block1Block2",
        isPartial: true,
      });

      const updatedMessages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = updatedMessages![0]!.subMessages!;

      expect(subMessages).toHaveLength(2);
      expect(subMessages[0]!.content).toBe("Block1");
      expect(subMessages[1]!.content).toBe("Block2");
    });

    it("delta 應持續累加到最後一個 subMessage", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello",
        isPartial: true,
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello World",
        isPartial: true,
      });

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello World!",
        isPartial: true,
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(1);
      expect(subMessages[0]!.content).toBe("Hello World!");
    });
  });

  describe("handleChatMessage - user role 訊息", () => {
    it("role 為 user 時應更新 Pod output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "User message",
        isPartial: false,
        role: "user",
      });

      await vi.waitFor(() => {
        const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
        expect(updatedPod!.output).toHaveLength(1);
      });

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output[0]).toBe("> User message");
    });

    it("應避免重複追加相同內容", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: ["> User message"] });
      podStore.pods = [pod];

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "User message",
        isPartial: false,
        role: "user",
      });

      await vi.waitFor(() => {
        const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
        expect(updatedPod!.output).toHaveLength(1);
      });

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(1);
      expect(updatedPod!.output[0]).toBe("> User message");
    });
  });

  describe("handleChatToolUse - 新訊息", () => {
    it("訊息不存在時應建立含 toolUse 的新訊息", () => {
      const chatStore = useChatStore();
      const payload: PodChatToolUsePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      };

      chatStore.handleChatToolUse(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages![0]).toMatchObject({
        id: "msg-1",
        role: "assistant",
        content: "",
        isPartial: true,
      });
      expect(messages![0]!.toolUse).toHaveLength(1);
      expect(messages![0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
        status: "running",
      });
    });

    it("應同時建立包含 toolUse 的 subMessage", () => {
      const chatStore = useChatStore();
      const payload: PodChatToolUsePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        input: { file_path: "/test.ts" },
      };

      chatStore.handleChatToolUse(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.subMessages).toHaveLength(1);
      expect(messages![0]!.subMessages![0]).toMatchObject({
        id: "msg-1-sub-0",
        content: "",
        isPartial: true,
      });
      expect(messages![0]!.subMessages![0]!.toolUse).toHaveLength(1);
      expect(messages![0]!.subMessages![0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        toolName: "Read",
        status: "running",
      });
    });

    it("createMessageWithToolUse 建立的訊息不應帶 expectingNewBlock", () => {
      const chatStore = useChatStore();
      const payload: PodChatToolUsePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      };

      chatStore.handleChatToolUse(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]).not.toHaveProperty("expectingNewBlock");
    });

    it("應設定 currentStreamingMessageId", () => {
      const chatStore = useChatStore();
      const payload: PodChatToolUsePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      };

      chatStore.handleChatToolUse(payload);

      expect(chatStore.currentStreamingMessageId).toBe("msg-1");
    });
  });

  describe("handleChatToolUse - 更新訊息", () => {
    it("訊息存在時應新增 toolUse 到陣列", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Thinking...",
        isPartial: true,
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        input: { file_path: "/test.ts" },
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-2",
        toolName: "Write",
        input: { file_path: "/output.txt" },
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.toolUse).toHaveLength(2);
      expect(messages![0]!.toolUse![0]!.toolUseId).toBe("tool-1");
      expect(messages![0]!.toolUse![1]!.toolUseId).toBe("tool-2");
    });

    it("重複的 toolUseId 不應新增", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "",
        isPartial: true,
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.toolUse).toHaveLength(1);
    });

    it("addToolUseToMessage 不應設定 expectingNewBlock", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      const updatedMessages = chatStore.messagesByPodId.get("pod-1");
      expect(updatedMessages![0]).not.toHaveProperty("expectingNewBlock");
    });

    it("addToolUseToMessage 應 flush 當前 SubMessage 並建立帶 tool 的新 SubMessage", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        input: { file_path: "/test.ts" },
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(2);
      expect(subMessages[0]!.isPartial).toBe(false);
      expect(subMessages[1]!.toolUse).toHaveLength(1);
      expect(subMessages[1]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        toolName: "Read",
        status: "running",
      });
    });

    it("連續 tool_use 應 append 到同一個 SubMessage 而非建立新的", () => {
      const chatStore = useChatStore();

      // Text A → Sub[0] 有內容
      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Text A",
        isPartial: true,
      });

      // Tool1 → flush Sub[0]，建立 Sub[1] = {content: '', toolUse: [Tool1]}
      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      // Tool2 → Sub[1] content 還是空的，應 append 而非 flush + 建新
      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-2",
        toolName: "Read",
        input: { file_path: "/test.ts" },
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(2);
      expect(subMessages[1]!.toolUse).toHaveLength(2);
      expect(subMessages[1]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
      });
      expect(subMessages[1]!.toolUse![1]).toMatchObject({
        toolUseId: "tool-2",
      });
    });

    it("tool_use 後有文字的 SubMessage 再收到 tool_use 應 flush + 建新", () => {
      const chatStore = useChatStore();

      // Text A → Sub[0] 有內容
      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Text A",
        isPartial: true,
      });

      // Tool1 → flush Sub[0]，建立 Sub[1] = {content: '', toolUse: [Tool1]}
      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      // Text B → Sub[1] 有了內容
      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: " Text B",
        isPartial: true,
      });

      // Tool2 → Sub[1] 有內容，應 flush + 建新 Sub[2]
      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-2",
        toolName: "Read",
        input: { file_path: "/test.ts" },
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages).toHaveLength(3);
      expect(subMessages[1]!.toolUse).toHaveLength(1);
      expect(subMessages[1]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
      });
      expect(subMessages[2]!.toolUse).toHaveLength(1);
      expect(subMessages[2]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-2",
      });
    });
  });

  describe("handleChatToolResult", () => {
    it("應更新 toolUse 的 output 和 status", () => {
      const chatStore = useChatStore();

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      const payload: PodChatToolResultPayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "file1.ts\nfile2.ts",
      };

      chatStore.handleChatToolResult(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        output: "file1.ts\nfile2.ts",
        status: "completed",
      });
    });

    it("訊息不存在時不應做任何事", () => {
      const chatStore = useChatStore();

      const payload: PodChatToolResultPayload = {
        podId: "pod-1",
        messageId: "non-existent",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "output",
      };

      expect(() => chatStore.handleChatToolResult(payload)).not.toThrow();

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toBeUndefined();
    });

    it("toolUseId 不存在時不應做任何事", () => {
      const chatStore = useChatStore();

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      const payload: PodChatToolResultPayload = {
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "non-existent-tool",
        toolName: "Bash",
        output: "output",
      };

      chatStore.handleChatToolResult(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.toolUse![0]!.status).toBe("running");
      expect(messages![0]!.toolUse![0]!.output).toBeUndefined();
    });

    it("應同時更新 subMessage 的 toolUse", () => {
      const chatStore = useChatStore();

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        input: {},
      });

      chatStore.handleChatToolResult({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        output: "File content",
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      const subMessages = messages![0]!.subMessages!;

      expect(subMessages[0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        output: "File content",
        status: "completed",
      });
    });

    it("tool 完成後 subMessage 的 isPartial 應設為 false", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Thinking...",
        isPartial: true,
      });

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        input: {},
      });

      let messages = chatStore.messagesByPodId.get("pod-1");
      // sub-1 has tool-1, isPartial=true
      expect(messages![0]!.subMessages![1]!.isPartial).toBe(true);

      chatStore.handleChatToolResult({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Read",
        output: "output1",
      });

      messages = chatStore.messagesByPodId.get("pod-1");
      // sub-1 all tools completed, isPartial=false
      expect(messages![0]!.subMessages![1]!.isPartial).toBe(false);
    });
  });

  describe("handleChatComplete", () => {
    it("應設定 isPartial 為 false", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Complete",
        isPartial: true,
      });

      const payload: PodChatCompletePayload = {
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Complete message",
      };

      chatStore.handleChatComplete(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.isPartial).toBe(false);
    });

    it("應設定 isTyping 為 false", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Typing...",
        isPartial: true,
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Done",
      });

      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("應清除 currentStreamingMessageId", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Streaming",
        isPartial: true,
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Done",
      });

      expect(chatStore.currentStreamingMessageId).toBeNull();
    });

    it("應清除 accumulatedLengthByMessageId 中的記錄", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      expect(chatStore.accumulatedLengthByMessageId.has("msg-1")).toBe(true);

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Content",
      });

      expect(chatStore.accumulatedLengthByMessageId.has("msg-1")).toBe(false);
    });

    it("應更新 Pod output（assistant 訊息）", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Assistant response",
        isPartial: true,
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Assistant response",
      });

      await vi.waitFor(() => {
        const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
        expect(updatedPod!.output.length).toBeGreaterThan(0);
      });

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output[0]).toBe("Assistant response");
    });

    it("應 finalize 所有 running 的 toolUse 為 completed", () => {
      const chatStore = useChatStore();

      chatStore.handleChatToolUse({
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "",
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.toolUse![0]!.status).toBe("completed");
    });

    it("應 finalize 所有 subMessage 的 isPartial", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Content",
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.subMessages![0]!.isPartial).toBe(false);
    });

    it("訊息不存在時應僅 finalizeStreaming", () => {
      const chatStore = useChatStore();

      chatStore.currentStreamingMessageId = "msg-1";
      chatStore.isTypingByPodId.set("pod-1", true);

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Content",
      });

      expect(chatStore.currentStreamingMessageId).toBeNull();
      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("應清除 expectingNewBlock", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      chatStore.handleChatComplete({
        podId: "pod-1",
        messageId: "msg-1",
        fullContent: "Content",
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]).not.toHaveProperty("expectingNewBlock");
    });
  });

  describe("handleChatAborted", () => {
    it("訊息存在時應完成現有訊息（保留部分內容）", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Partial content",
        isPartial: true,
      });

      const payload: PodChatAbortedPayload = {
        podId: "pod-1",
        messageId: "msg-1",
      };

      chatStore.handleChatAborted(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.content).toBe("Partial content");
      expect(messages![0]!.isPartial).toBe(false);
    });

    it("訊息不存在時應僅 finalizeStreaming", () => {
      const chatStore = useChatStore();

      chatStore.currentStreamingMessageId = "msg-1";
      chatStore.isTypingByPodId.set("pod-1", true);

      chatStore.handleChatAborted({
        podId: "pod-1",
        messageId: "msg-1",
      });

      expect(chatStore.currentStreamingMessageId).toBeNull();
      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("應設定 isTyping 為 false", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      chatStore.handleChatAborted({
        podId: "pod-1",
        messageId: "msg-1",
      });

      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(false);
    });

    it("應清除 accumulatedLengthByMessageId", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Content",
        isPartial: true,
      });

      expect(chatStore.accumulatedLengthByMessageId.has("msg-1")).toBe(true);

      chatStore.handleChatAborted({
        podId: "pod-1",
        messageId: "msg-1",
      });

      expect(chatStore.accumulatedLengthByMessageId.has("msg-1")).toBe(false);
    });
  });

  describe("handleMessagesClearedEvent", () => {
    it("應清除指定 podId 的訊息", async () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Message",
        isPartial: false,
      });

      const payload: PodMessagesClearedPayload = {
        podId: "pod-1",
      };

      await chatStore.handleMessagesClearedEvent(payload);

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toBeUndefined();
    });

    it("應清除 Pod 的 output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: ["line1", "line2"] });
      podStore.pods = [pod];

      const payload: PodMessagesClearedPayload = {
        podId: "pod-1",
      };

      await chatStore.handleMessagesClearedEvent(payload);

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toEqual([]);
    });
  });

  describe("convertPersistedToMessage", () => {
    it("user 訊息應轉換為 Message（無 subMessages）", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "user",
        content: "User message",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result).toMatchObject({
        id: "msg-1",
        role: "user",
        content: "User message",
        timestamp: "2024-01-01T00:00:00Z",
        isPartial: false,
      });
      expect(result.subMessages).toBeUndefined();
    });

    it("system 訊息應保留 metadata 且不建立 subMessages", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-system",
        role: "system",
        content: "Quota exceeded",
        metadata: {
          provider: "codex",
          code: "RATE_LIMIT",
          severity: "error",
          rawContent: "Quota exceeded",
        },
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result).toMatchObject({
        id: "msg-system",
        role: "system",
        content: "Quota exceeded",
        metadata: {
          provider: "codex",
          code: "RATE_LIMIT",
          severity: "error",
        },
        timestamp: "2024-01-01T00:00:00Z",
        isPartial: false,
      });
      expect(result.subMessages).toBeUndefined();
    });

    it("assistant 訊息應轉換為 Message（保留原始 subMessages 結構）", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Assistant message",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-1",
            content: "Sub content",
          },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result).toMatchObject({
        id: "msg-1",
        role: "assistant",
        content: "Assistant message",
        timestamp: "2024-01-01T00:00:00Z",
        isPartial: false,
      });
      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages![0]).toMatchObject({
        id: "sub-1",
        content: "Sub content",
        isPartial: false,
      });
    });

    it("assistant 訊息應轉換 toolUse（集中到第一個 subMessage）", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Message with tool",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-1",
            content: "Content",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: { command: "ls" },
                output: "file1.ts",
                status: "completed",
              },
            ],
          },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages![0]).toMatchObject({
        id: "sub-1",
        content: "Content",
        isPartial: false,
      });
      expect(result.subMessages![0]!.toolUse).toHaveLength(1);
      expect(result.subMessages![0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
        output: "file1.ts",
        status: "completed",
      });
      expect(result.toolUse).toHaveLength(1);
      expect(result.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
        toolName: "Bash",
      });
    });

    it("assistant 無 subMessages 時應建立預設 subMessage", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Content without subMessages",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages![0]).toMatchObject({
        id: "msg-1-sub-0",
        content: "Content without subMessages",
        isPartial: false,
      });
    });

    it("多個 subMessages 應保留各自的 content（不再合併）", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Content1Content2",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-1", content: "Content1" },
          { id: "sub-2", content: "Content2" },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(2);
      expect(result.subMessages![0]!.content).toBe("Content1");
      expect(result.subMessages![1]!.content).toBe("Content2");
    });

    it("各 subMessage 應保留自己的 toolUse（不集中到第一個）", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Hello World",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-0", content: "Hello" },
          {
            id: "sub-1",
            content: " World",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: { command: "ls" },
                output: "file.ts",
                status: "completed" as const,
              },
            ],
          },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(2);
      expect(result.subMessages![0]!.content).toBe("Hello");
      expect(result.subMessages![1]!.content).toBe(" World");

      expect(result.subMessages![0]!.toolUse).toBeUndefined();
      expect(result.subMessages![1]!.toolUse).toHaveLength(1);
      expect(result.subMessages![1]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
      });

      expect(result.toolUse).toHaveLength(1);
    });

    it("多個 subMessages 各有 toolUse 時應各自保留", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "AB",
        timestamp: "2024-01-01",
        subMessages: [
          {
            id: "sub-0",
            content: "A",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                output: "out1",
                status: "completed" as const,
              },
            ],
          },
          {
            id: "sub-1",
            content: "B",
            toolUse: [
              {
                toolUseId: "tool-2",
                toolName: "Read",
                input: {},
                output: "out2",
                status: "completed" as const,
              },
            ],
          },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(2);
      expect(result.subMessages![0]!.toolUse).toHaveLength(1);
      expect(result.subMessages![0]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-1",
      });
      expect(result.subMessages![1]!.toolUse).toHaveLength(1);
      expect(result.subMessages![1]!.toolUse![0]).toMatchObject({
        toolUseId: "tool-2",
      });
      expect(result.toolUse).toHaveLength(2);
    });

    it("subMessages 為空陣列時應建立預設 subMessage", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Hello",
        timestamp: "2024-01-01",
        subMessages: [],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages![0]!.content).toBe("Hello");
    });

    it("status 為空字串時應 fallback 為 completed", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Test",
        timestamp: "2024-01-01",
        subMessages: [
          {
            id: "sub-0",
            content: "Test",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                output: "",
                status: "",
              },
            ],
          },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.subMessages![0]!.toolUse![0]!.status).toBe("completed");
    });

    it("所有 subMessages 都沒有 toolUse 時不應設定頂層 toolUse", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const persistedMessage: PersistedMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Hello World",
        timestamp: "2024-01-01",
        subMessages: [
          { id: "sub-0", content: "Hello" },
          { id: "sub-1", content: " World" },
        ],
      };

      const result = messageActions.convertPersistedToMessage(persistedMessage);

      expect(result.toolUse).toBeUndefined();
    });
  });

  describe("setTyping", () => {
    it("應設定 isTypingByPodId", () => {
      const chatStore = useChatStore();

      chatStore.setTyping("pod-1", true);

      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(true);
    });

    it("應更新 typing 狀態", () => {
      const chatStore = useChatStore();

      chatStore.setTyping("pod-1", true);
      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(true);

      chatStore.setTyping("pod-1", false);
      expect(chatStore.isTypingByPodId.get("pod-1")).toBe(false);
    });
  });

  describe("clearMessagesByPodIds", () => {
    it("應清除多個 podId 的 messages", () => {
      const chatStore = useChatStore();

      chatStore.handleChatMessage({
        podId: "pod-1",
        messageId: "msg-1",
        content: "Message 1",
        isPartial: false,
      });

      chatStore.handleChatMessage({
        podId: "pod-2",
        messageId: "msg-2",
        content: "Message 2",
        isPartial: false,
      });

      chatStore.handleChatMessage({
        podId: "pod-3",
        messageId: "msg-3",
        content: "Message 3",
        isPartial: false,
      });

      chatStore.clearMessagesByPodIds(["pod-1", "pod-2"]);

      expect(chatStore.messagesByPodId.get("pod-1")).toBeUndefined();
      expect(chatStore.messagesByPodId.get("pod-2")).toBeUndefined();
      expect(chatStore.messagesByPodId.get("pod-3")).toHaveLength(1);
    });

    it("應清除多個 podId 的 typing", () => {
      const chatStore = useChatStore();

      chatStore.setTyping("pod-1", true);
      chatStore.setTyping("pod-2", true);
      chatStore.setTyping("pod-3", true);

      chatStore.clearMessagesByPodIds(["pod-1", "pod-2"]);

      expect(chatStore.isTypingByPodId.get("pod-1")).toBeUndefined();
      expect(chatStore.isTypingByPodId.get("pod-2")).toBeUndefined();
      expect(chatStore.isTypingByPodId.get("pod-3")).toBe(true);
    });
  });

  describe("updatePodOutput 整合測試", () => {
    it("應從多個 subMessages 中提取 output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      const messages: Message[] = [
        {
          id: "msg-1",
          role: "user",
          content: "User question",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Block1Block2",
          isPartial: false,
          timestamp: new Date().toISOString(),
          subMessages: [
            {
              id: "msg-2-sub-0",
              content: "Block1",
              isPartial: false,
            },
            {
              id: "msg-2-sub-1",
              content: "Block2",
              isPartial: false,
            },
          ],
        },
      ];

      chatStore.messagesByPodId.set("pod-1", messages);
      const messageActions = chatStore.getMessageActions();
      await messageActions.updatePodOutput("pod-1");

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(3);
      expect(updatedPod!.output[0]).toBe("> User question");
      expect(updatedPod!.output[1]).toBe("Block1");
      expect(updatedPod!.output[2]).toBe("Block2");
    });

    it("應截斷超長的 response content（40 字元）", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      const longContent = "a".repeat(60);
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: longContent,
          isPartial: false,
          timestamp: new Date().toISOString(),
          subMessages: [
            {
              id: "msg-1-sub-0",
              content: longContent,
              isPartial: false,
            },
          ],
        },
      ];

      chatStore.messagesByPodId.set("pod-1", messages);
      const messageActions = chatStore.getMessageActions();
      await messageActions.updatePodOutput("pod-1");

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output[0]).toBe(
        `${"a".repeat(RESPONSE_PREVIEW_LENGTH)}...`,
      );
    });

    it("空 subMessage content 不應加入 output", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Content",
          isPartial: false,
          timestamp: new Date().toISOString(),
          subMessages: [
            {
              id: "msg-1-sub-0",
              content: "",
              isPartial: false,
            },
            {
              id: "msg-1-sub-1",
              content: "Valid content",
              isPartial: false,
            },
          ],
        },
      ];

      chatStore.messagesByPodId.set("pod-1", messages);
      const messageActions = chatStore.getMessageActions();
      await messageActions.updatePodOutput("pod-1");

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(1);
      expect(updatedPod!.output[0]).toBe("Valid content");
    });
  });

  describe("createAssistantMessageShape", () => {
    it("應回傳包含 subMessages 的 Message（不含 expectingNewBlock）", () => {
      const shape = createAssistantMessageShape(
        "msg-1",
        "content",
        true,
        "delta",
      );

      expect(shape.subMessages).toHaveLength(1);
      expect(shape.subMessages![0]).toMatchObject({
        id: "msg-1-sub-0",
        content: "delta",
        isPartial: true,
      });
      expect(shape).not.toHaveProperty("expectingNewBlock");
    });

    it("delta 為空時應以 content 作為 subMessage 內容", () => {
      const shape = createAssistantMessageShape("msg-1", "my content", false);

      expect(shape.subMessages![0]!.content).toBe("my content");
    });
  });

  describe("addNewChatMessage - 角色分支", () => {
    it("assistant 訊息應使用 createAssistantMessageShape 建構（不含 expectingNewBlock）", async () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      await messageActions.addNewChatMessage(
        "pod-1",
        "msg-1",
        "Hello",
        true,
        "assistant",
        "Hello",
      );

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.subMessages).toHaveLength(1);
      expect(messages![0]).not.toHaveProperty("expectingNewBlock");
    });

    it("user 訊息應不含 subMessages 和 expectingNewBlock", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-1", output: [] })];
      const messageActions = chatStore.getMessageActions();

      await messageActions.addNewChatMessage(
        "pod-1",
        "msg-1",
        "Hello",
        false,
        "user",
      );

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.subMessages).toBeUndefined();
      expect(messages![0]).not.toHaveProperty("expectingNewBlock");
    });

    it("user 訊息應呼叫 appendUserOutputToPod", async () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      podStore.pods = [createMockPod({ id: "pod-1", output: [] })];
      const messageActions = chatStore.getMessageActions();

      await messageActions.addNewChatMessage(
        "pod-1",
        "msg-1",
        "User input",
        false,
        "user",
      );

      const updatedPod = podStore.pods.find((p) => p.id === "pod-1");
      expect(updatedPod!.output).toHaveLength(1);
      expect(updatedPod!.output[0]).toMatch(/^> User input/);
    });
  });

  describe("updateExistingChatMessage - 角色分支", () => {
    it("assistant 角色應呼叫 updateAssistantSubMessages", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Hello",
          isPartial: true,
          timestamp: new Date().toISOString(),
          subMessages: [
            { id: "msg-1-sub-0", content: "Hello", isPartial: true },
          ],
        },
      ];
      chatStore.messagesByPodId.set("pod-1", messages);

      messageActions.updateExistingChatMessage(
        "pod-1",
        messages,
        0,
        "Hello World",
        true,
        " World",
      );

      const updated = chatStore.messagesByPodId.get("pod-1");
      expect(updated![0]!.subMessages).toBeDefined();
    });

    it("user 角色不應更新 subMessages", () => {
      const chatStore = useChatStore();
      const messageActions = chatStore.getMessageActions();

      const messages: Message[] = [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          isPartial: false,
          timestamp: new Date().toISOString(),
        },
      ];
      chatStore.messagesByPodId.set("pod-1", messages);

      messageActions.updateExistingChatMessage(
        "pod-1",
        messages,
        0,
        "Hello World",
        false,
        " World",
      );

      const updated = chatStore.messagesByPodId.get("pod-1");
      expect(updated![0]!.subMessages).toBeUndefined();
    });
  });

  describe("addRemoteUserMessage", () => {
    it("遠端使用者訊息應被加入 messagesByPodId", () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      chatStore.addRemoteUserMessage(
        "pod-1",
        "remote-msg-1",
        "Hello from remote",
        "2024-01-01T00:00:00Z",
      );

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages![0]).toMatchObject({
        role: "user",
        content: "Hello from remote",
      });
    });

    it("應使用傳入的 messageId 和 timestamp", () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      chatStore.addRemoteUserMessage(
        "pod-1",
        "specific-id",
        "Content",
        "2024-06-15T12:00:00Z",
      );

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages![0]!.id).toBe("specific-id");
      expect(messages![0]!.timestamp).toBe("2024-06-15T12:00:00Z");
    });

    it("Pod 不存在時應不崩潰", () => {
      const chatStore = useChatStore();

      expect(() => {
        chatStore.addRemoteUserMessage(
          "non-existent",
          "msg-1",
          "Hello",
          "2024-01-01T00:00:00Z",
        );
      }).not.toThrow();

      expect(chatStore.messagesByPodId.has("non-existent")).toBe(false);
    });
  });
});
