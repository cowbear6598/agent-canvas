/**
 * P2.A.t3: run store regression — run modal 載入中的訊息與完成後的 transcript
 *
 * 驗證 run rehydrate 路徑與 live 串流路徑採用相同分段規則，
 * chat 與 run 顯示結果應一致，不出現單一巨大 bubble。
 */

import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "@tests/helpers/mockWebSocket";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useRunStore } from "@/stores/run/runStore";
import { convertSubMessages } from "@/stores/run/runStoreHelpers";
import type { PersistedMessage } from "@/types/websocket/responses";
import type { Message } from "@/types/chat";

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

// Mock useCanvasWebSocketAction
vi.mock("@/composables/useCanvasWebSocketAction", () => ({
  useCanvasWebSocketAction: () => ({
    executeAction: vi.fn().mockResolvedValue({ success: false }),
  }),
}));

/** 測試輔助：取得 runChatMessages 中指定 runId/podId 的訊息陣列 */
function getPodMessages(
  store: ReturnType<typeof useRunStore>,
  runId: string,
  podId: string,
): Message[] | undefined {
  return store.runChatMessages
    .get(runId)
    ?.get(podId)
    ?.filter((item): item is Message => !("type" in item));
}

describe("opencode v2 run store parity regression", () => {
  setupStoreTest();

  describe("F3: run transcript 分段 — convertSubMessages", () => {
    it("text → tool → text：夾在中間的 tool sub-message 應保留為獨立 segment", () => {
      const pm: PersistedMessage = {
        id: "msg-run-001",
        role: "assistant",
        content: "說明A工具說明B",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-0", content: "說明A" },
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
          { id: "sub-2", content: "說明B" },
        ],
      };

      const result = convertSubMessages(pm);

      // 夾在兩段文字之間的 tool sub-message 不應被合併
      expect(result.subMessages).toHaveLength(3);
      expect(result.subMessages![0]!.content).toBe("說明A");
      expect(result.subMessages![1]!.content).toBe("");
      expect(result.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-mid");
      expect(result.subMessages![2]!.content).toBe("說明B");
    });

    it("trailing tool-only sub-message：應保留為獨立 segment（v2 對齊）", () => {
      const pm: PersistedMessage = {
        id: "msg-run-002",
        role: "assistant",
        content: "執行完成",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-0", content: "執行完成" },
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

      const result = convertSubMessages(pm);

      // v2：trailing tool sub-message 保留為獨立 segment，工具步驟與文字分開顯示
      expect(result.subMessages).toHaveLength(2);
      expect(result.subMessages![0]!.content).toBe("執行完成");
      expect(result.subMessages![0]!.toolUse).toBeUndefined();
      expect(result.subMessages![1]!.content).toBe("");
      expect(result.subMessages![1]!.toolUse).toHaveLength(1);
      expect(result.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-trail");
    });

    it("連續多個 trailing tool sub-message：每個都保留為獨立 segment（v2 對齊）", () => {
      const pm: PersistedMessage = {
        id: "msg-run-003",
        role: "assistant",
        content: "分析結果",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-0", content: "分析結果" },
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "bash",
                input: {},
                output: "out1",
                status: "completed",
              },
            ],
          },
          {
            id: "sub-2",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-2",
                toolName: "read_file",
                input: {},
                output: "out2",
                status: "completed",
              },
            ],
          },
        ],
      };

      const result = convertSubMessages(pm);

      // v2：每個 trailing tool segment 都保留為獨立 sub-message
      expect(result.subMessages).toHaveLength(3);
      expect(result.subMessages![0]!.content).toBe("分析結果");
      expect(result.subMessages![1]!.toolUse![0]!.toolUseId).toBe("tool-1");
      expect(result.subMessages![2]!.toolUse![0]!.toolUseId).toBe("tool-2");
    });

    it("無 subMessages 時應建立預設 sub-message 以 content 為內容", () => {
      const pm: PersistedMessage = {
        id: "msg-run-004",
        role: "assistant",
        content: "純文字回覆",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = convertSubMessages(pm);

      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages![0]!.content).toBe("純文字回覆");
      expect(result.subMessages![0]!.id).toBe("msg-run-004-sub-0");
    });

    it("running 狀態的 tool 在 rehydrate 後應標記為 completed", () => {
      const pm: PersistedMessage = {
        id: "msg-run-005",
        role: "assistant",
        content: "執行中",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-0",
            content: "執行中",
            toolUse: [
              {
                toolUseId: "tool-running",
                toolName: "bash",
                input: {},
                status: "running",
              },
            ],
          },
        ],
      };

      const result = convertSubMessages(pm);

      const tool = result.subMessages![0]!.toolUse![0]!;
      expect(tool.status).toBe("completed");
    });

    it("toolUse 應收集到頂層 toolUse 欄位（供舊版呼叫端使用）", () => {
      const pm: PersistedMessage = {
        id: "msg-run-006",
        role: "assistant",
        content: "多工具",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          {
            id: "sub-0",
            content: "說明",
            toolUse: [
              {
                toolUseId: "tool-A",
                toolName: "bash",
                input: {},
                output: "resultA",
                status: "completed",
              },
            ],
          },
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-B",
                toolName: "read",
                input: {},
                output: "resultB",
                status: "completed",
              },
            ],
          },
        ],
      };

      const result = convertSubMessages(pm);

      // 頂層 toolUse 應包含所有 sub-message 的工具
      expect(result.toolUse).toBeDefined();
      const ids = result.toolUse!.map((t) => t.toolUseId);
      expect(ids).toContain("tool-A");
      expect(ids).toContain("tool-B");
    });
  });

  describe("F3: run transcript 分段 — live 串流路徑 (appendRunChatMessage + handleRunChatToolUse)", () => {
    it("text → tool → complete：live 串流後 run 訊息應拆成 2 個 sub-message", () => {
      const store = useRunStore();
      const runId = "run-live";
      const podId = "pod-live";
      const msgId = "msg-live";

      // Step 1: 文字開始串流
      store.appendRunChatMessage(
        runId,
        podId,
        msgId,
        "查看檔案",
        true,
        "assistant",
      );

      // Step 2: 工具使用
      store.handleRunChatToolUse({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-live-read",
        toolName: "read_file",
        input: { path: "index.ts" },
      });

      // Step 3: 工具結果
      store.handleRunChatToolResult({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-live-read",
        toolName: "read_file",
        output: "const a = 1;",
      });

      // Step 4: 完成
      store.handleRunChatComplete(runId, podId, msgId, "查看檔案");

      const messages = getPodMessages(store, runId, podId)!;
      expect(messages).toHaveLength(1);

      const msg = messages[0]!;
      // 應有兩個 sub-message，不是單一巨大 bubble
      expect(msg.subMessages).toHaveLength(2);

      expect(msg.subMessages![0]!.content).toBe("查看檔案");
      expect(msg.subMessages![0]!.isPartial).toBe(false);

      expect(msg.subMessages![1]!.content).toBe("");
      expect(msg.subMessages![1]!.toolUse).toHaveLength(1);
      expect(msg.subMessages![1]!.toolUse![0]!.toolUseId).toBe(
        "tool-live-read",
      );
      expect(msg.subMessages![1]!.toolUse![0]!.status).toBe("completed");
    });

    it("handleRunChatComplete 後所有 sub-message 的 isPartial 應為 false", () => {
      const store = useRunStore();
      const runId = "run-finalize";
      const podId = "pod-finalize";
      const msgId = "msg-finalize";

      store.appendRunChatMessage(
        runId,
        podId,
        msgId,
        "部分內容",
        true,
        "assistant",
      );

      store.handleRunChatToolUse({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-partial",
        toolName: "bash",
        input: {},
      });

      store.handleRunChatComplete(runId, podId, msgId, "部分內容");

      const msg = getPodMessages(store, runId, podId)![0]!;
      expect(msg.isPartial).toBe(false);
      for (const sub of msg.subMessages!) {
        expect(sub.isPartial).toBe(false);
      }
    });

    it("多次工具使用後 complete：所有 running tool 應標記為 completed", () => {
      const store = useRunStore();
      const runId = "run-multi-tool";
      const podId = "pod-multi-tool";
      const msgId = "msg-multi-tool";

      store.handleRunChatToolUse({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-m1",
        toolName: "bash",
        input: {},
      });

      store.handleRunChatToolUse({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-m2",
        toolName: "read",
        input: {},
      });

      // tool-m1 有結果，tool-m2 沒有 → complete 時兩個都應為 completed
      store.handleRunChatToolResult({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-m1",
        toolName: "bash",
        output: "out1",
      });

      store.handleRunChatComplete(runId, podId, msgId, "");

      const msg = getPodMessages(store, runId, podId)![0]!;
      const allTools = msg.subMessages!.flatMap((s) => s.toolUse ?? []);
      expect(allTools.every((t) => t.status !== "running")).toBe(true);
    });
  });

  describe("F3 & F4: chat / run 分段一致性", () => {
    it("live 串流結束的分段應與 rehydrate 後分段相同", () => {
      const store = useRunStore();
      const runId = "run-parity";
      const podId = "pod-parity";
      const msgId = "msg-parity";

      // 模擬 live run 串流
      store.appendRunChatMessage(
        runId,
        podId,
        msgId,
        "初步說明",
        true,
        "assistant",
      );

      store.handleRunChatToolUse({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-parity",
        toolName: "bash",
        input: { command: "ls" },
      });

      store.handleRunChatToolResult({
        runId,
        podId,
        messageId: msgId,
        toolUseId: "tool-parity",
        toolName: "bash",
        output: "result",
      });

      store.handleRunChatComplete(runId, podId, msgId, "初步說明");

      const liveMsg = getPodMessages(store, runId, podId)![0]!;
      const liveSubMessages = liveMsg.subMessages!;

      // 用 live 串流的結果模擬 PersistedMessage（rehydrate 場景）
      const pm: PersistedMessage = {
        id: msgId,
        role: "assistant",
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

      const rehydrated = convertSubMessages(pm);

      // 分段數量應一致
      expect(rehydrated.subMessages!.length).toBe(liveSubMessages.length);

      // 各 sub-message 的 content 與 toolUse 數量應一致
      for (let i = 0; i < liveSubMessages.length; i++) {
        expect(rehydrated.subMessages![i]!.content).toBe(
          liveSubMessages[i]!.content,
        );
        const liveCnt = liveSubMessages[i]!.toolUse?.length ?? 0;
        const rehydCnt = rehydrated.subMessages![i]!.toolUse?.length ?? 0;
        expect(rehydCnt).toBe(liveCnt);
      }
    });

    it("text → tool → text 的 persistent 訊息不應只有一個 bubble（不能合併全部）", () => {
      const pm: PersistedMessage = {
        id: "msg-no-single-bubble",
        role: "assistant",
        content: "說明1工具說明2",
        timestamp: "2024-01-01T00:00:00Z",
        subMessages: [
          { id: "sub-0", content: "說明1" },
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-between",
                toolName: "bash",
                input: {},
                output: "out",
                status: "completed",
              },
            ],
          },
          { id: "sub-2", content: "說明2" },
        ],
      };

      const result = convertSubMessages(pm);

      // 關鍵 regression guard：不應被合併為 1 個 bubble
      expect(result.subMessages!.length).toBeGreaterThan(1);
      // 兩段文字都應存在
      const contents = result.subMessages!.map((s) => s.content);
      expect(contents).toContain("說明1");
      expect(contents).toContain("說明2");
    });
  });
});
