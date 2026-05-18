import { getErrorMessage } from "../../utils/errorHelpers.js";
import {
  managedMcpStore,
  type ManagedMcpRuntimeStatus,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";

export interface ManagedMcpProcessHandle {
  pid: number | null;
  close(): Promise<void> | void;
}

export interface ManagedMcpRemoteHandle {
  endpointUrl: string;
  close(): Promise<void> | void;
}

export interface McpProcessLauncher {
  launch(entry: ManagedMcpServerRecord): Promise<ManagedMcpProcessHandle>;
}

export interface McpRemoteConnector {
  connect(entry: ManagedMcpServerRecord): Promise<ManagedMcpRemoteHandle>;
}

export interface ManagedMcpRuntimeSnapshot {
  name: string;
  transport: ManagedMcpTransport;
  enabled: boolean;
  status: ManagedMcpRuntimeStatus;
  lastError: string | null;
  dirty: boolean;
  pid: number | null;
  endpointUrl: string | null;
}

interface ManagedMcpStoreLike {
  list(): ManagedMcpServerRecord[];
  getByName(name: string): ManagedMcpServerRecord | undefined;
  updateRuntimeState(
    name: string,
    status: ManagedMcpRuntimeStatus,
    lastError?: string | null,
  ): ManagedMcpServerRecord | undefined;
}

interface ManagedMcpRuntimeRecord {
  name: string;
  transport: ManagedMcpTransport;
  enabled: boolean;
  status: ManagedMcpRuntimeStatus;
  lastError: string | null;
  dirty: boolean;
  pid: number | null;
  endpointUrl: string | null;
  handle: ManagedMcpProcessHandle | ManagedMcpRemoteHandle | null;
}

interface ManagedMcpRuntimeServiceDeps {
  store: ManagedMcpStoreLike;
  processLauncher: McpProcessLauncher;
  remoteConnector: McpRemoteConnector;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BunMcpProcessLauncher implements McpProcessLauncher {
  async launch(entry: ManagedMcpServerRecord): Promise<ManagedMcpProcessHandle> {
    if (entry.transport !== "stdio" || !entry.command) {
      throw new Error(`${entry.name} is not a stdio MCP entry`);
    }

    const proc = Bun.spawn([entry.command, ...entry.args], {
      cwd: entry.cwd ?? undefined,
      env: { ...process.env, ...entry.env },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    const quickExit = await Promise.race([
      proc.exited.then((exitCode) => exitCode),
      delay(75).then(() => null),
    ]);

    if (typeof quickExit === "number") {
      try {
        proc.kill();
      } catch {
        // process 已退出時忽略 kill 例外
      }
      throw new Error(
        `stdio MCP exited before ready (exit code ${quickExit})`,
      );
    }

    return {
      pid: proc.pid ?? null,
      close(): void {
        try {
          proc.kill();
        } catch {
          // 關閉時忽略已退出進程
        }
      },
    };
  }
}

class FetchMcpRemoteConnector implements McpRemoteConnector {
  async connect(entry: ManagedMcpServerRecord): Promise<ManagedMcpRemoteHandle> {
    if ((entry.transport === "http" || entry.transport === "sse") && !entry.url) {
      throw new Error(`${entry.name} is missing remote MCP url`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(entry.url!, {
        method: "GET",
        signal: controller.signal,
        headers:
          entry.transport === "sse"
            ? { Accept: "text/event-stream" }
            : undefined,
      });

      if (!response.ok) {
        throw new Error(`remote MCP responded with HTTP ${response.status}`);
      }

      await response.body?.cancel().catch(() => undefined);

      return {
        endpointUrl: entry.url!,
        close(): void {
          controller.abort();
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ManagedMcpRuntimeService {
  private readonly runtimes = new Map<string, ManagedMcpRuntimeRecord>();

  constructor(private readonly deps: ManagedMcpRuntimeServiceDeps) {}

  private persistAndSnapshot(
    record: ManagedMcpRuntimeRecord,
  ): ManagedMcpRuntimeSnapshot {
    this.deps.store.updateRuntimeState(record.name, record.status, record.lastError);
    this.runtimes.set(record.name, record);
    return this.toSnapshot(record);
  }

  private toSnapshot(record: ManagedMcpRuntimeRecord): ManagedMcpRuntimeSnapshot {
    return {
      name: record.name,
      transport: record.transport,
      enabled: record.enabled,
      status: record.status,
      lastError: record.lastError,
      dirty: record.dirty,
      pid: record.pid,
      endpointUrl: record.endpointUrl,
    };
  }

  private buildRuntimeRecord(
    entry: ManagedMcpServerRecord,
    overrides: Partial<ManagedMcpRuntimeRecord> = {},
  ): ManagedMcpRuntimeRecord {
    return {
      name: entry.name,
      transport: entry.transport,
      enabled: entry.enabled,
      status: entry.enabled ? "idle" : "disabled",
      lastError: entry.lastError,
      dirty: false,
      pid: null,
      endpointUrl: null,
      handle: null,
      ...overrides,
    };
  }

  private async closeRuntimeHandle(name: string): Promise<void> {
    const runtime = this.runtimes.get(name);
    if (!runtime?.handle) return;
    await runtime.handle.close();
    runtime.handle = null;
    runtime.pid = null;
    runtime.endpointUrl = null;
  }

  private createProcessRuntime(
    entry: ManagedMcpServerRecord,
    handle: ManagedMcpProcessHandle,
  ): ManagedMcpRuntimeRecord {
    return this.buildRuntimeRecord(entry, {
      status: "healthy",
      lastError: null,
      dirty: false,
      pid: handle.pid,
      handle,
    });
  }

  private createRemoteRuntime(
    entry: ManagedMcpServerRecord,
    handle: ManagedMcpRemoteHandle,
  ): ManagedMcpRuntimeRecord {
    return this.buildRuntimeRecord(entry, {
      status: "healthy",
      lastError: null,
      dirty: false,
      endpointUrl: handle.endpointUrl,
      handle,
    });
  }

  async ensureReady(name: string): Promise<ManagedMcpRuntimeSnapshot> {
    const entry = this.deps.store.getByName(name);
    if (!entry) {
      await this.closeRuntimeHandle(name);
      this.runtimes.delete(name);
      throw new Error(`managed MCP not found: ${name}`);
    }

    if (!entry.enabled) {
      await this.closeRuntimeHandle(name);
      return this.persistAndSnapshot(
        this.buildRuntimeRecord(entry, {
          status: "disabled",
          dirty: false,
        }),
      );
    }

    const existing = this.runtimes.get(name);
    if (existing && !existing.dirty && existing.status === "healthy") {
      return this.toSnapshot(existing);
    }

    await this.closeRuntimeHandle(name);
    this.persistAndSnapshot(
      this.buildRuntimeRecord(entry, {
        status: "starting",
        lastError: null,
      }),
    );

    try {
      const runtime =
        entry.transport === "stdio"
          ? this.createProcessRuntime(
              entry,
              await this.deps.processLauncher.launch(entry),
            )
          : this.createRemoteRuntime(
              entry,
              await this.deps.remoteConnector.connect(entry),
            );

      return this.persistAndSnapshot(runtime);
    } catch (error) {
      return this.persistAndSnapshot(
        this.buildRuntimeRecord(entry, {
          status: "error",
          lastError: getErrorMessage(error),
          dirty: false,
        }),
      );
    }
  }

  async markConfigDirty(name: string): Promise<void> {
    const entry = this.deps.store.getByName(name);
    await this.closeRuntimeHandle(name);

    if (!entry) {
      this.runtimes.delete(name);
      return;
    }

    this.persistAndSnapshot(
      this.buildRuntimeRecord(entry, {
        status: entry.enabled ? "idle" : "disabled",
        dirty: true,
      }),
    );
  }

  getRuntimeSnapshot(name: string): ManagedMcpRuntimeSnapshot | null {
    const runtime = this.runtimes.get(name);
    if (runtime) {
      return this.toSnapshot(runtime);
    }

    const entry = this.deps.store.getByName(name);
    if (!entry) return null;

    return this.toSnapshot(
      this.buildRuntimeRecord(entry, {
        status: entry.enabled ? entry.lastKnownStatus : "disabled",
      }),
    );
  }

  restoreInitialStatuses(): void {
    for (const entry of this.deps.store.list()) {
      this.persistAndSnapshot(
        this.buildRuntimeRecord(entry, {
          status: entry.enabled ? "idle" : "disabled",
        }),
      );
    }
  }

  async shutdownAll(): Promise<void> {
    const runtimeNames = [...this.runtimes.keys()];
    await Promise.all(runtimeNames.map((name) => this.closeRuntimeHandle(name)));

    for (const entry of this.deps.store.list()) {
      this.deps.store.updateRuntimeState(
        entry.name,
        entry.enabled ? "idle" : "disabled",
        entry.lastError,
      );
    }

    this.runtimes.clear();
  }
}

export function createManagedMcpRuntimeService(
  deps?: Partial<ManagedMcpRuntimeServiceDeps>,
): ManagedMcpRuntimeService {
  return new ManagedMcpRuntimeService({
    store: deps?.store ?? managedMcpStore,
    processLauncher: deps?.processLauncher ?? new BunMcpProcessLauncher(),
    remoteConnector: deps?.remoteConnector ?? new FetchMcpRemoteConnector(),
  });
}

export const managedMcpRuntimeService = createManagedMcpRuntimeService();
