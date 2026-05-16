import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMcpServers, invalidateMcpServersCache } from "@/services/mcpApi";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  createWebSocketRequest: vi.fn(),
}));

describe("mcpApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateMcpServersCache();
  });

  it("legacy gemini provider 不應送出 MCP 查詢", async () => {
    const result = await listMcpServers("gemini");

    expect(result).toEqual([]);
    expect(createWebSocketRequest).not.toHaveBeenCalled();
  });

  it("支援的 provider 應送出 allowlist 內的 payload", async () => {
    vi.mocked(createWebSocketRequest).mockResolvedValue({
      items: [{ name: "context7", type: "stdio" }],
    } as never);

    const result = await listMcpServers("opencode");

    expect(result).toEqual([{ name: "context7", type: "stdio" }]);
    expect(createWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: "opencode" },
      }),
    );
  });
});
