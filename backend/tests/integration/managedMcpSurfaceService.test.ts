import { beforeEach, describe, expect, it, vi } from "vitest";

import { initTestDb } from "../../src/database/index.js";
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
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";

// agent_canvas_plugin entry 永遠被 buildPodMcpEntries 注入；在不關心該 entry 的測試中過濾掉
function withoutPluginEntry(entries: PodMcpEntry[]): PodMcpEntry[] {
  return entries.filter((entry) => entry.name !== "agent_canvas_plugin");
}

function createPod(
  overrides: Partial<
    Pick<
      Pod,
      "id" | "name" | "provider" | "goal" | "mcpServerNames" | "pluginIds"
    >
  > = {},
): Pick<
  Pod,
  "id" | "name" | "provider" | "goal" | "mcpServerNames" | "pluginIds"
> {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Pod Entries Test",
    provider: overrides.provider ?? "codex",
    goal: overrides.goal ?? null,
    mcpServerNames: overrides.mcpServerNames ?? [],
    pluginIds: overrides.pluginIds ?? [],
  };
}

function createRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: overrides.runId ?? "run-entries-1",
    canvasId: overrides.canvasId ?? "canvas-entries-1",
    sourcePodId: overrides.sourcePodId ?? "pod-1",
  };
}

describe("ManagedMcpSurfaceService.buildPodMcpEntries", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  it("沒勾選 managed MCP + 無 runContext → 回空 entries / hasGoalRuntime=false", async () => {
    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({ id: "pod-empty", mcpServerNames: [] });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    expect(withoutPluginEntry(result.entries)).toEqual([]);
    expect(result.hasGoalRuntime).toBe(false);
    expect(result.ignoredTargets).toEqual([]);
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it("stdio target 注入為原生 stdio entry（無 proxy bridge 包裝）", async () => {
    managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      env: { FS_ROOT: "/tmp" },
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-stdio",
      provider: "claude",
      mcpServerNames: ["filesystem"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    const userEntries = withoutPluginEntry(result.entries);
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0]).toMatchObject({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      env: { FS_ROOT: "/tmp" },
      proxied: false,
    });
  });

  it("Claude pod 勾 http target → 包成 per-MCP proxy bridge stdio entry", async () => {
    managedMcpStore.save({
      name: "remote-mcp",
      transport: "http",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-claude-http",
      provider: "claude",
      mcpServerNames: ["remote-mcp"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    const userEntries = withoutPluginEntry(result.entries);
    expect(userEntries).toHaveLength(1);
    const entry = userEntries[0];
    expect(entry).toMatchObject({
      name: "remote-mcp",
      transport: "stdio",
      proxied: true,
      env: {
        AGENT_CANVAS_MCP_PROXY_NAME: "remote-mcp",
        AGENT_CANVAS_MCP_PROXY_TRANSPORT: "http",
        AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/mcp",
      },
    });
    // bridge args 應指向 managedMcpProxyBridge.ts
    if (entry?.transport === "stdio") {
      expect(entry.args[0]).toContain("managedMcpProxyBridge");
    }
  });

  it("Codex pod 勾 http target → 原生 http entry（不包 bridge）", async () => {
    managedMcpStore.save({
      name: "remote-mcp",
      transport: "http",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-codex-http",
      provider: "codex",
      mcpServerNames: ["remote-mcp"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    expect(withoutPluginEntry(result.entries)).toEqual([
      {
        name: "remote-mcp",
        transport: "http",
        url: "https://example.com/mcp",
      },
    ]);
  });

  it("Opencode pod 勾 sse target → 原生 sse entry（opencode 原生支援）", async () => {
    managedMcpStore.save({
      name: "remote-sse",
      transport: "sse",
      url: "https://example.com/sse",
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-opencode-sse",
      provider: "opencode",
      mcpServerNames: ["remote-sse"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    expect(withoutPluginEntry(result.entries)).toEqual([
      {
        name: "remote-sse",
        transport: "sse",
        url: "https://example.com/sse",
      },
    ]);
  });

  it("Codex pod 勾 sse target → codex 不原生支援，回退到 per-MCP proxy bridge", async () => {
    managedMcpStore.save({
      name: "remote-sse",
      transport: "sse",
      url: "https://example.com/sse",
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-codex-sse",
      provider: "codex",
      mcpServerNames: ["remote-sse"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    expect(withoutPluginEntry(result.entries)[0]).toMatchObject({
      name: "remote-sse",
      transport: "stdio",
      proxied: true,
      env: {
        AGENT_CANVAS_MCP_PROXY_TRANSPORT: "sse",
        AGENT_CANVAS_MCP_PROXY_URL: "https://example.com/sse",
      },
    });
  });

  it("Run 模式 + pod.goal 有 todos → entries 首位為 Goal Runtime、hasGoalRuntime=true", async () => {
    managedMcpStore.save({
      name: "team-server",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-with-goal",
      provider: "claude",
      mcpServerNames: ["team-server"],
      goal: {
        todos: [{ id: "todo-1", text: "Do a thing" }],
      } as any,
    });
    const result = await surfaceService.buildPodMcpEntries(
      pod,
      createRunContext({ runId: "run-goal-1", sourcePodId: pod.id }),
    );

    expect(result.hasGoalRuntime).toBe(true);
    expect(result.entries[0]?.name).toBe("agent_canvas_goal");
    // entries[1] 為自動注入的 agent_canvas_plugin，entries[2] 才是使用者指定的 team-server
    expect(result.entries[1]?.name).toBe("agent_canvas_plugin");
    expect(result.entries[2]?.name).toBe("team-server");
  });

  it("registry 不存在 / disabled / runtime 不 healthy → 進 ignoredTargets 並附 reason", async () => {
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

    const probe: McpProbe = {
      probe: vi.fn().mockImplementation((entry) => {
        if (entry.name === "broken-server") {
          return Promise.reject(new Error("connect timeout"));
        }
        return Promise.resolve(undefined);
      }),
    };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-ignored",
      provider: "claude",
      mcpServerNames: ["missing-server", "disabled-server", "broken-server"],
    });
    const result = await surfaceService.buildPodMcpEntries(pod, null);

    expect(withoutPluginEntry(result.entries)).toEqual([]);
    expect(result.ignoredTargets).toEqual([
      { name: "missing-server", reason: "registry entry removed" },
      { name: "disabled-server", reason: "registry entry disabled" },
      expect.objectContaining({
        name: "broken-server",
        reason: expect.stringContaining("connect timeout"),
      }),
    ]);
  });

  it("registry 更新後再呼叫 buildPodMcpEntries 應使用新設定（不快取）", async () => {
    const saved = managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      enabled: true,
    });

    const probe: McpProbe = { probe: vi.fn().mockResolvedValue(undefined) };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      probe,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

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
    expect(withoutPluginEntry(second.entries)[0]).toMatchObject({
      name: "filesystem",
      command: "node",
      args: ["new-filesystem-server.js"],
    });
  });
});
