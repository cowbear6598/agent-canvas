import { describe, it, expect } from "vitest";
import { createAssistantMessageWithTool } from "@/stores/run/runStoreHelpers";
import type { ToolUseInfo } from "@/types/chat";

describe("createAssistantMessageWithTool", () => {
  const toolUseInfo: ToolUseInfo = {
    toolUseId: "tool-1",
    toolName: "Bash",
    input: { command: "ls" },
    status: "running",
  };

  it("初始狀態：role 應為 assistant、content 應為空字串、isPartial 應為 true", () => {
    const msg = createAssistantMessageWithTool("msg-1", toolUseInfo);

    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("");
    expect(msg.isPartial).toBe(true);
  });

  it("id 應與傳入的 messageId 一致", () => {
    const msg = createAssistantMessageWithTool("msg-abc", toolUseInfo);

    expect(msg.id).toBe("msg-abc");
  });

  it("toolUse 應包含傳入的 toolUseInfo", () => {
    const msg = createAssistantMessageWithTool("msg-1", toolUseInfo);

    expect(msg.toolUse).toHaveLength(1);
    expect(msg.toolUse![0]).toBe(toolUseInfo);
  });

  it("subMessages 應包含一個初始 SubMessage", () => {
    const msg = createAssistantMessageWithTool("msg-1", toolUseInfo);

    expect(msg.subMessages).toHaveLength(1);
    const sub = msg.subMessages![0]!;
    expect(sub.id).toBe("msg-1-sub-0");
    expect(sub.content).toBe("");
    expect(sub.isPartial).toBe(true);
    expect(sub.toolUse).toHaveLength(1);
    expect(sub.toolUse![0]).toBe(toolUseInfo);
  });
});
