import { describe, it, expect } from "vitest";
import {
  buildRunPodCacheKey,
  buildSubMessageId,
  applyToolUseToMessage,
  applyToolResultToMessage,
  upsertMessage,
} from "@/stores/chat/messageHelpers";
import type { Message } from "@/types/chat";

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
    it("應更新對應 toolUseId 的 output 和 status", () => {
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

      applyToolResultToMessage(message, {
        toolUseId: "tool-1",
        output: "file.txt",
      });

      const toolUse = message.subMessages?.[0]?.toolUse?.[0];
      expect(toolUse?.output).toBe("file.txt");
      expect(toolUse?.status).toBe("completed");
    });

    it("subMessages 為 undefined 時應 early return，不拋出錯誤", () => {
      const message: Message = { id: "msg-1", role: "assistant", content: "" };

      expect(() =>
        applyToolResultToMessage(message, {
          toolUseId: "tool-1",
          output: "out",
        }),
      ).not.toThrow();
    });

    it("找不到對應 toolUseId 時不應修改任何資料", () => {
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

      applyToolResultToMessage(message, {
        toolUseId: "non-existent",
        output: "output",
      });

      expect(message.subMessages?.[0]?.toolUse?.[0]?.status).toBe("running");
      expect(message.subMessages?.[0]?.toolUse?.[0]?.output).toBeUndefined();
    });

    it("subMessage 無 toolUse 時應跳過", () => {
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "",
        subMessages: [{ id: "sub-1", content: "text" }],
      };

      expect(() =>
        applyToolResultToMessage(message, {
          toolUseId: "tool-1",
          output: "out",
        }),
      ).not.toThrow();
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
  });
});
