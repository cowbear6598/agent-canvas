import { describe, expect, it, vi } from "vitest";
import {
  createManagedMcpRuntimeService,
  type McpProbe,
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
  const store: MockStore = {
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
  it("probe 成功後快取 healthy 狀態，下一次 ensureReady 不再重複 probe", async () => {
    const { store } = createMockStore([createEntry()]);
    const probe: McpProbe = {
      probe: vi.fn().mockResolvedValue(undefined),
    };
    const service = createManagedMcpRuntimeService({ store, probe });

    const first = await service.ensureReady("context7");
    const second = await service.ensureReady("context7");

    expect(first.status).toBe("healthy");
    expect(second.status).toBe("healthy");
    expect(probe.probe).toHaveBeenCalledTimes(1);
  });

  it("設定改動 markConfigDirty 後下一次 ensureReady 會重新 probe", async () => {
    const { store } = createMockStore([createEntry()]);
    const probe: McpProbe = {
      probe: vi.fn().mockResolvedValue(undefined),
    };
    const service = createManagedMcpRuntimeService({ store, probe });

    await service.ensureReady("context7");
    await service.markConfigDirty("context7");
    const rebuilt = await service.ensureReady("context7");

    expect(probe.probe).toHaveBeenCalledTimes(2);
    expect(rebuilt.status).toBe("healthy");
  });

  it("stdio probe 失敗會寫入 last_error", async () => {
    const { store } = createMockStore([
      createEntry({ name: "broken-stdio", command: "missing-binary" }),
    ]);
    const probe: McpProbe = {
      probe: vi.fn().mockRejectedValue(new Error("spawn failed")),
    };
    const service = createManagedMcpRuntimeService({ store, probe });

    const snapshot = await service.ensureReady("broken-stdio");

    expect(snapshot.status).toBe("error");
    expect(snapshot.lastError).toBe("spawn failed");
    expect(store.updateRuntimeState).toHaveBeenLastCalledWith(
      "broken-stdio",
      "error",
      "spawn failed",
    );
  });

  it("http/sse probe 失敗會反映為非 healthy 狀態", async () => {
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
    const probe: McpProbe = {
      probe: vi
        .fn()
        .mockRejectedValueOnce(new Error("http unavailable"))
        .mockRejectedValueOnce(new Error("sse unavailable")),
    };
    const service = createManagedMcpRuntimeService({ store, probe });

    const httpSnapshot = await service.ensureReady("remote-http");
    const sseSnapshot = await service.ensureReady("remote-sse");

    expect(httpSnapshot.status).toBe("error");
    expect(httpSnapshot.lastError).toBe("http unavailable");
    expect(sseSnapshot.status).toBe("error");
    expect(sseSnapshot.lastError).toBe("sse unavailable");
  });
});
