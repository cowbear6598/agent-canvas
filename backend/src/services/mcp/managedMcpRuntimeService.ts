import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { getErrorMessage } from "../../utils/errorHelpers.js";
import {
  managedMcpStore,
  type ManagedMcpRuntimeStatus,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";

const PROBE_TIMEOUT_MS = 5000;

export interface ManagedMcpRuntimeSnapshot {
  name: string;
  transport: ManagedMcpTransport;
  enabled: boolean;
  status: ManagedMcpRuntimeStatus;
  lastError: string | null;
  dirty: boolean;
}

/**
 * Probe interface：對 entry 做 connect → listTools → close 的 alive check。
 *
 * 不持有 long-lived handle：實際 Run 期間的 MCP client 由 surface bridge 各自連線；
 * runtime service 的職責是 probe + 狀態追蹤 + 快取 probe 結果，
 * 避免同設定下被重複 probe（每個 Run 都要 ensureSurface）。
 */
export interface McpProbe {
  probe(entry: ManagedMcpServerRecord): Promise<void>;
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
}

interface ManagedMcpRuntimeServiceDeps {
  store: ManagedMcpStoreLike;
  probe: McpProbe;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class SdkMcpProbe implements McpProbe {
  async probe(entry: ManagedMcpServerRecord): Promise<void> {
    const client = new Client(
      { name: "agent-canvas-managed-mcp-probe", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport = this.createTransport(entry);

    try {
      await withTimeout(
        client.connect(transport),
        PROBE_TIMEOUT_MS,
        `${entry.name} probe connect 逾時（${PROBE_TIMEOUT_MS}ms）`,
      );
      await withTimeout(
        client.listTools(),
        PROBE_TIMEOUT_MS,
        `${entry.name} probe listTools 逾時（${PROBE_TIMEOUT_MS}ms）`,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private createTransport(
    entry: ManagedMcpServerRecord,
  ): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
    if (entry.transport === "stdio") {
      if (!entry.command) {
        throw new Error(`${entry.name} 缺少 stdio command`);
      }
      return new StdioClientTransport({
        command: entry.command,
        args: entry.args,
        env: {
          ...(process.env as Record<string, string>),
          ...entry.env,
        },
        cwd: entry.cwd ?? undefined,
        stderr: "ignore",
      });
    }

    if (!entry.url) {
      throw new Error(`${entry.name} 缺少 ${entry.transport} url`);
    }
    const url = new URL(entry.url);
    if (entry.transport === "sse") {
      return new SSEClientTransport(url);
    }
    return new StreamableHTTPClientTransport(url);
  }
}

export class ManagedMcpRuntimeService {
  private readonly runtimes = new Map<string, ManagedMcpRuntimeRecord>();

  constructor(private readonly deps: ManagedMcpRuntimeServiceDeps) {}

  private persistAndSnapshot(
    record: ManagedMcpRuntimeRecord,
  ): ManagedMcpRuntimeSnapshot {
    this.deps.store.updateRuntimeState(
      record.name,
      record.status,
      record.lastError,
    );
    this.runtimes.set(record.name, record);
    return this.toSnapshot(record);
  }

  private toSnapshot(
    record: ManagedMcpRuntimeRecord,
  ): ManagedMcpRuntimeSnapshot {
    return {
      name: record.name,
      transport: record.transport,
      enabled: record.enabled,
      status: record.status,
      lastError: record.lastError,
      dirty: record.dirty,
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
      ...overrides,
    };
  }

  async ensureReady(name: string): Promise<ManagedMcpRuntimeSnapshot> {
    const entry = this.deps.store.getByName(name);
    if (!entry) {
      this.runtimes.delete(name);
      throw new Error(`managed MCP not found: ${name}`);
    }

    if (!entry.enabled) {
      return this.persistAndSnapshot(
        this.buildRuntimeRecord(entry, {
          status: "disabled",
          dirty: false,
        }),
      );
    }

    // 已 probe 過且未 dirty → 直接重用快取，不重複 connect。
    const existing = this.runtimes.get(name);
    if (existing && !existing.dirty && existing.status === "healthy") {
      return this.toSnapshot(existing);
    }

    this.persistAndSnapshot(
      this.buildRuntimeRecord(entry, {
        status: "starting",
        lastError: null,
      }),
    );

    try {
      await this.deps.probe.probe(entry);
      return this.persistAndSnapshot(
        this.buildRuntimeRecord(entry, {
          status: "healthy",
          lastError: null,
          dirty: false,
        }),
      );
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
    if (runtime) return this.toSnapshot(runtime);

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
    // 沒有 long-lived handle 需要回收，僅 reset DB / 記憶體狀態。
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
    probe: deps?.probe ?? new SdkMcpProbe(),
  });
}

export const managedMcpRuntimeService = createManagedMcpRuntimeService();
