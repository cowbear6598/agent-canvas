import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useManagedMcpStore } from "@/stores/managedMcpStore";

const {
  mockListManagedMcpRegistry,
  mockSaveManagedMcpRegistry,
} = vi.hoisted(() => ({
  mockListManagedMcpRegistry: vi.fn(),
  mockSaveManagedMcpRegistry: vi.fn(),
}));

vi.mock("@/services/managedMcpApi", () => ({
  listManagedMcpRegistry: mockListManagedMcpRegistry,
  saveManagedMcpRegistry: mockSaveManagedMcpRegistry,
  deleteManagedMcpRegistry: vi.fn(),
}));

describe("managedMcpStore", () => {
  setupStoreTest();

  it("store refresh 失敗會保留錯誤狀態", async () => {
    const store = useManagedMcpStore();
    store.setRegistry([
      {
        id: "registry-1",
        name: "context7",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [],
        cwd: null,
        env: {},
        url: null,
        status: "healthy",
        lastError: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);
    mockListManagedMcpRegistry.mockRejectedValueOnce(new Error("refresh failed"));

    await store.refresh();

    expect(store.error).toBe("refresh failed");
    expect(store.registry).toHaveLength(1);
    expect(store.registry[0]?.name).toBe("context7");
  });

  it("save 成功後清單會更新", async () => {
    const store = useManagedMcpStore();
    store.setRegistry([]);
    mockSaveManagedMcpRegistry.mockResolvedValueOnce({
      id: "registry-2",
      name: "remote-docs",
      transport: "http",
      enabled: true,
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://example.com/mcp",
      status: "starting",
      lastError: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    });

    await store.saveRegistry({
      name: "remote-docs",
      transport: "http",
      enabled: true,
      url: "https://example.com/mcp",
    });

    expect(store.error).toBeNull();
    expect(store.registry).toEqual([
      expect.objectContaining({
        id: "registry-2",
        name: "remote-docs",
        transport: "http",
      }),
    ]);
  });
});
