import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockManagedMcpStore } = vi.hoisted(() => ({
  mockManagedMcpStore: {
    list: vi.fn(),
    save: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
  },
}));

const { mockManagedMcpRuntimeService } = vi.hoisted(() => ({
  mockManagedMcpRuntimeService: {
    markConfigDirty: vi.fn(),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getByIdGlobal: vi.fn(),
    getById: vi.fn(),
    setMcpServerNames: vi.fn(),
  },
}));

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    hasActiveRunForPod: vi.fn(() => false),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: vi.fn(),
    emitToAll: vi.fn(),
    emitToCanvas: vi.fn(),
  },
}));

vi.mock("../../src/services/mcp/managedMcpStore.js", () => ({
  managedMcpStore: mockManagedMcpStore,
}));

vi.mock("../../src/services/mcp/managedMcpRuntimeService.js", () => ({
  managedMcpRuntimeService: mockManagedMcpRuntimeService,
}));

import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import {
  handleManagedMcpRegistryDelete,
  handleManagedMcpRegistryList,
  handleManagedMcpRegistrySave,
} from "../../src/handlers/mcpHandlers.js";
import { socketService } from "../../src/services/socketService.js";

describe("managed MCP handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagedMcpRuntimeService.markConfigDirty.mockResolvedValue(undefined);
  });

  it("registry list 回傳 persisted entries", async () => {
    mockManagedMcpStore.list.mockReturnValue([
      {
        id: "registry-1",
        name: "context7",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        cwd: null,
        env: {},
        url: null,
        lastKnownStatus: "healthy",
        lastError: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);

    await handleManagedMcpRegistryList(
      "conn-1",
      { requestId: "00000000-0000-4000-8000-000000000001" },
      "req-list",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
      expect.objectContaining({
        requestId: "req-list",
        success: true,
        items: [
          expect.objectContaining({
            name: "context7",
            transport: "stdio",
            status: "healthy",
          }),
        ],
      }),
    );
  });

  it("save 後廣播 registry updated", async () => {
    mockManagedMcpStore.save.mockReturnValue({
      id: "registry-2",
      name: "remote-docs",
      transport: "http",
      enabled: true,
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://example.com/mcp",
      lastKnownStatus: "starting",
      lastError: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    await handleManagedMcpRegistrySave(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000002",
        registry: {
          name: "remote-docs",
          transport: "http",
          enabled: true,
          url: "https://example.com/mcp",
        },
      },
      "req-save",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      expect.objectContaining({
        requestId: "req-save",
        success: true,
        item: expect.objectContaining({ name: "remote-docs" }),
      }),
    );
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        action: "saved",
        registryId: "registry-2",
      }),
    );
  });

  it("delete 後清單移除該 entry", async () => {
    mockManagedMcpStore.getById.mockReturnValue({
      id: "registry-3",
      name: "to-delete",
    });
    mockManagedMcpStore.delete.mockReturnValue(true);

    await handleManagedMcpRegistryDelete(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000003",
        registryId: "registry-3",
      },
      "req-delete",
    );

    expect(mockManagedMcpStore.delete).toHaveBeenCalledWith("registry-3");
    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
      expect.objectContaining({
        requestId: "req-delete",
        success: true,
        registryId: "registry-3",
      }),
    );
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        action: "deleted",
        registryId: "registry-3",
      }),
    );
  });
});
