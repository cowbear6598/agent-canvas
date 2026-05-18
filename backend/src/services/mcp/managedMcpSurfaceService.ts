import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

import { buildGoalRuntimeMcpServerConfig } from "../goalRuntime.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";
import {
  managedMcpRuntimeService,
  type ManagedMcpRuntimeService,
} from "./managedMcpRuntimeService.js";

export const AGENT_CANVAS_MANAGED_SURFACE_NAME =
  "agent_canvas_managed_surface";

type SupportedProvider = "claude" | "codex" | "opencode";

const TRANSPORT_SUPPORT: Record<
  SupportedProvider,
  ReadonlySet<ManagedMcpTransport>
> = {
  claude: new Set(["stdio"]),
  codex: new Set(["stdio", "http"]),
  opencode: new Set(["stdio", "http", "sse"]),
};

export interface ManagedMcpSurfaceServerConfig {
  name: typeof AGENT_CANVAS_MANAGED_SURFACE_NAME;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ManagedMcpSurfaceTarget {
  name: string;
  transport: ManagedMcpTransport;
  command: string | null;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  url: string | null;
  system: boolean;
}

export interface ManagedMcpSurfaceIgnoredTarget {
  name: string;
  reason: string;
}

export interface ManagedMcpSurfaceState {
  runId: string;
  podId: string;
  targets: ManagedMcpSurfaceTarget[];
}

export interface ManagedMcpSurfaceDescriptor {
  runId: string;
  podId: string;
  provider: SupportedProvider;
  sourceNames: string[];
  targetNames: string[];
  ignoredTargets: ManagedMcpSurfaceIgnoredTarget[];
  hasGoalRuntime: boolean;
  statePath: string;
  mcpServer: ManagedMcpSurfaceServerConfig;
}

interface ManagedMcpStoreLike {
  getByName(name: string): ManagedMcpServerRecord | undefined;
}

interface ManagedMcpSurfaceServiceDeps {
  store: ManagedMcpStoreLike;
  runtimeService: ManagedMcpRuntimeService;
}

function getManagedSurfaceBridgePath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "managedMcpSurfaceBridge.ts",
  );
}

function providerSupportsTransport(
  provider: SupportedProvider,
  transport: ManagedMcpTransport,
): boolean {
  return TRANSPORT_SUPPORT[provider].has(transport);
}

function getManagedMcpSurfaceRootDir(): string {
  return path.join(os.tmpdir(), "agent-canvas-managed-mcp-surface");
}

export function getManagedMcpSurfaceRunDir(runId: string): string {
  return path.join(getManagedMcpSurfaceRootDir(), runId);
}

export function getManagedMcpSurfaceStatePath(
  runContext: RunContext,
  podId: string,
): string {
  return path.join(getManagedMcpSurfaceRunDir(runContext.runId), `${podId}.json`);
}

async function ensureSurfaceDir(statePath: string): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
}

export async function writeManagedMcpSurfaceState(
  statePath: string,
  state: ManagedMcpSurfaceState,
): Promise<void> {
  await ensureSurfaceDir(statePath);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function readManagedMcpSurfaceState(
  statePath: string,
): Promise<ManagedMcpSurfaceState | null> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as ManagedMcpSurfaceState;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.targets) ||
      typeof parsed.runId !== "string" ||
      typeof parsed.podId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toSurfaceTarget(entry: ManagedMcpServerRecord): ManagedMcpSurfaceTarget {
  return {
    name: entry.name,
    transport: entry.transport,
    command: entry.command,
    args: [...entry.args],
    cwd: entry.cwd,
    env: { ...entry.env },
    url: entry.url,
    system: false,
  };
}

function resolveIgnoredReason(
  provider: SupportedProvider,
  entry: ManagedMcpServerRecord | undefined,
): string | null {
  if (!entry) return "registry entry removed";
  if (!entry.enabled) return "registry entry disabled";
  if (!providerSupportsTransport(provider, entry.transport)) {
    return `${provider} does not support ${entry.transport} transport`;
  }
  return null;
}

export class ManagedMcpSurfaceService {
  private readonly descriptors = new Map<string, ManagedMcpSurfaceDescriptor>();

  constructor(private readonly deps: ManagedMcpSurfaceServiceDeps) {}

  private getDescriptorKey(runId: string, podId: string): string {
    return `${runId}:${podId}`;
  }

  getSurface(runId: string, podId: string): ManagedMcpSurfaceDescriptor | null {
    return this.descriptors.get(this.getDescriptorKey(runId, podId)) ?? null;
  }

  async ensureSurface(
    runContext: RunContext,
    pod: Pick<Pod, "id" | "name" | "provider" | "goal" | "mcpServerNames">,
  ): Promise<ManagedMcpSurfaceDescriptor> {
    const key = this.getDescriptorKey(runContext.runId, pod.id);
    const existing = this.descriptors.get(key);
    if (existing) return existing;

    const provider = pod.provider as SupportedProvider;
    const statePath = getManagedMcpSurfaceStatePath(runContext, pod.id);
    const targets: ManagedMcpSurfaceTarget[] = [];
    const ignoredTargets: ManagedMcpSurfaceIgnoredTarget[] = [];

    for (const selectedName of pod.mcpServerNames) {
      const entry = this.deps.store.getByName(selectedName);
      const ignoredReason = resolveIgnoredReason(provider, entry);
      if (ignoredReason) {
        ignoredTargets.push({ name: selectedName, reason: ignoredReason });
        continue;
      }

      const runtime = await this.deps.runtimeService.ensureReady(selectedName);
      if (runtime.status !== "healthy") {
        ignoredTargets.push({
          name: selectedName,
          reason: runtime.lastError ?? "managed MCP runtime is not healthy",
        });
        continue;
      }

      targets.push(toSurfaceTarget(entry!));
    }

    const goalRuntimeMcp = buildGoalRuntimeMcpServerConfig(runContext, pod);
    if (goalRuntimeMcp) {
      targets.unshift({
        name: goalRuntimeMcp.name,
        transport: "stdio",
        command: goalRuntimeMcp.command,
        args: [...goalRuntimeMcp.args],
        cwd: null,
        env: { ...goalRuntimeMcp.env },
        url: null,
        system: true,
      });
    }

    await writeManagedMcpSurfaceState(statePath, {
      runId: runContext.runId,
      podId: pod.id,
      targets,
    });

    const descriptor: ManagedMcpSurfaceDescriptor = {
      runId: runContext.runId,
      podId: pod.id,
      provider,
      sourceNames: [...pod.mcpServerNames],
      targetNames: targets.map((target) => target.name),
      ignoredTargets,
      hasGoalRuntime: goalRuntimeMcp !== null,
      statePath,
      mcpServer: {
        name: AGENT_CANVAS_MANAGED_SURFACE_NAME,
        command: process.execPath || "bun",
        args: [getManagedSurfaceBridgePath()],
        env: {
          AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH: statePath,
        },
      },
    };

    this.descriptors.set(key, descriptor);
    return descriptor;
  }

  async cleanupRunSurfaces(runId: string): Promise<void> {
    const prefix = `${runId}:`;
    const statePaths: string[] = [];

    for (const [key, descriptor] of this.descriptors.entries()) {
      if (!key.startsWith(prefix)) continue;
      statePaths.push(descriptor.statePath);
      this.descriptors.delete(key);
    }

    await Promise.all(
      statePaths.map(async (statePath) => {
        await fs.rm(statePath, { force: true });
      }),
    );

    await fs.rm(getManagedMcpSurfaceRunDir(runId), {
      recursive: true,
      force: true,
    });
  }
}

export function createManagedMcpSurfaceService(
  deps?: Partial<ManagedMcpSurfaceServiceDeps>,
): ManagedMcpSurfaceService {
  return new ManagedMcpSurfaceService({
    store: deps?.store ?? managedMcpStore,
    runtimeService: deps?.runtimeService ?? managedMcpRuntimeService,
  });
}

export const managedMcpSurfaceService = createManagedMcpSurfaceService();
