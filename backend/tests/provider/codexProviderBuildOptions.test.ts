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
  },
}));

vi.mock("../../src/services/mcp/managedMcpSurfaceService.js", () => ({
  AGENT_CANVAS_MANAGED_SURFACE_NAME: "agent_canvas_managed_surface",
  managedMcpSurfaceService: mockManagedMcpSurfaceService,
}));

import { CodexProvider } from "../../src/services/provider/codexProvider.js";
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
  const provider = new CodexProvider();

  beforeEach(() => {
    mockManagedMcpSurfaceService.ensureSurface.mockResolvedValue({
      runId: "run-001",
      podId: "pod-buildopts-001",
      provider: "codex",
      sourceNames: ["team-server"],
      targetNames: ["agent_canvas_goal", "team-server"],
      ignoredTargets: [],
      hasGoalRuntime: true,
      statePath: "/tmp/managed-surface/run-001/pod-buildopts-001.json",
      mcpServer: {
        name: "agent_canvas_managed_surface",
        command: process.execPath,
        args: ["/tmp/managedMcpSurfaceBridge.ts"],
        env: {
          AGENT_CANVAS_MANAGED_MCP_SURFACE_PATH:
            "/tmp/managed-surface/run-001/pod-buildopts-001.json",
        },
      },
    });
  });

  // ── Case 1：空 providerConfig → 回傳 metadata.defaultOptions ─────────
  it("空 providerConfig 應回傳 metadata.defaultOptions", async () => {
    const pod = makePod({ providerConfig: {} });
    const options = await provider.buildOptions(pod);

    expect(options).toEqual(provider.metadata.defaultOptions);
    expect(options.model).toBe(provider.metadata.defaultOptions.model);
    expect(options.resumeMode).toBe("cli");
    expect(options.mcpServerNames).toEqual([]);
    expect(options.goalMcpServer).toBeNull();
    expect(options.managedSurface).toBeNull();
    expect(options.goalPromptEnabled).toBe(false);
  });

  // ── Case 2：合法 model → 採用之 ──────────────────────────────────────
  it("providerConfig.model 為合法字串時應採用之", async () => {
    const pod = makePod({ providerConfig: { model: "gpt-5.4-pro" } });
    const options = await provider.buildOptions(pod);

    expect(options.model).toBe("gpt-5.4-pro");
    expect(options.resumeMode).toBe("cli");
    expect(options.mcpServerNames).toEqual([]);
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

  // ── Case 5：runContext 傳入時不影響輸出 ──────────────────────────────
  it("傳入 runContext 時應改為注入 managed surface", async () => {
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
    expect(mockManagedMcpSurfaceService.ensureSurface).toHaveBeenCalledWith(
      fakeRunContext,
      pod,
    );
    expect(withContext.mcpServerNames).toEqual([
      "agent_canvas_managed_surface",
    ]);
    expect(withContext.goalMcpServer).toBeNull();
    expect(withContext.managedSurface?.name).toBe(
      "agent_canvas_managed_surface",
    );
    expect(withContext.goalPromptEnabled).toBe(true);
  });

  it("傳入 runContext 且 Pod 無 Goal 時仍應注入 managed surface", async () => {
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

    expect(withContext.mcpServerNames).toEqual([
      "agent_canvas_managed_surface",
    ]);
    expect(withContext.goalMcpServer).toBeNull();
    expect(withContext.managedSurface?.name).toBe(
      "agent_canvas_managed_surface",
    );
    expect(withContext.goalPromptEnabled).toBe(true);
  });
});
