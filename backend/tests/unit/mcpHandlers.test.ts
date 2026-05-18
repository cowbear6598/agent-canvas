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

vi.mock("../../src/services/mcp/claudeMcpReader.js", () => ({
  readClaudeMcpServers: vi.fn(() => [{ name: "user-claude-server" }]),
}));

vi.mock("../../src/services/mcp/codexMcpReader.js", () => ({
  readCodexMcpServers: vi.fn(() => [
    { name: "user-codex-server", type: "stdio" },
  ]),
}));

vi.mock("../../src/services/mcp/opencodeMcpReader.js", () => ({
  readOpencodeMcpServers: vi.fn(() => [
    { name: "user-opencode-server", type: "stdio" },
  ]),
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
  handleMcpList,
} from "../../src/handlers/mcpHandlers.js";
import { GOAL_MCP_SERVER_NAME } from "../../src/services/goalRuntime.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";

function makePod(
  overrides: {
    id?: string;
    name?: string;
    goal?: { todos: Array<{ id: string; text: string }> } | null;
  } = {},
) {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Pod 1",
    goal: overrides.goal ?? null,
  };
}

describe("handleMcpList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagedMcpRuntimeService.markConfigDirty.mockResolvedValue(undefined);
  });

  it("有 Goal 的 Pod 應回傳內建 Goal Runtime 與既有 user MCP", async () => {
    vi.mocked(podStore.getByIdGlobal).mockReturnValue({
      pod: makePod({
        id: "pod-goal",
        goal: {
          todos: [{ id: "todo-1", text: "Inspect current task state" }],
        },
      }),
    } as any);

    await handleMcpList(
      "conn-1",
      { provider: "claude", podId: "pod-goal" },
      "req-1",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MCP_LIST_RESULT,
      expect.objectContaining({
        requestId: "req-1",
        success: true,
        provider: "claude",
        items: expect.arrayContaining([
          expect.objectContaining({
            name: GOAL_MCP_SERVER_NAME,
            system: true,
            locked: true,
            activeTodoId: "todo-1",
            activeTodoText: "Inspect current task state",
          }),
          expect.objectContaining({ name: "user-claude-server" }),
        ]),
      }),
    );
  });

  it("無 Goal 的 Pod 仍應回傳內建 Goal Runtime 與既有 user MCP", async () => {
    vi.mocked(podStore.getByIdGlobal).mockReturnValue({
      pod: makePod({ id: "pod-no-goal", goal: null }),
    } as any);

    await handleMcpList(
      "conn-1",
      { provider: "claude", podId: "pod-no-goal" },
      "req-2",
    );

    const payload = vi.mocked(socketService.emitToConnection).mock.calls[0]?.[2] as
      | {
          items?: Array<{
            name: string;
            totalCount?: number;
            activeTodoId?: string | null;
          }>;
        }
      | undefined;

    expect(payload?.items).toEqual([
      expect.objectContaining({
        name: GOAL_MCP_SERVER_NAME,
        totalCount: 0,
        activeTodoId: null,
      }),
      { name: "user-claude-server" },
    ]);
  });
});

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
