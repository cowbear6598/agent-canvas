import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockManagedMcpStore } = vi.hoisted(() => ({
  mockManagedMcpStore: {
    list: vi.fn(),
    save: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
  },
}));

const { mockManagedMcpRuntimeService } = vi.hoisted(() => ({
  mockManagedMcpRuntimeService: {
    markConfigDirty: vi.fn(),
    ensureReady: vi.fn(),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getByIdGlobal: vi.fn(),
    getById: vi.fn(),
    setMcpServerNames: vi.fn(),
  },
}));

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    hasActiveRunForPod: vi.fn(() => false),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: vi.fn(),
    emitToAll: vi.fn(),
    emitToCanvas: vi.fn(),
  },
}));

vi.mock("../../src/services/mcp/managedMcpStore.js", () => ({
  managedMcpStore: mockManagedMcpStore,
}));

vi.mock("../../src/services/mcp/managedMcpRuntimeService.js", () => ({
  managedMcpRuntimeService: mockManagedMcpRuntimeService,
}));

const { mockManagedMcpAvailabilityService } = vi.hoisted(() => ({
  mockManagedMcpAvailabilityService: {
    listForPod: vi.fn(() => []),
  },
}));

vi.mock("../../src/services/mcp/managedMcpAvailabilityService.js", () => ({
  managedMcpAvailabilityService: mockManagedMcpAvailabilityService,
}));

vi.mock("../../src/utils/handlerHelpers.js", () => ({
  getCanvasId: vi.fn(() => "canvas-1"),
}));

import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import {
  handleManagedMcpRegistryDelete,
  handleManagedMcpRegistryList,
  handleManagedMcpRegistrySave,
  handleManagedMcpRegistryTest,
  handlePodSetMcpServerNames,
} from "../../src/handlers/mcpHandlers.js";
import { socketService } from "../../src/services/socketService.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";

describe("managed MCP handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagedMcpRuntimeService.markConfigDirty.mockResolvedValue(undefined);
  });

  it("registry list 回傳 persisted entries", async () => {
    mockManagedMcpStore.list.mockReturnValue([
      {
        id: "registry-1",
        name: "context7",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        cwd: null,
        env: {},
        url: null,
        lastKnownStatus: "healthy",
        lastError: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ]);

    await handleManagedMcpRegistryList(
      "conn-1",
      { requestId: "00000000-0000-4000-8000-000000000001" },
      "req-list",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
      expect.objectContaining({
        requestId: "req-list",
        success: true,
        items: [
          expect.objectContaining({
            name: "context7",
            transport: "stdio",
            status: "healthy",
          }),
        ],
      }),
    );
  });

  it("save 後廣播 registry updated", async () => {
    mockManagedMcpStore.save.mockReturnValue({
      id: "registry-2",
      name: "remote-docs",
      transport: "http",
      enabled: true,
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://example.com/mcp",
      lastKnownStatus: "starting",
      lastError: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    await handleManagedMcpRegistrySave(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000002",
        registry: {
          name: "remote-docs",
          transport: "http",
          enabled: true,
          url: "https://example.com/mcp",
        },
      },
      "req-save",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      expect.objectContaining({
        requestId: "req-save",
        success: true,
        item: expect.objectContaining({ name: "remote-docs" }),
      }),
    );
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        action: "saved",
        registryId: "registry-2",
      }),
    );
  });

  it("delete 後清單移除該 entry", async () => {
    mockManagedMcpStore.getById.mockReturnValue({
      id: "registry-3",
      name: "to-delete",
    });
    mockManagedMcpStore.delete.mockReturnValue(true);

    await handleManagedMcpRegistryDelete(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000003",
        registryId: "registry-3",
      },
      "req-delete",
    );

    expect(mockManagedMcpStore.delete).toHaveBeenCalledWith("registry-3");
    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
      expect.objectContaining({
        requestId: "req-delete",
        success: true,
        registryId: "registry-3",
      }),
    );
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        action: "deleted",
        registryId: "registry-3",
      }),
    );
  });
});

describe("handleManagedMcpRegistryTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagedMcpRuntimeService.markConfigDirty.mockResolvedValue(undefined);
  });

  it("probe healthy 時回傳 success:true 並廣播 diagnostics", async () => {
    // 模擬 entry 存在
    mockManagedMcpStore.getById.mockReturnValue({
      id: "registry-10",
      name: "healthy-server",
    });
    // 模擬 ensureReady 回傳 healthy snapshot
    mockManagedMcpRuntimeService.ensureReady.mockResolvedValue({
      name: "healthy-server",
      transport: "stdio",
      enabled: true,
      status: "healthy",
      lastError: null,
      dirty: false,
    });

    await handleManagedMcpRegistryTest(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000010",
        registryId: "registry-10",
      },
      "req-test-healthy",
    );

    // 驗證 markConfigDirty 先被呼叫以強制重新 probe
    expect(mockManagedMcpRuntimeService.markConfigDirty).toHaveBeenCalledWith(
      "healthy-server",
    );

    // 驗證回傳給觸發者的 payload 含 success:true、status、registryId、requestId
    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      expect.objectContaining({
        requestId: "req-test-healthy",
        success: true,
        status: "healthy",
        registryId: "registry-10",
      }),
    );

    // 驗證廣播 MANAGED_MCP_REGISTRY_UPDATED 含 action:"diagnostics"
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        requestId: "req-test-healthy",
        success: true,
        action: "diagnostics",
        registryId: "registry-10",
      }),
    );
  });

  it("probe 失敗時回傳 success:false 並帶上 lastError", async () => {
    // 模擬 entry 存在
    mockManagedMcpStore.getById.mockReturnValue({
      id: "registry-11",
      name: "broken-server",
    });
    // 模擬 ensureReady 回傳非 healthy snapshot，帶有 lastError
    mockManagedMcpRuntimeService.ensureReady.mockResolvedValue({
      name: "broken-server",
      transport: "stdio",
      enabled: true,
      status: "error",
      lastError: "連線逾時：無法連到 broken-server",
      dirty: false,
    });

    await handleManagedMcpRegistryTest(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000011",
        registryId: "registry-11",
      },
      "req-test-failed",
    );

    // 驗證回傳 success:false 且 lastError 沿用 snapshot.lastError
    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      expect.objectContaining({
        requestId: "req-test-failed",
        success: false,
        status: "error",
        registryId: "registry-11",
        lastError: "連線逾時：無法連到 broken-server",
      }),
    );

    // 廣播仍然要送出（handler 實作不論成敗都廣播）
    expect(socketService.emitToAll).toHaveBeenCalledWith(
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      expect.objectContaining({
        action: "diagnostics",
        registryId: "registry-11",
      }),
    );
  });

  it("registryId 找不到 entry 時走 not-found 分支並回傳錯誤", async () => {
    // 模擬找不到 entry
    mockManagedMcpStore.getById.mockReturnValue(undefined);

    await handleManagedMcpRegistryTest(
      "conn-1",
      {
        requestId: "00000000-0000-4000-8000-000000000012",
        registryId: "registry-not-exist",
      },
      "req-test-notfound",
    );

    // 驗證回傳錯誤事件（NOT_FOUND）
    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
      expect.objectContaining({
        success: false,
        code: "NOT_FOUND",
        requestId: "req-test-notfound",
      }),
    );

    // 不應呼叫 markConfigDirty 或 ensureReady
    expect(mockManagedMcpRuntimeService.markConfigDirty).not.toHaveBeenCalled();
    expect(mockManagedMcpRuntimeService.ensureReady).not.toHaveBeenCalled();

    // 不應廣播 registry updated
    expect(socketService.emitToAll).not.toHaveBeenCalled();
  });
});

describe("handlePodSetMcpServerNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(podStore.getById).mockReturnValue({
      id: "pod-1",
      provider: "claude",
      mcpServerNames: [],
    } as any);
    mockManagedMcpAvailabilityService.listForPod.mockReturnValue([
      {
        name: "server-everything",
        transport: "stdio",
        status: "healthy",
        selected: false,
        selectable: true,
        disabledReason: null,
        lastError: null,
      } as any,
    ]);
  });

  it("active run 中的 pod 仍可改 MCP（per-MCP entry 架構下不再 freeze）", async () => {
    // 模擬該 pod 有 active run instance — 舊行為會被 POD_BUSY 拒掉，新行為應放行
    vi.mocked(runStore.hasActiveRunForPod).mockReturnValue(true);

    await handlePodSetMcpServerNames(
      "conn-1",
      { podId: "pod-1", mcpServerNames: ["server-everything"] } as any,
      "req-mcp-1",
    );

    // 不該因 active run 拒絕（不發出 emitError），應正常寫入 + 廣播
    expect(podStore.setMcpServerNames).toHaveBeenCalledWith("pod-1", [
      "server-everything",
    ]);
    expect(socketService.emitToCanvas).toHaveBeenCalledWith(
      "canvas-1",
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      expect.objectContaining({
        success: true,
        podId: "pod-1",
        mcpServerNames: ["server-everything"],
      }),
    );
    // emitToConnection 是 emitError 用的，busy guard 移除後不該被呼叫
    expect(socketService.emitToConnection).not.toHaveBeenCalled();
  });
});
