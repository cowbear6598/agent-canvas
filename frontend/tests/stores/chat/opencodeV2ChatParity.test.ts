/**
 * P2.A.t2: chat store regression — opencode v2 事件序列驅動訊息更新
 *
 * 驗證 assistant 回覆在 text → tool → text 穿插場景下，
 * 訊息會被拆成多個 sub-message 而不是單一巨大 bubble。
 */

import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

describe("opencode v2 chat parity regression", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
  });

  describe("F1: 單一工具協助回覆", () => {
    it("text → tool → complete：assistant 訊息應拆成 2 個 sub-message（text + tool）", () => {
      const store = useChatStore();
      const podId = "pod-opencode";
      const msgId = "msg-001";

      // Step 1: 開始回覆，送出第一段文字
      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "我來幫你查看檔案",
        isPartial: true,
      });

      // Step 2: 觸發工具使用，flush 第一段文字，建立新 sub-message
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-read",
        toolName: "read_file",
        input: { path: "src/index.ts" },
      });

      // Step 3: 工具結果回傳
      store.handleChatToolResult({
        podId,
        messageId: msgId,
        toolUseId: "tool-read",
        toolName: "read_file",
        output: "const x = 1;",
      });

      // Step 4: 完成
      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "我來幫你查看檔案",
      });

      const messages = store.messagesByPodId.get(podId)!;
      expect(messages).toHaveLength(1);

      const msg = messages[0]!;
      // 應有兩個 sub-message，而非一個巨大 bubble
      expect(msg.subMessages).toHaveLength(2);

      // sub-0: 第一段文字
      expect(msg.subMessages![0]!.content).toBe("我來幫你查看檔案");
      expect(msg.subMessages![0]!.isPartial).toBe(false);

      // sub-1: 工具步驟
      expect(msg.subMessages![1]!.content).toBe("");
      expect(msg.subMessages![1]!.toolUse).toHaveLength(1);
      expect(msg.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-read");
      expect(msg.subMessages![1]!.toolUse![0]!.status).toBe("completed");
      expect(msg.subMessages![1]!.isPartial).toBe(false);
    });
  });

  describe("F2: 多段文字穿插多次工具操作", () => {
    it("text → tool1 → text → tool2 → complete：各 segment 應保持可辨識且不合併", () => {
      const store = useChatStore();
      const podId = "pod-opencode";
      const msgId = "msg-002";

      // 第一段說明文字
      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "首先分析問題",
        isPartial: true,
      });

      // 第一個工具：flush 第一段，建立 sub-1
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-bash-1",
        toolName: "bash",
        input: { command: "ls src/" },
      });

      store.handleChatToolResult({
        podId,
        messageId: msgId,
        toolUseId: "tool-bash-1",
        toolName: "bash",
        output: "index.ts\nstore.ts",
      });

      // 第二段說明文字：delta 應累加到 sub-1
      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "首先分析問題然後修改",
        isPartial: true,
      });

      // 第二個工具：flush sub-1（現在有文字了），建立 sub-2
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-edit",
        toolName: "edit_file",
        input: { path: "index.ts" },
      });

      store.handleChatToolResult({
        podId,
        messageId: msgId,
        toolUseId: "tool-edit",
        toolName: "edit_file",
        output: "已修改",
      });

      // 完成
      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "首先分析問題然後修改",
      });

      const messages = store.messagesByPodId.get(podId)!;
      const msg = messages[0]!;

      // 應有 3 個 sub-message：text → tool1 → text+tool2（或更多）
      // 關鍵：不應只有 1 個巨大 bubble
      expect(msg.subMessages!.length).toBeGreaterThanOrEqual(2);

      // 工具記錄應可辨識
      const allToolUseIds = msg
        .subMessages!.flatMap((s) => s.toolUse ?? [])
        .map((t) => t.toolUseId);

      expect(allToolUseIds).toContain("tool-bash-1");
      expect(allToolUseIds).toContain("tool-edit");
    });

    it("連續多個工具在同一個空 sub-message 中：全部 append 到同一個 sub-message", () => {
      const store = useChatStore();
      const podId = "pod-opencode";
      const msgId = "msg-003";

      // 第一段文字
      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "執行多個指令",
        isPartial: true,
      });

      // tool-1：flush sub-0，建立 sub-1（content 為空）
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-1",
        toolName: "bash",
        input: { command: "pwd" },
      });

      // tool-2：sub-1 還是空的，append 到 sub-1
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-2",
        toolName: "bash",
        input: { command: "ls" },
      });

      // tool-3：sub-1 還是空的，append 到 sub-1
      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-3",
        toolName: "bash",
        input: { command: "cat file.ts" },
      });

      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "執行多個指令",
      });

      const messages = store.messagesByPodId.get(podId)!;
      const msg = messages[0]!;

      // sub-0: 文字；sub-1: 三個工具（全部 append，不應分裂）
      expect(msg.subMessages).toHaveLength(2);
      expect(msg.subMessages![0]!.content).toBe("執行多個指令");
      expect(msg.subMessages![1]!.toolUse).toHaveLength(3);

      const toolIds = msg.subMessages![1]!.toolUse!.map((t) => t.toolUseId);
      expect(toolIds).toContain("tool-1");
      expect(toolIds).toContain("tool-2");
      expect(toolIds).toContain("tool-3");
    });
  });

  describe("F4: 歷史載入 (convertPersistedToMessage) 分段一致性", () => {
    it("text → tool → text 的 persiisted 訊息應保留 3 個獨立 sub-message（夾在中間的 tool 不合併）", () => {
      const store = useChatStore();
      const actions = store.getMessageActions();

      const persistedMsg = {
        id: "msg-hist-001",
        role: "assistant" as const,
        content: "說明A工具說明B",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-0",
            content: "說明A",
          },
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-mid",
                toolName: "bash",
                input: {},
                output: "result",
                status: "completed",
              },
            ],
          },
          {
            id: "sub-2",
            content: "說明B",
          },
        ],
      };

      const result = actions.convertPersistedToMessage(persistedMsg);

      // 夾在兩段文字之間的 tool sub-message 應保留為獨立 segment
      expect(result.subMessages).toHaveLength(3);
      expect(result.subMessages![0]!.content).toBe("說明A");
      expect(result.subMessages![1]!.content).toBe("");
      expect(result.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-mid");
      expect(result.subMessages![2]!.content).toBe("說明B");
    });

    it("trailing tool-only sub-message：歷史載入後應保留為獨立 segment（v2 對齊 Claude / Codex）", () => {
      const store = useChatStore();
      const actions = store.getMessageActions();

      const persistedMsg = {
        id: "msg-hist-002",
        role: "assistant" as const,
        content: "執行完成",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-0",
            content: "執行完成",
          },
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-trail",
                toolName: "bash",
                input: {},
                output: "done",
                status: "completed",
              },
            ],
          },
        ],
      };

      const result = actions.convertPersistedToMessage(persistedMsg);

      // v2：trailing tool-only sub-message 保留為獨立 segment，工具步驟與文字分開顯示
      expect(result.subMessages).toHaveLength(2);
      expect(result.subMessages![0]!.content).toBe("執行完成");
      expect(result.subMessages![0]!.toolUse).toBeUndefined();
      expect(result.subMessages![1]!.content).toBe("");
      expect(result.subMessages![1]!.toolUse).toHaveLength(1);
      expect(result.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-trail");
    });

    it("完成後分段結果應與串流結束時的 finalizeSubMessages 結果一致", () => {
      const store = useChatStore();
      const podId = "pod-parity";
      const msgId = "msg-parity";

      // 模擬 live 串流
      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "初步說明",
        isPartial: true,
      });

      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-live",
        toolName: "bash",
        input: {},
      });

      store.handleChatToolResult({
        podId,
        messageId: msgId,
        toolUseId: "tool-live",
        toolName: "bash",
        output: "執行結果",
      });

      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "初步說明",
      });

      const liveMsg = store.messagesByPodId.get(podId)![0]!;
      const liveSubMessages = liveMsg.subMessages!;

      // 模擬 history rehydrate
      const actions = store.getMessageActions();
      const persistedMsg = {
        id: msgId,
        role: "assistant" as const,
        content: "初步說明",
        timestamp: new Date().toISOString(),
        subMessages: liveSubMessages.map((sub) => ({
          id: sub.id,
          content: sub.content,
          toolUse: sub.toolUse?.map((t) => ({
            toolUseId: t.toolUseId,
            toolName: t.toolName,
            input: t.input,
            output: t.output as string | undefined,
            status: t.status,
          })),
        })),
      };

      const rehydrated = actions.convertPersistedToMessage(persistedMsg);

      // 分段數量應一致
      expect(rehydrated.subMessages!.length).toBe(liveSubMessages.length);

      // 各 sub-message 的 content 與 toolUse 數量應一致
      for (let i = 0; i < liveSubMessages.length; i++) {
        expect(rehydrated.subMessages![i]!.content).toBe(
          liveSubMessages[i]!.content,
        );
        const liveToolCount = liveSubMessages[i]!.toolUse?.length ?? 0;
        const rehydratedToolCount =
          rehydrated.subMessages![i]!.toolUse?.length ?? 0;
        expect(rehydratedToolCount).toBe(liveToolCount);
      }
    });
  });

  describe("complete 後 sub-message 結構驗證", () => {
    it("handleChatComplete 後所有 sub-message 的 isPartial 應為 false", () => {
      const store = useChatStore();
      const podId = "pod-complete-check";
      const msgId = "msg-complete";

      store.handleChatMessage({
        podId,
        messageId: msgId,
        content: "部分內容",
        isPartial: true,
      });

      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-x",
        toolName: "read",
        input: {},
      });

      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "部分內容",
      });

      const msg = store.messagesByPodId.get(podId)![0]!;
      expect(msg.isPartial).toBe(false);

      for (const sub of msg.subMessages!) {
        expect(sub.isPartial).toBe(false);
      }
    });

    it("handleChatComplete 後所有 running tool 應標記為 completed", () => {
      const store = useChatStore();
      const podId = "pod-tool-finalize";
      const msgId = "msg-tool-finalize";

      store.handleChatToolUse({
        podId,
        messageId: msgId,
        toolUseId: "tool-running",
        toolName: "bash",
        input: {},
      });

      // 未收到 tool result，直接 complete（邊界情況）
      store.handleChatComplete({
        podId,
        messageId: msgId,
        fullContent: "",
      });

      const msg = store.messagesByPodId.get(podId)![0]!;
      const allTools = msg.subMessages!.flatMap((s) => s.toolUse ?? []);
      expect(allTools.every((t) => t.status !== "running")).toBe(true);
    });
  });
});
