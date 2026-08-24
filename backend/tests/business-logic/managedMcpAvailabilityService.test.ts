import { describe, expect, it, vi } from "vitest";
import { GOAL_MCP_SERVER_NAME } from "../../src/services/goalRuntime.js";
import { createManagedMcpAvailabilityService } from "../../src/services/mcp/managedMcpAvailabilityService.js";
import type { ManagedMcpServerRecord } from "../../src/services/mcp/managedMcpStore.js";
import type { Pod } from "../../src/types/pod.js";

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
    requiresSecretSetup: overrides.requiresSecretSetup ?? false,
  };
}

function createPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Pod 1",
    workspacePath: overrides.workspacePath ?? "/tmp/pod-1",
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    rotation: overrides.rotation ?? 0,
    sessionId: overrides.sessionId ?? null,
    mcpServerNames: overrides.mcpServerNames ?? [],
    codexMcpServerKeys: overrides.codexMcpServerKeys ?? [],
    agentCanvasMcpEnabled: overrides.agentCanvasMcpEnabled ?? false,
    pluginIds: overrides.pluginIds ?? [],
    provider: overrides.provider ?? "claude",
    providerConfig: overrides.providerConfig ?? null,
    repositoryId: overrides.repositoryId ?? null,
    goal: overrides.goal ?? {
      todos: [{ id: "todo-1", text: "Inspect current task state" }],
    },
    schedule: overrides.schedule,
    integrationBindings: overrides.integrationBindings,
  };
}

describe("ManagedMcpAvailabilityService business rules", () => {
  it("已選取且 healthy 的 registry entry 仍可切換，讓使用者能保留既有 MCP 選取", () => {
    const service = createManagedMcpAvailabilityService({
      store: {
        list: vi.fn(() => [
          createEntry({
            name: "context7",
            transport: "stdio",
            lastKnownStatus: "healthy",
          }),
        ]),
      },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => ({
          name: "context7",
          transport: "stdio",
          enabled: true,
          status: "healthy",
          lastError: null,
          dirty: false,
          pid: 1234,
          endpointUrl: null,
        })),
      },
    });

    const availability = service.listForPod(
      createPod({
        provider: "claude",
        mcpServerNames: ["context7"],
      }),
    );
    const item = availability.find((entry) => entry.name === "context7");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: true,
        status: "healthy",
      }),
    );
  });

  it("disabled registry entry 會留在清單但不可選，避免 pod 再次啟用已停用 target", () => {
    const service = createManagedMcpAvailabilityService({
      store: {
        list: vi.fn(() => [
          createEntry({
            name: "disabled-server",
            enabled: false,
            lastKnownStatus: "healthy",
          }),
        ]),
      },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => ({
          name: "disabled-server",
          transport: "stdio",
          enabled: false,
          status: "disabled",
          lastError: null,
          dirty: false,
        })),
      },
    });

    const item = service
      .listForPod(
        createPod({
          mcpServerNames: ["disabled-server"],
        }),
      )
      .find((entry) => entry.name === "disabled-server");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: false,
        status: "disabled",
        disabledReason: "registry entry disabled",
      }),
    );
  });

  it("缺少秘密環境變數的 registry entry 會留在清單但不可選", () => {
    const service = createManagedMcpAvailabilityService({
      store: {
        list: vi.fn(() => [
          createEntry({
            name: "missing-secret",
            requiresSecretSetup: true,
          }),
        ]),
      },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => null),
      },
    });

    const item = service
      .listForPod(createPod({ mcpServerNames: ["missing-secret"] }))
      .find((entry) => entry.name === "missing-secret");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: false,
        status: "disabled",
        disabledReason: "缺少秘密環境變數，請重新設定 MCP 憑證",
      }),
    );
  });

  it("已從 registry 移除的 selected name 會標示為無效，讓 pod 設定流程能 self-heal", () => {
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => []) },
      runtimeService: { getRuntimeSnapshot: vi.fn(() => null) },
    });

    const availability = service.listForPod(
      createPod({
        mcpServerNames: ["ghost-server"],
      }),
    );
    const item = availability.find((entry) => entry.name === "ghost-server");

    expect(item).toEqual(
      expect.objectContaining({
        selected: true,
        selectable: false,
        status: "error",
        disabledReason: "registry entry removed",
      }),
    );
  });

  it("Goal built-in 仍固定顯示為 locked system item，不受 registry 內容影響", () => {
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => []) },
      runtimeService: { getRuntimeSnapshot: vi.fn(() => null) },
    });

    const availability = service.listForPod(createPod());
    const goalItem = availability.find(
      (entry) => entry.name === GOAL_MCP_SERVER_NAME,
    );

    expect(goalItem).toEqual(
      expect.objectContaining({
        system: true,
        locked: true,
        selected: true,
        selectable: false,
      }),
    );
  });

  it("所有 provider 都可選 http/sse entry，proxy bridge 會補齊原生不支援的 transport", () => {
    const sseEntry = createEntry({
      name: "remote-sse",
      transport: "sse",
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://remote-sse.example.com/mcp",
    });
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => [sseEntry]) },
      runtimeService: {
        getRuntimeSnapshot: vi.fn(() => ({
          name: "remote-sse",
          transport: "sse",
          enabled: true,
          status: "healthy",
          lastError: null,
          dirty: false,
          pid: null,
          endpointUrl: "https://remote-sse.example.com/mcp",
        })),
      },
    });

    for (const provider of ["claude", "codex", "opencode"] as const) {
      const item = service
        .listForPod(createPod({ provider }))
        .find((entry) => entry.name === "remote-sse");
      expect(item, `${provider} 應該可選 sse entry`).toEqual(
        expect.objectContaining({
          selectable: true,
          disabledReason: null,
        }),
      );
    }
  });

  it("Codex 原生 MCP 依 official/user 來源顯示，且全域停用項目不可選", () => {
    const service = createManagedMcpAvailabilityService({
      store: { list: vi.fn(() => []) },
      runtimeService: { getRuntimeSnapshot: vi.fn(() => null) },
    });
    const availability = service.listForPod(
      createPod({ codexMcpServerKeys: ["plugin:official:docs"] }),
      [
        {
          key: "plugin:official:docs",
          name: "docs",
          source: "official",
          transport: "stdio",
          globallyEnabled: true,
          configTarget: { kind: "plugin", pluginId: "official" },
        },
        {
          key: "user:local",
          name: "local",
          source: "user",
          transport: "http",
          globallyEnabled: false,
          configTarget: { kind: "user" },
        },
      ],
    );

    expect(availability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "plugin:official:docs",
          source: "official",
          selected: true,
          selectable: true,
        }),
        expect.objectContaining({
          key: "user:local",
          source: "user",
          selected: false,
          selectable: false,
          disabledReasonKey: "codexGloballyDisabled",
        }),
      ]),
    );
  });
});
