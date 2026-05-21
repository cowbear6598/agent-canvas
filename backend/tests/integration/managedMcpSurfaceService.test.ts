import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import {
  createManagedMcpRuntimeService,
  type McpProbe,
} from "../../src/services/mcp/managedMcpRuntimeService.js";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";
import {
  createManagedMcpSurfaceService,
  type PodMcpEntry,
} from "../../src/services/mcp/managedMcpSurfaceService.js";
import { WebSocketResponseEvents } from "../../src/schemas/events.js";
import { socketService } from "../../src/services/socketService.js";
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";
import "../../src/services/integration/providers/index.js";

function withoutPluginEntry(entries: PodMcpEntry[]): PodMcpEntry[] {
  return entries.filter(
    (entry) =>
      entry.name !== "agent_canvas_plugin" &&
      entry.name !== "agent_canvas_goal",
  );
}

function createPod(
  overrides: Partial<
    Pick<
      Pod,
      | "id"
      | "name"
      | "provider"
      | "goal"
      | "mcpServerNames"
      | "pluginIds"
      | "integrationBindings"
    >
  > = {},
): Pick<
  Pod,
  | "id"
  | "name"
  | "provider"
  | "goal"
  | "mcpServerNames"
  | "pluginIds"
  | "integrationBindings"
> {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Managed MCP Pod",
    provider: overrides.provider ?? "codex",
    goal: overrides.goal ?? null,
    mcpServerNames: overrides.mcpServerNames ?? [],
    pluginIds: overrides.pluginIds ?? [],
    integrationBindings: overrides.integrationBindings ?? [],
  };
}

function createRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: overrides.runId ?? "run-managed-mcp-1",
    canvasId: overrides.canvasId ?? "canvas-managed-mcp-1",
    sourcePodId: overrides.sourcePodId ?? "pod-1",
  };
}

function createSurface(probe: McpProbe) {
  const runtimeService = createManagedMcpRuntimeService({
    store: managedMcpStore,
    probe,
  });
  const surfaceService = createManagedMcpSurfaceService({
    store: managedMcpStore,
    runtimeService,
  });
  return { runtimeService, surfaceService };
}

describe("ManagedMcpSurfaceService provider surface integration", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
  });

  it("啟用的 managed MCP 會透過真 store 與 runtime service 產生 run provider surface", async () => {
    managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      cwd: "/workspace",
      env: { FS_ROOT: "/workspace" },
      enabled: true,
    });
    managedMcpStore.save({
      name: "remote-docs",
      transport: "http",
      url: "https://example.com/mcp",
      enabled: true,
    });
    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const { surfaceService } = createSurface(probe);

    const pod = createPod({
      id: "pod-run-surface",
      provider: "claude",
      goal: { todos: [{ id: "todo-1", text: "Use selected MCP" }] } as any,
      mcpServerNames: ["filesystem", "remote-docs"],
    });
    const result = await surfaceService.buildPodMcpEntries(
      pod,
      createRunContext({ sourcePodId: pod.id }),
    );

    expect(probe.probe).toHaveBeenCalledTimes(2);
    expect(result.hasGoalRuntime).toBe(true);
    expect(result.ignoredTargets).toEqual([]);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "agent_canvas_goal",
      "agent_canvas_plugin",
      "filesystem",
      "remote-docs",
    ]);
    expect(result.entries[2]).toMatchObject({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      cwd: "/workspace",
      env: { FS_ROOT: "/workspace" },
      proxied: false,
    });
    expect(result.entries[3]).toMatchObject({
      name: "remote-docs",
      transport: "stdio",
      proxied: true,
      env: {
        AGENT_CANVAS_MCP_PROXY_NAME: "remote-docs",
        AGENT_CANVAS_MCP_PROXY_TRANSPORT: "http",
        AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/mcp",
      },
    });
    expect(managedMcpStore.getByName("filesystem")?.lastKnownStatus).toBe(
      "healthy",
    );
    expect(managedMcpStore.getByName("remote-docs")?.lastKnownStatus).toBe(
      "healthy",
    );
  });

  it("不同 provider 會依 native transport support 產生 remote 或 proxy entry", async () => {
    managedMcpStore.save({
      name: "remote-http",
      transport: "http",
      url: "https://example.com/http",
      enabled: true,
    });
    managedMcpStore.save({
      name: "remote-sse",
      transport: "sse",
      url: "https://example.com/sse",
      enabled: true,
    });
    const { surfaceService } = createSurface({
      probe: vi.fn().mockResolvedValue(undefined),
    });

    const codexResult = await surfaceService.buildPodMcpEntries(
      createPod({
        id: "pod-codex",
        provider: "codex",
        mcpServerNames: ["remote-http", "remote-sse"],
      }),
      null,
    );
    expect(withoutPluginEntry(codexResult.entries)).toEqual([
      {
        name: "remote-http",
        transport: "http",
        url: "https://example.com/http",
      },
      expect.objectContaining({
        name: "remote-sse",
        transport: "stdio",
        proxied: true,
        env: expect.objectContaining({
          AGENT_CANVAS_MCP_PROXY_TRANSPORT: "sse",
          AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/sse",
        }),
      }),
    ]);

    const opencodeResult = await surfaceService.buildPodMcpEntries(
      createPod({
        id: "pod-opencode",
        provider: "opencode",
        mcpServerNames: ["remote-http", "remote-sse"],
      }),
      null,
    );
    expect(withoutPluginEntry(opencodeResult.entries)).toEqual([
      {
        name: "remote-http",
        transport: "http",
        url: "https://example.com/http",
      },
      {
        name: "remote-sse",
        transport: "sse",
        url: "https://example.com/sse",
      },
    ]);
  });

  it("外部 MCP 失敗時不注入 provider surface，並在 run 模式通知 ignored target", async () => {
    managedMcpStore.save({
      name: "disabled-server",
      transport: "stdio",
      command: "uvx",
      args: [],
      enabled: false,
    });
    managedMcpStore.save({
      name: "broken-server",
      transport: "stdio",
      command: "uvx",
      args: [],
      enabled: true,
    });
    const emitSpy = vi
      .spyOn(socketService, "emitToAll")
      .mockImplementation(() => undefined);
    const { surfaceService } = createSurface({
      probe: vi.fn().mockRejectedValue(new Error("connect timeout")),
    });

    const pod = createPod({
      id: "pod-ignored",
      name: "MCP Failure Pod",
      provider: "claude",
      mcpServerNames: ["missing-server", "disabled-server", "broken-server"],
    });
    const runContext = createRunContext({ runId: "run-ignored-1" });
    const result = await surfaceService.buildPodMcpEntries(pod, runContext);

    expect(withoutPluginEntry(result.entries)).toEqual([]);
    expect(result.ignoredTargets).toEqual([
      { name: "missing-server", reason: "registry entry removed" },
      { name: "disabled-server", reason: "registry entry disabled" },
      {
        name: "broken-server",
        reason: "connect timeout",
      },
    ]);
    expect(emitSpy).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_SURFACE_TARGETS_IGNORED,
      {
        success: true,
        runId: "run-ignored-1",
        podId: "pod-ignored",
        podName: "MCP Failure Pod",
        ignored: result.ignoredTargets,
      },
    );
    expect(managedMcpStore.getByName("broken-server")?.lastKnownStatus).toBe(
      "error",
    );
    expect(managedMcpStore.getByName("broken-server")?.lastError).toBe(
      "connect timeout",
    );
  });

  it("registry 更新後重新標記 dirty，下一次 surface 會使用真 store 的新設定", async () => {
    const saved = managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      enabled: true,
    });
    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const { runtimeService, surfaceService } = createSurface(probe);
    const pod = createPod({
      id: "pod-registry-update",
      provider: "claude",
      mcpServerNames: ["filesystem"],
    });

    const first = await surfaceService.buildPodMcpEntries(pod, null);
    expect(withoutPluginEntry(first.entries)[0]).toMatchObject({
      name: "filesystem",
      command: "uvx",
    });

    managedMcpStore.save({
      id: saved.id,
      name: "filesystem",
      transport: "stdio",
      command: "node",
      args: ["new-filesystem-server.js"],
      enabled: true,
    });
    await runtimeService.markConfigDirty("filesystem");
    const second = await surfaceService.buildPodMcpEntries(pod, null);

    expect(probe.probe).toHaveBeenCalledTimes(2);
    expect(withoutPluginEntry(second.entries)[0]).toMatchObject({
      name: "filesystem",
      command: "node",
      args: ["new-filesystem-server.js"],
    });
  });
});
