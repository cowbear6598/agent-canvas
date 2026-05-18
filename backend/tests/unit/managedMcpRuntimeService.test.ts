import { describe, expect, it, vi } from "vitest";
import {
  createManagedMcpRuntimeService,
  type McpProcessLauncher,
  type McpRemoteConnector,
} from "../../src/services/mcp/managedMcpRuntimeService.js";
import type {
  ManagedMcpRuntimeStatus,
  ManagedMcpServerRecord,
} from "../../src/services/mcp/managedMcpStore.js";

interface MockStore {
  list: ReturnType<typeof vi.fn>;
  getByName: ReturnType<typeof vi.fn>;
  updateRuntimeState: ReturnType<typeof vi.fn>;
}

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

function createMockStore(entries: ManagedMcpServerRecord[]): {
  store: MockStore;
  entryMap: Map<string, ManagedMcpServerRecord>;
} {
  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  const store = {
    list: vi.fn(() => [...entryMap.values()]),
    getByName: vi.fn((name: string) => entryMap.get(name)),
    updateRuntimeState: vi.fn(
      (
        name: string,
        status: ManagedMcpRuntimeStatus,
        lastError: string | null = null,
      ) => {
        const existing = entryMap.get(name);
        if (!existing) return undefined;
        const updated = {
          ...existing,
          lastKnownStatus: status,
          lastError,
        };
        entryMap.set(name, updated);
        return updated;
      },
    ),
  };

  return { store, entryMap };
}

describe("ManagedMcpRuntimeService", () => {
  it("已健康的 child 會跨 run 重用", async () => {
    const { store } = createMockStore([createEntry()]);
    const processHandle = { pid: 4321, close: vi.fn() };
    const processLauncher: McpProcessLauncher = {
      launch: vi.fn().mockResolvedValue(processHandle),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const service = createManagedMcpRuntimeService({
      store,
      processLauncher,
      remoteConnector,
    });

    const first = await service.ensureReady("context7");
    const second = await service.ensureReady("context7");

    expect(first.status).toBe("healthy");
    expect(second.status).toBe("healthy");
    expect(first.pid).toBe(4321);
    expect(second.pid).toBe(4321);
    expect(processLauncher.launch).toHaveBeenCalledTimes(1);
  });

  it("設定改動後會標記 dirty 並在下次 ensureReady 重建", async () => {
    const { store } = createMockStore([createEntry()]);
    const firstHandle = { pid: 1111, close: vi.fn() };
    const secondHandle = { pid: 2222, close: vi.fn() };
    const processLauncher: McpProcessLauncher = {
      launch: vi
        .fn()
        .mockResolvedValueOnce(firstHandle)
        .mockResolvedValueOnce(secondHandle),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const service = createManagedMcpRuntimeService({
      store,
      processLauncher,
      remoteConnector,
    });

    await service.ensureReady("context7");
    await service.markConfigDirty("context7");
    const rebuilt = await service.ensureReady("context7");

    expect(firstHandle.close).toHaveBeenCalledTimes(1);
    expect(processLauncher.launch).toHaveBeenCalledTimes(2);
    expect(rebuilt.pid).toBe(2222);
    expect(rebuilt.status).toBe("healthy");
  });

  it("stdio 啟動失敗會寫入 last_error", async () => {
    const { store } = createMockStore([
      createEntry({ name: "broken-stdio", command: "missing-binary" }),
    ]);
    const processLauncher: McpProcessLauncher = {
      launch: vi.fn().mockRejectedValue(new Error("spawn failed")),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi.fn(),
    };
    const service = createManagedMcpRuntimeService({
      store,
      processLauncher,
      remoteConnector,
    });

    const snapshot = await service.ensureReady("broken-stdio");

    expect(snapshot.status).toBe("error");
    expect(snapshot.lastError).toBe("spawn failed");
    expect(store.updateRuntimeState).toHaveBeenLastCalledWith(
      "broken-stdio",
      "error",
      "spawn failed",
    );
  });

  it("http/sse 連線失敗會反映為非 healthy 狀態", async () => {
    const { store } = createMockStore([
      createEntry({
        name: "remote-http",
        transport: "http",
        command: null,
        args: [],
        cwd: null,
        env: {},
        url: "https://remote-http.example.com/mcp",
      }),
      createEntry({
        id: "registry-2",
        name: "remote-sse",
        transport: "sse",
        command: null,
        args: [],
        cwd: null,
        env: {},
        url: "https://remote-sse.example.com/mcp",
      }),
    ]);
    const processLauncher: McpProcessLauncher = {
      launch: vi.fn(),
    };
    const remoteConnector: McpRemoteConnector = {
      connect: vi
        .fn()
        .mockRejectedValueOnce(new Error("http unavailable"))
        .mockRejectedValueOnce(new Error("sse unavailable")),
    };
    const service = createManagedMcpRuntimeService({
      store,
      processLauncher,
      remoteConnector,
    });

    const httpSnapshot = await service.ensureReady("remote-http");
    const sseSnapshot = await service.ensureReady("remote-sse");

    expect(httpSnapshot.status).toBe("error");
    expect(httpSnapshot.lastError).toBe("http unavailable");
    expect(sseSnapshot.status).toBe("error");
    expect(sseSnapshot.lastError).toBe("sse unavailable");
  });
});
