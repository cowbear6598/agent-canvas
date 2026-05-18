import { beforeEach, describe, expect, it, vi } from "vitest";

import { initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import {
  createManagedMcpRuntimeService,
  type McpProcessLauncher,
  type McpRemoteConnector,
} from "../../src/services/mcp/managedMcpRuntimeService.js";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";
import {
  createManagedMcpSurfaceService,
  getManagedMcpSurfaceStatePath,
  readManagedMcpSurfaceState,
} from "../../src/services/mcp/managedMcpSurfaceService.js";
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";

function createPod(
  overrides: Partial<Pick<Pod, "id" | "name" | "provider" | "goal" | "mcpServerNames">> = {},
): Pick<Pod, "id" | "name" | "provider" | "goal" | "mcpServerNames"> {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Managed Surface Pod",
    provider: overrides.provider ?? "codex",
    goal: overrides.goal ?? null,
    mcpServerNames: overrides.mcpServerNames ?? [],
  };
}

function createRunContext(
  overrides: Partial<RunContext> = {},
): RunContext {
  return {
    runId: overrides.runId ?? "run-managed-surface-1",
    canvasId: overrides.canvasId ?? "canvas-managed-surface-1",
    sourcePodId: overrides.sourcePodId ?? "pod-1",
  };
}

describe("ManagedMcpSurfaceService", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  it("兩個 Pod 選不同 subset 時各自只看到自己的 MCP", async () => {
    managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      enabled: true,
    });
    managedMcpStore.save({
      name: "context7",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-context7"],
      enabled: true,
    });

    const processLauncher: McpProcessLauncher = {
      launch: vi
        .fn()
        .mockResolvedValue({ pid: 1111, close: vi.fn() })
        .mockResolvedValueOnce({ pid: 1111, close: vi.fn() })
        .mockResolvedValueOnce({ pid: 2222, close: vi.fn() }),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      processLauncher,
      remoteConnector,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const runContext = createRunContext();
    const podA = createPod({
      id: "pod-a",
      name: "Pod A",
      mcpServerNames: ["filesystem"],
    });
    const podB = createPod({
      id: "pod-b",
      name: "Pod B",
      mcpServerNames: ["context7"],
    });

    await surfaceService.ensureSurface(runContext, podA);
    await surfaceService.ensureSurface(runContext, podB);

    const stateA = await readManagedMcpSurfaceState(
      getManagedMcpSurfaceStatePath(runContext, podA.id),
    );
    const stateB = await readManagedMcpSurfaceState(
      getManagedMcpSurfaceStatePath(runContext, podB.id),
    );

    expect(stateA?.targets.map((target) => target.name)).toEqual([
      "agent_canvas_goal",
      "filesystem",
    ]);
    expect(stateB?.targets.map((target) => target.name)).toEqual([
      "agent_canvas_goal",
      "context7",
    ]);
  });

  it("registry 更新後下一次 run 會使用新 surface", async () => {
    const saved = managedMcpStore.save({
      name: "filesystem",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-filesystem"],
      enabled: true,
    });

    const processLauncher: McpProcessLauncher = {
      launch: vi
        .fn()
        .mockResolvedValue({ pid: 3001, close: vi.fn() })
        .mockResolvedValueOnce({ pid: 3001, close: vi.fn() })
        .mockResolvedValueOnce({ pid: 3002, close: vi.fn() }),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      processLauncher,
      remoteConnector,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-registry-update",
      mcpServerNames: ["filesystem"],
    });
    const firstRun = createRunContext({
      runId: "run-managed-surface-old",
      sourcePodId: pod.id,
    });

    await surfaceService.ensureSurface(firstRun, pod);
    const firstState = await readManagedMcpSurfaceState(
      getManagedMcpSurfaceStatePath(firstRun, pod.id),
    );

    managedMcpStore.save({
      id: saved.id,
      name: "filesystem",
      transport: "stdio",
      command: "node",
      args: ["new-filesystem-server.js"],
      enabled: true,
    });
    await runtimeService.markConfigDirty("filesystem");

    const secondRun = createRunContext({
      runId: "run-managed-surface-new",
      sourcePodId: pod.id,
    });
    await surfaceService.ensureSurface(secondRun, pod);
    const secondState = await readManagedMcpSurfaceState(
      getManagedMcpSurfaceStatePath(secondRun, pod.id),
    );

    expect(
      firstState?.targets.find((target) => target.name === "filesystem")
        ?.command,
    ).toBe("uvx");
    expect(
      secondState?.targets.find((target) => target.name === "filesystem")
        ?.command,
    ).toBe("node");
    expect(
      secondState?.targets.find((target) => target.name === "filesystem")
        ?.args,
    ).toEqual(["new-filesystem-server.js"]);
  });

  it("run 結束後 surface 被回收但 child runtime 仍可重用", async () => {
    managedMcpStore.save({
      name: "context7",
      transport: "stdio",
      command: "uvx",
      args: ["mcp-server-context7"],
      enabled: true,
    });

    const processLauncher: McpProcessLauncher = {
      launch: vi.fn().mockResolvedValue({ pid: 4001, close: vi.fn() }),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const runtimeService = createManagedMcpRuntimeService({
      store: managedMcpStore,
      processLauncher,
      remoteConnector,
    });
    const surfaceService = createManagedMcpSurfaceService({
      store: managedMcpStore,
      runtimeService,
    });

    const pod = createPod({
      id: "pod-runtime-reuse",
      mcpServerNames: ["context7"],
    });
    const firstRun = createRunContext({
      runId: "run-surface-cleanup-1",
      sourcePodId: pod.id,
    });

    const firstSurface = await surfaceService.ensureSurface(firstRun, pod);
    await surfaceService.cleanupRunSurfaces(firstRun.runId);

    expect(
      await readManagedMcpSurfaceState(firstSurface.statePath),
    ).toBeNull();

    const secondRun = createRunContext({
      runId: "run-surface-cleanup-2",
      sourcePodId: pod.id,
    });
    await surfaceService.ensureSurface(secondRun, pod);

    expect(processLauncher.launch).toHaveBeenCalledTimes(1);
  });
});
