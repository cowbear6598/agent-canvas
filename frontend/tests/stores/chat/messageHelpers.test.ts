import { describe, it, expect } from "vitest";
import {
  buildRunPodCacheKey,
  buildSubMessageId,
  applyToolResultToMessage,
  mergeToolUseIntoMessage,
  upsertMessage,
} from "@/stores/chat/messageHelpers";
import {
  appendToolToLastSubMessage,
  flushAndCreateNewSubMessage,
} from "@/stores/chat/subMessageHelpers";
import type { Message, SubMessage, ToolUseInfo } from "@/types/chat";

/**
 * 可變版本的 applyToolUseToMessage，僅供測試使用。
 * 直接 mutate message.subMessages，與生產程式碼的不可變風格不同。
 */
function applyToolUseToMessage(
  message: Message,
  payload: {
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
): void {
  const toolUseInfo: ToolUseInfo = {
    toolUseId: payload.toolUseId,
    toolName: payload.toolName,
    input: payload.input,
    status: "running",
  };

  const subMessages = message.subMessages;

  // 尚無 subMessages 時，建立初始 subMessages
  if (!subMessages || subMessages.length === 0) {
    const newSubMessages: SubMessage[] = [];

    // 若主訊息已有文字內容，先保留到第一個 subMessage，避免切換到 subMessages 渲染後文字消失
    if (message.content.trim() !== "") {
      newSubMessages.push({
        id: `${message.id}-sub-0`,
        content: message.content,
        isPartial: false,
      });
    }

    newSubMessages.push({
      id: payload.toolUseId,
      content: "",
      toolUse: [toolUseInfo],
    });

    message.subMessages = newSubMessages;
    return;
  }

  const lastSub = subMessages[subMessages.length - 1];

  if (lastSub && lastSub.content.trim() === "") {
    // 最後一個 subMessage content 為空，合併到同一個
    message.subMessages = appendToolToLastSubMessage(subMessages, toolUseInfo);
  } else {
    // 最後一個 subMessage 有 content，建立新的 subMessage
    message.subMessages = flushAndCreateNewSubMessage(
      subMessages,
      message.id,
      toolUseInfo,
    );
  }
}

describe("messageHelpers", () => {
  describe("buildRunPodCacheKey", () => {
    it("應回傳 runId:podId 格式", () => {
      expect(buildRunPodCacheKey("run-1", "pod-1")).toBe("run-1:pod-1");
    });

    it("應支援任意字串", () => {
      expect(buildRunPodCacheKey("abc", "xyz")).toBe("abc:xyz");
    });
  });

  describe("buildSubMessageId", () => {
    it("有 toolUseId 時應回傳 parentId-toolUseId", () => {
      expect(buildSubMessageId("msg-1", "tool-abc")).toBe("msg-1-tool-abc");
    });

    it("toolUseId 為 undefined 時應使用 no-tool 作為 fallback", () => {
      expect(buildSubMessageId("msg-1", undefined)).toBe("msg-1-no-tool");
    });
  });

  describe("applyToolUseToMessage", () => {
    it("message content 為空時應只建立工具 subMessage", () => {
      const message: Message = { id: "msg-1", role: "assistant", content: "" };

      applyToolUseToMessage(message, {
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      expect(message.subMessages).toHaveLength(1);
      expect(message.subMessages?.[0]?.toolUse?.[0]?.toolName).toBe("Bash");
      expect(message.subMessages?.[0]?.toolUse?.[0]?.status).toBe("running");
    });

    it("message 有 content 且首次 tool use 時，應先建立文字 subMessage 再建立工具 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "我來幫你查一下",
      };

      applyToolUseToMessage(message, {
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      expect(message.subMessages).toHaveLength(2);
      // 第一個 subMessage 保留原始文字
      expect(message.subMessages?.[0]?.content).toBe("我來幫你查一下");
      expect(message.subMessages?.[0]?.toolUse).toBeUndefined();
      expect(message.subMessages?.[0]?.isPartial).toBe(false);
      // 第二個 subMessage 是工具
      expect(message.subMessages?.[1]?.content).toBe("");
      expect(message.subMessages?.[1]?.toolUse?.[0]?.toolName).toBe("Bash");
    });

    it("已有 subMessages 且最後一個 content 不為空時，應建立新的 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [{ id: "existing", content: "有內容的 subMessage" }],
      };

      applyToolUseToMessage(message, {
        toolUseId: "tool-2",
        toolName: "Read",
        input: { path: "/tmp" },
      });

      expect(message.subMessages).toHaveLength(2);
      expect(message.subMessages?.[1]?.toolUse?.[0]?.toolName).toBe("Read");
    });

    it("新加入的 toolUse input 應與 payload 相同", () => {
      const message: Message = { id: "msg-1", role: "assistant", content: "" };
      const input = { command: "echo hello" };

      applyToolUseToMessage(message, {
        toolUseId: "tool-1",
        toolName: "Bash",
        input,
      });

      expect(message.subMessages?.[0]?.toolUse?.[0]?.input).toEqual(input);
    });

    it("連續 tool use 且前一個 subMessage content 為空時，應合併到同一個 subMessage", () => {
      const message: Message = { id: "msg-1", role: "assistant", content: "" };

      applyToolUseToMessage(message, {
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      applyToolUseToMessage(message, {
        toolUseId: "tool-2",
        toolName: "Read",
        input: { path: "/tmp" },
      });

      expect(message.subMessages).toHaveLength(1);
      expect(message.subMessages?.[0]?.toolUse).toHaveLength(2);
      expect(message.subMessages?.[0]?.toolUse?.[0]?.toolName).toBe("Bash");
      expect(message.subMessages?.[0]?.toolUse?.[1]?.toolName).toBe("Read");
    });

    it("最後一個 subMessage content 為純空白字元時，應合併到同一個 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "  ",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                status: "running",
              },
            ],
          },
        ],
      };

      applyToolUseToMessage(message, {
        toolUseId: "tool-2",
        toolName: "Read",
        input: { path: "/tmp" },
      });

      expect(message.subMessages).toHaveLength(1);
      expect(message.subMessages?.[0]?.toolUse).toHaveLength(2);
    });

    it("前一個 subMessage 有 content 時，應建立新 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "思考中...",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                status: "running",
              },
            ],
          },
        ],
      };

      applyToolUseToMessage(message, {
        toolUseId: "tool-2",
        toolName: "Read",
        input: { path: "/tmp" },
      });

      expect(message.subMessages).toHaveLength(2);
      expect(message.subMessages?.[0]?.content).toBe("思考中...");
      expect(message.subMessages?.[1]?.toolUse?.[0]?.toolUseId).toBe("tool-2");
    });
  });

  describe("applyToolResultToMessage", () => {
    it("應回傳新 Message 且更新對應 toolUseId 的 output 和 status", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                status: "running",
              },
            ],
          },
        ],
      };

      const result = applyToolResultToMessage(message, {
        toolUseId: "tool-1",
        output: "file.txt",
      });

      const toolUse = result.subMessages?.[0]?.toolUse?.[0];
      expect(toolUse?.output).toBe("file.txt");
      expect(toolUse?.status).toBe("completed");
      // 原始 message 不應被修改
      expect(message.subMessages?.[0]?.toolUse?.[0]?.status).toBe("running");
      expect(message.subMessages?.[0]?.toolUse?.[0]?.output).toBeUndefined();
      // 回傳的是新物件
      expect(result).not.toBe(message);
    });

    it("subMessages 為 undefined 時應回傳原始 message", () => {
      const message: Message = { id: "msg-1", role: "assistant", content: "" };

      const result = applyToolResultToMessage(message, {
        toolUseId: "tool-1",
        output: "out",
      });

      expect(result).toBe(message);
    });

    it("找不到對應 toolUseId 時應回傳原始 message 且不修改任何資料", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                status: "running",
              },
            ],
          },
        ],
      };

      const result = applyToolResultToMessage(message, {
        toolUseId: "non-existent",
        output: "output",
      });

      expect(result).toBe(message);
      expect(result.subMessages?.[0]?.toolUse?.[0]?.status).toBe("running");
      expect(result.subMessages?.[0]?.toolUse?.[0]?.output).toBeUndefined();
    });

    it("subMessage 無 toolUse 時應回傳原始 message", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [{ id: "sub-1", content: "text" }],
      };

      const result = applyToolResultToMessage(message, {
        toolUseId: "tool-1",
        output: "out",
      });

      expect(result).toBe(message);
    });
  });

  describe("mergeToolUseIntoMessage", () => {
    const makeToolUseInfo = (id: string, name: string): ToolUseInfo => ({
      toolUseId: id,
      toolName: name,
      input: {},
      status: "running",
    });

    it("message 無 subMessages 時，toolUse 被加入且回傳新 Message", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "hello",
      };
      const tool = makeToolUseInfo("tool-1", "Bash");

      const result = mergeToolUseIntoMessage(message, tool);

      expect(result).not.toBe(message);
      expect(result.toolUse).toHaveLength(1);
      expect(result.toolUse?.[0]?.toolUseId).toBe("tool-1");
      // 無 subMessages 時不會建立 subMessages
      expect(result.subMessages).toBeUndefined();
    });

    it("message 有 subMessages 且最後一個 content 為空時，tool 應 append 到最後一個 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "",
            toolUse: [makeToolUseInfo("tool-1", "Bash")],
          },
        ],
      };
      const tool = makeToolUseInfo("tool-2", "Read");

      const result = mergeToolUseIntoMessage(message, tool);

      // subMessages 數量不變，tool 合併到最後一個
      expect(result.subMessages).toHaveLength(1);
      expect(result.subMessages?.[0]?.toolUse).toHaveLength(2);
      expect(result.subMessages?.[0]?.toolUse?.[1]?.toolUseId).toBe("tool-2");
    });

    it("message 有 subMessages 且最後一個 content 不為空時，應 flush 並建立新 subMessage", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [
          {
            id: "sub-1",
            content: "正在處理...",
          },
        ],
      };
      const tool = makeToolUseInfo("tool-1", "Bash");

      const result = mergeToolUseIntoMessage(message, tool);

      expect(result.subMessages).toHaveLength(2);
      // 原先的 subMessage 被 flush（isPartial = false）
      expect(result.subMessages?.[0]?.content).toBe("正在處理...");
      expect(result.subMessages?.[0]?.isPartial).toBe(false);
      // 新建的 subMessage 包含 tool
      expect(result.subMessages?.[1]?.toolUse?.[0]?.toolUseId).toBe("tool-1");
    });

    it("原始 message 不被修改（不可變性驗證）", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        toolUse: [makeToolUseInfo("tool-1", "Bash")],
        subMessages: [
          {
            id: "sub-1",
            content: "",
            toolUse: [makeToolUseInfo("tool-1", "Bash")],
          },
        ],
      };
      const originalToolUseLength = message.toolUse!.length;
      const originalSubMessagesLength = message.subMessages!.length;
      const originalSubToolUseLength = message.subMessages![0]!.toolUse!.length;

      mergeToolUseIntoMessage(message, makeToolUseInfo("tool-2", "Read"));

      // 原始 message 的 toolUse 與 subMessages 皆未被修改
      expect(message.toolUse).toHaveLength(originalToolUseLength);
      expect(message.subMessages).toHaveLength(originalSubMessagesLength);
      expect(message.subMessages![0]!.toolUse).toHaveLength(
        originalSubToolUseLength,
      );
    });

    it("toolUse 陣列正確累加（已有 toolUse 時再加一個）", () => {
      const existingTool = makeToolUseInfo("tool-1", "Bash");
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        toolUse: [existingTool],
      };
      const newTool = makeToolUseInfo("tool-2", "Read");

      const result = mergeToolUseIntoMessage(message, newTool);

      expect(result.toolUse).toHaveLength(2);
      expect(result.toolUse?.[0]?.toolUseId).toBe("tool-1");
      expect(result.toolUse?.[1]?.toolUseId).toBe("tool-2");
    });
  });

  describe("upsertMessage", () => {
    it("訊息不存在時應 push 新訊息", () => {
      const messages: Message[] = [];

      upsertMessage(messages, "msg-1", "Hello", false, "user");

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: "msg-1",
        content: "Hello",
        isPartial: false,
        role: "user",
      });
    });

    it("訊息已存在時應更新 content 和 isPartial", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "assistant", content: "Hel", isPartial: true },
      ];

      upsertMessage(messages, "msg-1", "Hello world", false, "assistant");

      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("Hello world");
      expect(messages[0]?.isPartial).toBe(false);
    });

    it("更新時應保留其他欄位", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Hel",
          isPartial: true,
          timestamp: "2024-01-01",
        },
      ];

      upsertMessage(messages, "msg-1", "Hello", true, "assistant");

      expect(messages[0]?.timestamp).toBe("2024-01-01");
    });

    it("isPartial=true 時應正確儲存", () => {
      const messages: Message[] = [];

      upsertMessage(messages, "msg-1", "Streaming...", true, "assistant");

      expect(messages[0]?.isPartial).toBe(true);
    });

    it("system 訊息應保留 metadata 且不建立 assistant 專用 subMessages", () => {
      const messages: Message[] = [];

      upsertMessage(
        messages,
        "msg-1",
        "Rate limit exceeded",
        false,
        "system",
        undefined,
        {
          provider: "claude",
          code: "RATE_LIMIT",
          severity: "error",
        },
      );

      expect(messages[0]).toMatchObject({
        id: "msg-1",
        role: "system",
        content: "Rate limit exceeded",
        metadata: {
          provider: "claude",
          code: "RATE_LIMIT",
          severity: "error",
        },
      });
      expect(messages[0]?.subMessages).toBeUndefined();
    });
  });
});
