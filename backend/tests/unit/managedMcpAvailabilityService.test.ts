import { describe, expect, it, vi } from "vitest";
import { GOAL_MCP_SERVER_NAME } from "../../src/services/goalRuntime.js";
import { createManagedMcpAvailabilityService } from "../../src/services/mcp/managedMcpAvailabilityService.js";
import type { ManagedMcpServerRecord } from "../../src/services/mcp/managedMcpStore.js";
import type { Pod } from "../../src/types/pod.js";

function createEntry(
  overrides: Partial<ManagedMcpServerRecord> = {},
): ManagedMcpServerRecord {
  return {
    id: overrides.id ?? "registry-1",
    name: overrides.name ?? "context7",
    transport: overrides.transport ?? "stdio",
    command: overrides.command ?? "node server.js",
    args: overrides.args ?? [],
    cwd: overrides.cwd ?? null,
    env: overrides.env ?? {},
    url: overrides.url ?? null,
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? "2026-05-17T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-17T00:00:00.000Z",
    lastKnownStatus: overrides.lastKnownStatus ?? "idle",
    lastError: overrides.lastError ?? null,
  };
}

function createPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Pod 1",
    workspacePath: overrides.workspacePath ?? "/tmp/pod-1",
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    rotation: overrides.rotation ?? 0,
    sessionId: overrides.sessionId ?? null,
    mcpServerNames: overrides.mcpServerNames ?? [],
    pluginIds: overrides.pluginIds ?? [],
    provider: overrides.provider ?? "claude",
    providerConfig: overrides.providerConfig ?? null,
    repositoryId: overrides.repositoryId ?? null,
    goal: overrides.goal ?? {
      todos: [{ id: "todo-1", text: "Inspect current task state" }],
    },
    schedule: overrides.schedule,
    integrationBindings: overrides.integrationBindings,
  };
}

describe("ManagedMcpAvailabilityService", () => {
  it("已選取且 healthy 的 entry 可切換", () => {
    const service = createManagedMcpAvailabilityService({
      store: {
        list: vi.fn(() => [
          createEntry({
            name: "context7",
            transport: "stdio",
            lastKnownStatus: "healthy",
          }),
        ]),
      },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => ({
          name: "context7",
          transport: "stdio",
          enabled: true,
          status: "healthy",
          lastError: null,
          dirty: false,
          pid: 1234,
          endpointUrl: null,
        })),
      },
    });

    const availability = service.listForPod(
      createPod({
        provider: "claude",
        mcpServerNames: ["context7"],
      }),
    );
    const item = availability.find((entry) => entry.name === "context7");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: true,
        status: "healthy",
      }),
    );
  });

  it("已從 registry 移除的 name 會標示為無效", () => {
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => []) },
      runtimeService: { getRuntimeSnapshot: vi.fn(() => null) },
    });

    const availability = service.listForPod(
      createPod({
        mcpServerNames: ["ghost-server"],
      }),
    );
    const item = availability.find((entry) => entry.name === "ghost-server");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: false,
        status: "error",
        disabledReason: "registry entry removed",
      }),
    );
  });

  it("Goal built-in 仍固定顯示為 locked", () => {
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => []) },
      runtimeService: { getRuntimeSnapshot: vi.fn(() => null) },
    });

    const availability = service.listForPod(createPod());
    const goalItem = availability.find((entry) => entry.name === GOAL_MCP_SERVER_NAME);

    expect(goalItem).toEqual(
      expect.objectContaining({
        system: true,
        locked: true,
        selected: true,
        selectable: false,
      }),
    );
  });

  it("不同 provider 看到的 selectable 狀態不同", () => {
    const sseEntry = createEntry({
      name: "remote-sse",
      transport: "sse",
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://remote-sse.example.com/mcp",
    });
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => [sseEntry]) },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => ({
          name: "remote-sse",
          transport: "sse",
          enabled: true,
          status: "healthy",
          lastError: null,
          dirty: false,
          pid: null,
          endpointUrl: "https://remote-sse.example.com/mcp",
        })),
      },
    });

    const claudeItem = service
      .listForPod(createPod({ provider: "claude" }))
      .find((entry) => entry.name === "remote-sse");
    const opencodeItem = service
      .listForPod(createPod({ provider: "opencode" }))
      .find((entry) => entry.name === "remote-sse");

    expect(claudeItem).toEqual(
      expect.objectContaining({
        selectable: false,
        disabledReason: "claude does not support sse transport",
      }),
    );
    expect(opencodeItem).toEqual(
      expect.objectContaining({
        selectable: true,
        disabledReason: null,
      }),
    );
  });
});
