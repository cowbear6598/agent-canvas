import { describe, it, expect } from "vitest";
import {
  updateAssistantSubMessages,
  finalizeSubMessages,
  flushAndCreateNewSubMessage,
  appendToolToLastSubMessage,
  updateSubMessagesToolUseResult,
  updateMainMessageState,
  collectToolUseFromSubMessages,
} from "@/stores/chat/subMessageHelpers";
import type { Message, SubMessage, ToolUseInfo } from "@/types/chat";

describe("updateAssistantSubMessages", () => {
  const buildMessage = (overrides: Partial<Message> = {}): Message => ({
    id: "msg-1",
    role: "assistant",
    content: "Hello",
    isPartial: true,
    timestamp: new Date().toISOString(),
    subMessages: [{ id: "msg-1-sub-0", content: "Hello", isPartial: true }],
    ...overrides,
  });

  it("應呼叫 updateSubMessageContent 更新 subMessages", () => {
    const existingMessage = buildMessage();
    const result = updateAssistantSubMessages(existingMessage, " World", true);

    expect(result.subMessages).toBeDefined();
    expect(result.subMessages).toHaveLength(1);
    expect(result.subMessages![0]!.content).toBe("Hello World");
  });

  it("回傳結果不應包含 expectingNewBlock 欄位", () => {
    const existingMessage = buildMessage();
    const result = updateAssistantSubMessages(existingMessage, "delta", true);

    expect(result).not.toHaveProperty("expectingNewBlock");
  });

  it("回傳值只包含 subMessages", () => {
    const existingMessage = buildMessage();
    const result = updateAssistantSubMessages(existingMessage, "delta", true);

    expect(Object.keys(result)).toEqual(["subMessages"]);
  });
});

describe("flushAndCreateNewSubMessage", () => {
  it("應將最後一個 SubMessage 的 isPartial 設為 false", () => {
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "Hello", isPartial: true },
    ];

    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const result = flushAndCreateNewSubMessage(
      subMessages,
      "msg-1",
      toolUseInfo,
    );

    expect(result[0]!.isPartial).toBe(false);
  });

  it("應建立新的 SubMessage 並帶入 toolUseInfo", () => {
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "Hello", isPartial: true },
    ];

    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const result = flushAndCreateNewSubMessage(
      subMessages,
      "msg-1",
      toolUseInfo,
    );

    expect(result).toHaveLength(2);
    expect(result[1]!.toolUse).toHaveLength(1);
    expect(result[1]!.toolUse![0]).toBe(toolUseInfo);
  });

  it("新 SubMessage 的 id 應為 messageId-sub-N（N 為原陣列長度）", () => {
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "Hello", isPartial: true },
    ];

    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const result = flushAndCreateNewSubMessage(
      subMessages,
      "msg-1",
      toolUseInfo,
    );

    expect(result[1]!.id).toBe("msg-1-sub-1");
  });

  it("新 SubMessage 的 content 應為空字串", () => {
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "Hello", isPartial: true },
    ];

    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const result = flushAndCreateNewSubMessage(
      subMessages,
      "msg-1",
      toolUseInfo,
    );

    expect(result[1]!.content).toBe("");
  });

  it("新 SubMessage 的 isPartial 應為 true", () => {
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "Hello", isPartial: true },
    ];

    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const result = flushAndCreateNewSubMessage(
      subMessages,
      "msg-1",
      toolUseInfo,
    );

    expect(result[1]!.isPartial).toBe(true);
  });
});

describe("appendToolToLastSubMessage", () => {
  it("應將 toolUseInfo append 到最後一個 SubMessage 的 toolUse 陣列", () => {
    const toolUse1: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const toolUse2: ToolUseInfo = {
      toolUseId: "tool-2",
      toolName: "Read",
      input: {},
      status: "running",
    };
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "", isPartial: true, toolUse: [toolUse1] },
    ];

    const result = appendToolToLastSubMessage(subMessages, toolUse2);

    expect(result).toHaveLength(1);
    expect(result[0]!.toolUse).toHaveLength(2);
    expect(result[0]!.toolUse![0]).toBe(toolUse1);
    expect(result[0]!.toolUse![1]).toBe(toolUse2);
  });

  it("最後一個 SubMessage 原本沒有 toolUse 時，應建立包含新 tool 的陣列", () => {
    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "", isPartial: true },
    ];

    const result = appendToolToLastSubMessage(subMessages, toolUseInfo);

    expect(result[0]!.toolUse).toHaveLength(1);
    expect(result[0]!.toolUse![0]).toBe(toolUseInfo);
  });

  it("不應修改原始 subMessages 陣列（immutable）", () => {
    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };
    const subMessages: SubMessage[] = [
      { id: "msg-1-sub-0", content: "", isPartial: true },
    ];

    appendToolToLastSubMessage(subMessages, toolUseInfo);

    expect(subMessages[0]!.toolUse).toBeUndefined();
  });

  it("subMessages 為空陣列時應回傳空陣列", () => {
    const toolUseInfo: ToolUseInfo = {
      toolUseId: "tool-1",
      toolName: "Bash",
      input: {},
      status: "running",
    };

    const result = appendToolToLastSubMessage([], toolUseInfo);

    expect(result).toHaveLength(0);
  });
});

describe("updateLastSubMessage delta 累加", () => {
  it("updateAssistantSubMessages 應使用 delta 累加而非全文替換", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      isPartial: true,
      timestamp: new Date().toISOString(),
      subMessages: [{ id: "msg-1-sub-0", content: "Hello", isPartial: true }],
    };

    const result = updateAssistantSubMessages(message, " World", true);

    expect(result.subMessages![0]!.content).toBe("Hello World");
  });

  it("多個 SubMessage 時，updateAssistantSubMessages 只累加 delta 到最後一個 SubMessage", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      content: "HelloTool",
      isPartial: true,
      timestamp: new Date().toISOString(),
      subMessages: [
        { id: "msg-1-sub-0", content: "Hello", isPartial: false },
        { id: "msg-1-sub-1", content: "", isPartial: true },
      ],
    };

    const result = updateAssistantSubMessages(message, " After", true);

    expect(result.subMessages![0]!.content).toBe("Hello");
    expect(result.subMessages![1]!.content).toBe(" After");
  });
});

describe("finalizeSubMessages", () => {
  it("subMessages 為 undefined 時應回傳 undefined", () => {
    expect(finalizeSubMessages(undefined)).toBeUndefined();
  });

  it("subMessages 為空陣列時應回傳 undefined", () => {
    expect(finalizeSubMessages([])).toBeUndefined();
  });

  it("無 toolUse 的 sub 應將 isPartial 設為 false", () => {
    const subMessages: SubMessage[] = [
      { id: "sub-1", content: "內容", isPartial: true },
    ];
    const result = finalizeSubMessages(subMessages);

    expect(result![0]!.isPartial).toBe(false);
    expect(result![0]!.toolUse).toBeUndefined();
  });

  it("toolUse 為空陣列的 sub 應將 isPartial 設為 false 且移除 toolUse", () => {
    const subMessages: SubMessage[] = [
      { id: "sub-1", content: "內容", isPartial: true, toolUse: [] },
    ];
    const result = finalizeSubMessages(subMessages);

    expect(result![0]!.isPartial).toBe(false);
    expect(result![0]!.toolUse).toBeUndefined();
  });

  it("running 狀態的 toolUse 應被標記為 completed", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-1",
        content: "內容",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "running",
            input: {},
          },
        ],
      },
    ];
    const result = finalizeSubMessages(subMessages);

    expect(result![0]!.isPartial).toBe(false);
    expect(result![0]!.toolUse![0]!.status).toBe("completed");
  });

  it("已是 completed 狀態的 toolUse 應維持不變", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-1",
        content: "內容",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "completed",
            input: {},
          },
        ],
      },
    ];
    const result = finalizeSubMessages(subMessages);

    expect(result![0]!.toolUse![0]!.status).toBe("completed");
  });

  it("finalizeSubMessages 應合併空 content SubMessage 的 toolUse 到前一個 SubMessage", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "執行中",
        isPartial: false,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "completed",
            input: {},
          },
        ],
      },
      {
        id: "sub-1",
        content: "",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-2",
            toolName: "read_file",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = finalizeSubMessages(subMessages);

    expect(result).toHaveLength(1);
    expect(result![0]!.content).toBe("執行中");
    expect(result![0]!.toolUse).toHaveLength(2);
    expect(result![0]!.toolUse!.map((t) => t.toolUseId)).toContain("tool-1");
    expect(result![0]!.toolUse!.map((t) => t.toolUseId)).toContain("tool-2");
  });

  it("finalizeSubMessages 第一個 SubMessage 為空但有 tool 時應保留", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = finalizeSubMessages(subMessages);

    expect(result).toHaveLength(1);
    expect(result![0]!.content).toBe("");
    expect(result![0]!.toolUse).toHaveLength(1);
    expect(result![0]!.toolUse![0]!.toolUseId).toBe("tool-1");
  });
});

describe("updateSubMessagesToolUseResult", () => {
  it("應依據指定 toolUseId 更新對應 tool 的 output 並標記為 completed", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "執行中",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = updateSubMessagesToolUseResult(
      subMessages,
      "tool-1",
      "執行結果",
    );

    expect(result[0]!.toolUse![0]!.output).toBe("執行結果");
    expect(result[0]!.toolUse![0]!.status).toBe("completed");
  });

  it("toolUseId 不存在時不修改任何 tool", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "執行中",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = updateSubMessagesToolUseResult(
      subMessages,
      "tool-99",
      "結果",
    );

    expect(result[0]!.toolUse![0]!.status).toBe("running");
    expect(result[0]!.toolUse![0]!.output).toBeUndefined();
  });

  it("有提供較準確的 toolName 時，應在寫入 result 時同步升級名稱", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "執行中",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "mcp__mcp__tool",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = updateSubMessagesToolUseResult(
      subMessages,
      "tool-1",
      "執行結果",
      "mcp__agent_canvas_goal__get_goal_status",
    );

    expect(result[0]!.toolUse![0]!.toolName).toBe(
      "mcp__agent_canvas_goal__get_goal_status",
    );
    expect(result[0]!.toolUse![0]!.output).toBe("執行結果");
  });

  it("多個 subMessages 時只更新包含該 toolUseId 的", () => {
    const subMessages: SubMessage[] = [
      {
        id: "sub-0",
        content: "第一段",
        isPartial: false,
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "bash",
            status: "running",
            input: {},
          },
        ],
      },
      {
        id: "sub-1",
        content: "第二段",
        isPartial: true,
        toolUse: [
          {
            toolUseId: "tool-2",
            toolName: "read_file",
            status: "running",
            input: {},
          },
        ],
      },
    ];

    const result = updateSubMessagesToolUseResult(
      subMessages,
      "tool-2",
      "讀取結果",
    );

    expect(result[0]!.toolUse![0]!.status).toBe("running");
    expect(result[0]!.toolUse![0]!.output).toBeUndefined();
    expect(result[1]!.toolUse![0]!.status).toBe("completed");
    expect(result[1]!.toolUse![0]!.output).toBe("讀取結果");
  });
});

describe("updateMainMessageState", () => {
  const buildMessage = (overrides: Partial<Message> = {}): Message => ({
    id: "msg-1",
    role: "assistant",
    content: "Hello",
    isPartial: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  it("有 toolUse 時應更新 message 的 toolUse", () => {
    const message = buildMessage();
    const updatedToolUse: ToolUseInfo[] = [
      {
        toolUseId: "tool-1",
        toolName: "bash",
        status: "completed",
        input: {},
        output: "結果",
      },
    ];

    const result = updateMainMessageState(
      message,
      "Hello",
      updatedToolUse,
      undefined,
    );

    expect(result.toolUse).toBe(updatedToolUse);
  });

  it("有 subMessages 時應更新 message 的 subMessages", () => {
    const message = buildMessage();
    const finalizedSubMessages: SubMessage[] = [
      { id: "sub-0", content: "Hello", isPartial: false },
    ];

    const result = updateMainMessageState(
      message,
      "Hello",
      undefined,
      finalizedSubMessages,
    );

    expect(result.subMessages).toBe(finalizedSubMessages);
  });

  it("toolUse 為 undefined 時不應覆蓋原本的 toolUse", () => {
    const existingToolUse: ToolUseInfo[] = [
      { toolUseId: "tool-1", toolName: "bash", status: "completed", input: {} },
    ];
    const message = buildMessage({ toolUse: existingToolUse });

    const result = updateMainMessageState(
      message,
      "Hello",
      undefined,
      undefined,
    );

    expect(result.toolUse).toBe(existingToolUse);
  });

  it("subMessages 為 undefined 時不應覆蓋原本的 subMessages", () => {
    const existingSubMessages: SubMessage[] = [
      { id: "sub-0", content: "Hello", isPartial: false },
    ];
    const message = buildMessage({ subMessages: existingSubMessages });

    const result = updateMainMessageState(
      message,
      "Hello",
      undefined,
      undefined,
    );

    expect(result.subMessages).toBe(existingSubMessages);
  });

  it("應將 isPartial 設為 false 並更新 content", () => {
    const message = buildMessage({ content: "舊內容", isPartial: true });

    const result = updateMainMessageState(
      message,
      "新內容",
      undefined,
      undefined,
    );

    expect(result.content).toBe("新內容");
    expect(result.isPartial).toBe(false);
  });
});

describe("collectToolUseFromSubMessages", () => {
  it("多個 subMessage 的工具應正確展平", () => {
    const subMessages = [
      {
        id: "sub-0",
        content: "第一段",
        toolUse: [
          {
            toolUseId: "t-1",
            toolName: "bash",
            input: {},
            status: "completed",
          },
          { toolUseId: "t-2", toolName: "read", input: {}, status: "running" },
        ],
      },
      {
        id: "sub-1",
        content: "第二段",
        toolUse: [
          {
            toolUseId: "t-3",
            toolName: "edit",
            input: { file: "a.ts" },
            output: "ok",
            status: "completed",
          },
        ],
      },
    ];

    const result = collectToolUseFromSubMessages(subMessages);

    expect(result).toHaveLength(3);
    expect(result.map((t) => t.toolUseId)).toEqual(["t-1", "t-2", "t-3"]);
    expect(result[2]!.output).toBe("ok");
    expect(result[2]!.input).toEqual({ file: "a.ts" });
  });

  it("無 toolUse 的 subMessage 不影響結果", () => {
    const subMessages = [
      { id: "sub-0", content: "純文字", toolUse: undefined },
      {
        id: "sub-1",
        content: "",
        toolUse: [
          { toolUseId: "t-1", toolName: "bash", input: {}, status: "running" },
        ],
      },
    ];

    const result = collectToolUseFromSubMessages(subMessages);

    expect(result).toHaveLength(1);
    expect(result[0]!.toolUseId).toBe("t-1");
  });

  it("status 無效時應 fallback 為 completed", () => {
    const subMessages = [
      {
        id: "sub-0",
        content: "",
        toolUse: [
          {
            toolUseId: "t-1",
            toolName: "bash",
            input: {},
            status: "invalid-status",
          },
        ],
      },
    ];

    const result = collectToolUseFromSubMessages(subMessages);

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("completed");
  });

  it("輸入為空陣列時應回傳空陣列", () => {
    const result = collectToolUseFromSubMessages([]);

    expect(result).toEqual([]);
  });

  it("輸入為 undefined 時應回傳空陣列", () => {
    const result = collectToolUseFromSubMessages(undefined);

    expect(result).toEqual([]);
  });
});
