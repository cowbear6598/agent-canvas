/**
 * CodexProvider.buildOptions() 單元測試
 *
 * 驗證 buildOptions 從 Pod 設定正確建構 CodexOptions：
 * - 空 providerConfig → 回傳 metadata.defaultOptions
 * - providerConfig.model 合法 → 採用之
 * - providerConfig.model 不合法 → fallback 為 default
 * - 傳入 runContext → 注入 request-scoped managed surface
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockManagedMcpSurfaceService } = vi.hoisted(() => ({
  mockManagedMcpSurfaceService: {
    ensureSurface: vi.fn(),
    ensureChatSurface: vi.fn().mockResolvedValue(null),
    cleanupChatSurface: vi.fn().mockResolvedValue(undefined),
    buildPodMcpEntries: vi.fn().mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    }),
  },
}));

vi.mock("../../src/services/mcp/managedMcpSurfaceService.js", () => ({
  AGENT_CANVAS_MANAGED_SURFACE_NAME: "agent_canvas_managed_surface",
  managedMcpSurfaceService: mockManagedMcpSurfaceService,
}));

import { codexProvider } from "../../src/services/provider/codexProvider.js";
import type { Pod } from "../../src/types/pod.js";

// ── 工具：建立最小化 Pod stub ────────────────────────────────────────────
function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-buildopts-001",
    name: "Test Pod",
    provider: "codex",
    status: "idle",
    providerConfig: {},
    workspacePath: "/workspace/test",
    skillIds: [],
    mcpServerNames: [],
    pluginIds: [],
    integrationBindings: [],

    repositoryId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
    ...overrides,
  } as Pod;
}

describe("CodexProvider.buildOptions()", () => {
  const provider = codexProvider;

  beforeEach(() => {
    mockManagedMcpSurfaceService.ensureSurface.mockClear();
    mockManagedMcpSurfaceService.ensureChatSurface.mockClear();
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockClear();
    mockManagedMcpSurfaceService.ensureChatSurface.mockResolvedValue(null);
    // buildPodMcpEntries 預設回空（individual test 可 mockResolvedValueOnce 覆寫）
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });
  });

  // ── Case 1：空 providerConfig → 回傳 metadata.defaultOptions ─────────
  it("空 providerConfig 應回傳 metadata.defaultOptions", async () => {
    const pod = makePod({ providerConfig: {} });
    const options = await provider.buildOptions(pod);

    expect(options.model).toBe(provider.metadata.defaultOptions.model);
    expect(options.resumeMode).toBe("cli");
    expect(options.mcpEntries).toEqual([]);
    expect(options.hasGoalRuntime).toBe(false);
    expect(options.fastModeEnabled).toBe(false);
    expect(options.model).toBe("gpt-5.6-luna");
  });

  // ── Case 2：合法 model → 採用之 ──────────────────────────────────────
  it("providerConfig.model 為合法字串時應採用之", async () => {
    const pod = makePod({ providerConfig: { model: "gpt-5.4-pro" } });
    const options = await provider.buildOptions(pod);

    expect(options.model).toBe("gpt-5.4-pro");
    expect(options.resumeMode).toBe("cli");
    expect(options.mcpEntries).toEqual([]);
  });

  // ── Case 3：不合法 model → fallback 為 default ───────────────────────
  it("providerConfig.model 含非法字元時應 fallback 為 default model", async () => {
    // MODEL_RE = /^[a-zA-Z0-9._-]+$/：空白、分號、換行等皆為非法字元
    const illegalModels = [
      "model with spaces",
      "model;rm -rf",
      "",
      "model\nwith\nnewline",
      "model@invalid",
    ];

    for (const illegalModel of illegalModels) {
      const pod = makePod({ providerConfig: { model: illegalModel } });
      const options = await provider.buildOptions(pod);

      expect(options.model).toBe(provider.metadata.defaultOptions.model);
      expect(options.resumeMode).toBe("cli");
    }
  });

  // ── Case 4：providerConfig.model 為非字串型別 → fallback 為 default ──
  it("providerConfig.model 為非字串型別時應 fallback 為 default model", async () => {
    const pod = makePod({ providerConfig: { model: 42 as unknown as string } });
    const options = await provider.buildOptions(pod);

    expect(options.model).toBe(provider.metadata.defaultOptions.model);
  });

  it("支援模型開啟 Fast mode 時保留 true，不支援模型則防禦性關閉", async () => {
    const supported = await provider.buildOptions(
      makePod({
        providerConfig: { model: "gpt-5.6-luna" },
        fastModeEnabled: true,
      }),
    );
    const unsupported = await provider.buildOptions(
      makePod({
        providerConfig: { model: "gpt-5.4-pro" },
        fastModeEnabled: true,
      }),
    );

    expect(supported.fastModeEnabled).toBe(true);
    expect(unsupported.fastModeEnabled).toBe(false);
  });

  // ── Case 5：runContext 傳入時透過 buildPodMcpEntries 取得 entries ─────
  it("傳入 runContext 時應呼叫 buildPodMcpEntries 並把 entries 注入 options", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "agent_canvas_goal",
          transport: "stdio",
          command: "/usr/local/bin/bun",
          args: ["/tmp/goalMcpBridge.ts"],
          env: { AGENT_CANVAS_GOAL_STATE_PATH: "/tmp/goal-state.json" },
          cwd: null,
          proxied: false,
        },
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: true,
      pluginCatalog: [],
    });

    const pod = makePod({
      providerConfig: { model: "gpt-5.4-pro" },
      goal: {
        todos: [{ id: "todo-1", text: "Implement Goal MCP" }],
      } as any,
    } as any);
    const fakeRunContext = {
      runId: "run-001",
      canvasId: "canvas-001",
      sourcePodId: "pod-buildopts-001",
    } as any;

    const withContext = await provider.buildOptions(pod, fakeRunContext);

    expect(withContext.model).toBe("gpt-5.4-pro");
    expect(withContext.resumeMode).toBe("cli");
    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, fakeRunContext);
    expect(withContext.hasGoalRuntime).toBe(true);
    expect(withContext.mcpEntries).toHaveLength(2);
    expect(withContext.mcpEntries[0]?.name).toBe("agent_canvas_goal");
    expect(withContext.mcpEntries[1]?.name).toBe("team-server");
  });

  it("傳入 runContext 且 Pod 無 Goal 時 hasGoalRuntime 為 false", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makePod({
      providerConfig: { model: "gpt-5.4-pro" },
      goal: null,
    } as any);
    const fakeRunContext = {
      runId: "run-001",
      canvasId: "canvas-001",
      sourcePodId: "pod-buildopts-001",
    } as any;

    const withContext = await provider.buildOptions(pod, fakeRunContext);

    expect(withContext.hasGoalRuntime).toBe(false);
    expect(withContext.mcpEntries).toEqual([
      expect.objectContaining({ name: "team-server", transport: "stdio" }),
    ]);
  });

  // ── Case 6：Chat 模式（無 runContext）─────────────────────────────────
  it("Chat 模式 buildPodMcpEntries 取得的 entries 注入 options（無 Goal Runtime）", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "team-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          cwd: null,
          proxied: false,
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makePod({
      providerConfig: { model: "gpt-5.4-pro" },
      mcpServerNames: ["team-server"],
    });
    const options = await provider.buildOptions(pod);

    expect(
      mockManagedMcpSurfaceService.buildPodMcpEntries,
    ).toHaveBeenCalledWith(pod, null);
    expect(options.mcpEntries).toEqual([
      expect.objectContaining({ name: "team-server" }),
    ]);
    expect(options.hasGoalRuntime).toBe(false);
  });

  it("Codex pod 勾 http target 時 buildPodMcpEntries 回 http entry 應原樣保留（codex 原生支援）", async () => {
    mockManagedMcpSurfaceService.buildPodMcpEntries.mockResolvedValue({
      entries: [
        {
          name: "remote-mcp",
          transport: "http",
          url: "https://example.com/mcp",
        },
      ],
      ignoredTargets: [],
      hasGoalRuntime: false,
      pluginCatalog: [],
    });

    const pod = makePod({ mcpServerNames: ["remote-mcp"] });
    const options = await provider.buildOptions(pod);

    expect(options.mcpEntries).toEqual([
      { name: "remote-mcp", transport: "http", url: "https://example.com/mcp" },
    ]);
  });
});
