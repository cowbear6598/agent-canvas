import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ok } from "../../src/types/index.js";
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
    capabilityToken: "capability-token",
    endpointUrl: "http://127.0.0.1:3001/api/internal/integration-reply",
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

  it("成功回覆時轉發到主後端 endpoint 並回傳 success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const result = await callIntegrationReplyTool(createScope(), {
      name: "slack_reply",
      arguments: { text: " hello " },
    });

    expect(result).toMatchObject({ content: [{ type: "text", text: "success" }] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/internal/integration-reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          capabilityToken: "capability-token",
          text: "hello",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("主後端 endpoint 回傳錯誤時轉為 MCP error result", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "boom" }), {
          status: 400,
        }),
      );

    const result = await callIntegrationReplyTool(createScope(), {
      name: "slack_reply",
      arguments: { text: "hello" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("boom");
    fetchMock.mockRestore();
  });

  it("轉發時不把 integration extra 或 replyContext 暴露給 bridge endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    await callIntegrationReplyTool(createScope(), {
      name: "slack_reply",
      arguments: { text: "hello" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBe(
      JSON.stringify({ capabilityToken: "capability-token", text: "hello" }),
    );
    fetchMock.mockRestore();
  });
});
