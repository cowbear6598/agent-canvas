import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteManagedMcpRegistry,
  invalidateManagedMcpRegistryCache,
  invalidatePodMcpAvailabilityCache,
  listManagedMcpRegistry,
  listPodMcpAvailability,
  saveManagedMcpRegistry,
} from "@/services/managedMcpApi";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  createWebSocketRequest: vi.fn(),
}));

describe("managedMcpApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateManagedMcpRegistryCache();
    invalidatePodMcpAvailabilityCache();
  });

  it("registry list 會正規化 transport 與 status", async () => {
    vi.mocked(createWebSocketRequest).mockResolvedValue({
      items: [
        {
          id: "registry-1",
          name: "context7",
          transport: " HTTP ",
          enabled: true,
          url: "https://example.com/mcp",
          status: " HEALTHY ",
          last_error: "boom",
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-02T00:00:00.000Z",
        },
      ],
    } as never);

    const result = await listManagedMcpRegistry();

    expect(result).toEqual([
      {
        id: "registry-1",
        name: "context7",
        transport: "http",
        enabled: true,
        command: null,
        args: [],
        cwd: null,
        env: {},
        url: "https://example.com/mcp",
        status: "healthy",
        lastError: "boom",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("pod availability 會保留 selected / disabledReason", async () => {
    vi.mocked(createWebSocketRequest).mockResolvedValue({
      items: [
        {
          name: "remote-docs",
          transport: "sse",
          status: "starting",
          selected: true,
          selectable: false,
          disabledReason: "provider mismatch",
          lastError: null,
        },
      ],
    } as never);

    const result = await listPodMcpAvailability("pod-1", "claude");

    expect(result).toEqual([
      {
        name: "remote-docs",
        transport: "sse",
        status: "starting",
        selected: true,
        selectable: false,
        disabledReason: "provider mismatch",
        lastError: null,
      },
    ]);
  });

  it("registry updated 事件後下一次 popover 會重抓 availability", async () => {
    vi.mocked(createWebSocketRequest)
      .mockResolvedValueOnce({
        items: [
          {
            name: "context7",
            transport: "stdio",
            status: "healthy",
            selected: false,
            selectable: true,
            disabledReason: null,
            lastError: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            name: "context7",
            transport: "stdio",
            status: "starting",
            selected: false,
            selectable: false,
            disabledReason: "registry updated",
            lastError: null,
          },
        ],
      } as never);

    const initial = await listPodMcpAvailability("pod-1", "claude");
    invalidatePodMcpAvailabilityCache("claude", "pod-1");
    const refreshed = await listPodMcpAvailability("pod-1", "claude");

    expect(initial).toEqual([
      expect.objectContaining({
        name: "context7",
        status: "healthy",
      }),
    ]);
    expect(refreshed).toEqual([
      expect.objectContaining({
        name: "context7",
        status: "starting",
        disabledReason: "registry updated",
      }),
    ]);
    expect(createWebSocketRequest).toHaveBeenCalledTimes(2);
  });

  it("registry save/delete 後會清掉相關 cache", async () => {
    vi.mocked(createWebSocketRequest)
      .mockResolvedValueOnce({
        items: [
          {
            id: "registry-1",
            name: "context7",
            transport: "stdio",
            enabled: true,
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            status: "healthy",
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            name: "context7",
            transport: "stdio",
            status: "healthy",
            selected: false,
            selectable: true,
            disabledReason: null,
            lastError: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        item: {
          id: "registry-1",
          name: "context7",
          transport: "stdio",
          enabled: true,
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          status: "healthy",
        },
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            id: "registry-1",
            name: "context7",
            transport: "stdio",
            enabled: true,
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            status: "healthy",
          },
          {
            id: "registry-2",
            name: "fresh-server",
            transport: "http",
            enabled: true,
            url: "https://example.com/mcp",
            status: "starting",
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            name: "fresh-server",
            transport: "http",
            status: "starting",
            selected: false,
            selectable: true,
            disabledReason: null,
            lastError: null,
          },
        ],
      } as never)
      .mockResolvedValueOnce({ registryId: "registry-2" } as never)
      .mockResolvedValueOnce({ items: [] } as never);

    await listManagedMcpRegistry();
    await listManagedMcpRegistry();
    await listPodMcpAvailability("pod-1", "claude");
    await listPodMcpAvailability("pod-1", "claude");

    expect(createWebSocketRequest).toHaveBeenCalledTimes(2);

    await saveManagedMcpRegistry({
      name: "fresh-server",
      transport: "http",
      enabled: true,
      url: "https://example.com/mcp",
    });

    await listManagedMcpRegistry();
    await listPodMcpAvailability("pod-1", "claude");

    expect(createWebSocketRequest).toHaveBeenCalledTimes(5);

    await deleteManagedMcpRegistry("registry-2");
    await listManagedMcpRegistry();

    expect(createWebSocketRequest).toHaveBeenCalledTimes(7);
  });
});
