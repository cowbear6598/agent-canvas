import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { err, ok } from "../../src/types/index.js";
import {
  callIntegrationReplyTool,
  listIntegrationReplyTools,
  type ReplyBridgeScope,
} from "../../src/services/integration/integrationReplyMcpBridge.js";
import type { IntegrationProvider } from "../../src/services/integration/types.js";

function createScope(
  overrides: Partial<ReplyBridgeScope> = {},
): ReplyBridgeScope {
  return {
    provider: "slack",
    appId: "app-slack",
    resourceId: "C123456",
    podId: "pod-1",
    extra: { threadTs: "from-extra", keep: "extra" },
    replyContext: { threadTs: "from-context", senderId: "U123456" },
    ...overrides,
  };
}

function createProvider(
  sendMessage = vi.fn().mockResolvedValue(ok(undefined)),
): IntegrationProvider {
  return {
    name: "slack",
    displayName: "Slack",
    createAppSchema: z.object({}),
    validateCreate: vi.fn(),
    sanitizeConfig: vi.fn(),
    initialize: vi.fn(),
    destroy: vi.fn(),
    destroyAll: vi.fn(),
    refreshResources: vi.fn(),
    sendMessage,
    formatEventMessage: vi.fn(),
  };
}

describe("Integration Reply MCP Bridge", () => {
  it("回傳單一 provider reply tool", () => {
    const tools = listIntegrationReplyTools(createScope(), createProvider());

    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]).toMatchObject({
      name: "slack_reply",
      inputSchema: {
        type: "object",
        required: ["text"],
      },
    });
  });

  it("成功回覆時呼叫 provider.sendMessage 並回傳 success", async () => {
    const sendMessage = vi.fn().mockResolvedValue(ok(undefined));
    const provider = createProvider(sendMessage);

    const result = await callIntegrationReplyTool(createScope(), provider, {
      name: "slack_reply",
      arguments: { text: " hello " },
    });

    expect(result).toMatchObject({ content: [{ type: "text", text: "success" }] });
    expect(sendMessage).toHaveBeenCalledWith(
      "app-slack",
      "C123456",
      "hello",
      {
        threadTs: "from-context",
        keep: "extra",
        senderId: "U123456",
      },
    );
  });

  it("provider 回傳錯誤時轉為 MCP error result", async () => {
    const provider = createProvider(vi.fn().mockResolvedValue(err("boom")));

    const result = await callIntegrationReplyTool(createScope(), provider, {
      name: "slack_reply",
      arguments: { text: "hello" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("boom");
  });

  it("merge scope.extra 與 replyContext 時 replyContext 覆蓋 extra", async () => {
    const sendMessage = vi.fn().mockResolvedValue(ok(undefined));

    await callIntegrationReplyTool(createScope(), createProvider(sendMessage), {
      name: "slack_reply",
      arguments: { text: "hello" },
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ threadTs: "from-context" }),
    );
  });
});
