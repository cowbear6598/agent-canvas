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
    const result = await listMcpServers("gemini", "pod-gemini");

    expect(result).toEqual([]);
    expect(createWebSocketRequest).not.toHaveBeenCalled();
  });

  it("支援的 provider 應送出 pod-aware payload，並保留 Goal Runtime metadata", async () => {
    vi.mocked(createWebSocketRequest).mockResolvedValue({
      items: [
        {
          name: "agent_canvas_goal",
          type: "stdio",
          system: true,
          locked: true,
          status: "running",
          activeTodoText: "Ship it",
          completedTodoIds: ["goal-1"],
          completedCount: 1,
          totalCount: 2,
        },
        { name: "context7", type: "stdio" },
      ],
    } as never);

    const result = await listMcpServers("opencode", "pod-opencode");

    expect(result).toEqual([
      {
        name: "agent_canvas_goal",
        type: "stdio",
        system: true,
        locked: true,
        status: "running",
        activeTodoText: "Ship it",
        completedTodoIds: ["goal-1"],
        completedCount: 1,
        totalCount: 2,
      },
      { name: "context7", type: "stdio" },
    ]);
    expect(createWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: "opencode", podId: "pod-opencode" },
      }),
    );
  });

  it("同 provider 不同 podId 應使用不同 cache key", async () => {
    vi.mocked(createWebSocketRequest)
      .mockResolvedValueOnce({ items: [{ name: "a" }] } as never)
      .mockResolvedValueOnce({ items: [{ name: "b" }] } as never);

    const podA = await listMcpServers("claude", "pod-a");
    const podB = await listMcpServers("claude", "pod-b");

    expect(podA).toEqual([{ name: "a" }]);
    expect(podB).toEqual([{ name: "b" }]);
    expect(createWebSocketRequest).toHaveBeenCalledTimes(2);
  });

  it("指定 podId invalidation 後應重新抓取該 pod 的 MCP 清單", async () => {
    vi.mocked(createWebSocketRequest)
      .mockResolvedValueOnce({ items: [{ name: "context7" }] } as never)
      .mockResolvedValueOnce({ items: [{ name: "fresh-context7" }] } as never);

    await listMcpServers("claude", "pod-1");
    invalidateMcpServersCache("claude", "pod-1");
    const refreshed = await listMcpServers("claude", "pod-1");

    expect(refreshed).toEqual([{ name: "fresh-context7" }]);
    expect(createWebSocketRequest).toHaveBeenCalledTimes(2);
  });
});
