import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

import { buildGoalRuntimeMcpServerConfig } from "../goalRuntime.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { logger } from "../../utils/logger.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import {
  managedMcpStore,
  type ManagedMcpRuntimeStatus,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";
import {
  managedMcpRuntimeService,
  type ManagedMcpRuntimeService,
} from "./managedMcpRuntimeService.js";

export const AGENT_CANVAS_MANAGED_SURFACE_NAME = "agent_canvas_managed_surface";

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
  updateRuntimeState(
    name: string,
    status: ManagedMcpRuntimeStatus,
    lastError?: string | null,
  ): ManagedMcpServerRecord | undefined;
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
  return path.join(
    getManagedMcpSurfaceRunDir(runContext.runId),
    `${podId}.json`,
  );
}

/**
 * 由 state file 路徑換算對應的 errors file 路徑。
 * bridge 在 connect/listTools 失敗時會把 per-target 錯誤寫進此檔，
 * surface cleanup 時讀取並把錯誤回寫 managedMcpStore.lastError，
 * 讓使用者在 Header modal 看得到原因。
 */
export function getManagedMcpSurfaceErrorsPath(statePath: string): string {
  return statePath.replace(/\.json$/, ".errors.json");
}

/** bridge 寫入的 per-target 錯誤紀錄。 */
export interface ManagedMcpSurfaceTargetError {
  name: string;
  message: string;
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

function toSurfaceTarget(
  entry: ManagedMcpServerRecord,
): ManagedMcpSurfaceTarget {
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

    // 通知前端：本次 ensureSurface 略過了哪些 selected MCP（含原因），
    // 讓使用者在 chat / run 啟動時看見「我選了但沒生效」的清單。
    if (ignoredTargets.length > 0) {
      socketService.emitToAll(
        WebSocketResponseEvents.MANAGED_MCP_SURFACE_TARGETS_IGNORED,
        {
          success: true,
          runId: runContext.runId,
          podId: pod.id,
          podName: pod.name,
          ignored: ignoredTargets,
        },
      );
    }

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

    // 在刪掉 state file 之前先把 bridge 寫的 per-target 錯誤回寫 store，
    // 否則 lastError 永遠停在 bridge 啟動前的舊狀態，使用者看不到原因。
    const errorsApplied = await this.applyBridgeErrors(statePaths);

    await Promise.all(
      statePaths.map(async (statePath) => {
        await fs.rm(statePath, { force: true });
        await fs.rm(getManagedMcpSurfaceErrorsPath(statePath), { force: true });
      }),
    );

    await fs.rm(getManagedMcpSurfaceRunDir(runId), {
      recursive: true,
      force: true,
    });

    if (errorsApplied) {
      // 廣播 registry updated，讓前端 cache 失效並重抓最新 lastError。
      socketService.emitToAll(
        WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
        {
          success: true,
          action: "diagnostics",
          runId,
        },
      );
    }
  }

  /**
   * 讀取 bridge 寫進每個 statePath 對應 errors.json 的 per-target 錯誤，
   * 將其回寫到 managedMcpStore.lastKnownStatus / lastError。
   * 回傳 true 表示至少更新了一筆，呼叫端可據此決定是否廣播。
   */
  private async applyBridgeErrors(statePaths: string[]): Promise<boolean> {
    let touched = false;

    for (const statePath of statePaths) {
      const errorsPath = getManagedMcpSurfaceErrorsPath(statePath);
      let raw: string;
      try {
        raw = await fs.readFile(errorsPath, "utf-8");
      } catch {
        continue; // bridge 沒寫錯誤檔代表全部 target connect 成功
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.warn(
          "McpServer",
          "Warn",
          `managed MCP surface errors.json 解析失敗：${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      if (!Array.isArray(parsed)) continue;

      for (const item of parsed as ManagedMcpSurfaceTargetError[]) {
        if (
          !item ||
          typeof item.name !== "string" ||
          typeof item.message !== "string"
        ) {
          continue;
        }
        // Goal Runtime built-in 不存在於 registry，更新會 no-op；
        // 一般 entry 才會真的被回寫。
        const updated = this.deps.store.updateRuntimeState(
          item.name,
          "error",
          item.message,
        );
        if (updated) touched = true;
      }
    }

    return touched;
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
