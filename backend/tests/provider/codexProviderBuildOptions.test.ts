/**
 * CodexProvider.buildOptions() 單元測試
 *
 * 驗證 buildOptions 從 Pod 設定正確建構 CodexOptions：
 * - 空 providerConfig → 回傳 metadata.defaultOptions
 * - providerConfig.model 合法 → 採用之
 * - providerConfig.model 不合法 → fallback 為 default
 * - 傳入 runContext + Goal → 注入 request-scoped Goal MCP
 */

import { describe, it, expect } from "vitest";

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

  // ── Case 1：空 providerConfig → 回傳 metadata.defaultOptions ─────────
  it("空 providerConfig 應回傳 metadata.defaultOptions", async () => {
    const pod = makePod({ providerConfig: {} });
    const options = await provider.buildOptions(pod);

    expect(options).toEqual(provider.metadata.defaultOptions);
    expect(options.model).toBe(provider.metadata.defaultOptions.model);
    expect(options.resumeMode).toBe("cli");
    expect(options.mcpServerNames).toEqual([]);
    expect(options.goalMcpServer).toBeNull();
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
  it("傳入 runContext 且 Pod 有 Goal 時應注入 Goal MCP", async () => {
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
    expect(withContext.mcpServerNames).toContain("agent_canvas_goal");
    expect(withContext.goalMcpServer?.name).toBe("agent_canvas_goal");
    expect(withContext.goalMcpServer?.env.AGENT_CANVAS_GOAL_STATE_PATH).toContain(
      "run-001",
    );
  });

  it("傳入 runContext 且 Pod 無 Goal 時仍應注入 Goal MCP", async () => {
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

    expect(withContext.mcpServerNames).toContain("agent_canvas_goal");
    expect(withContext.goalMcpServer?.name).toBe("agent_canvas_goal");
    expect(withContext.goalMcpServer?.env.AGENT_CANVAS_GOAL_STATE_PATH).toContain(
      "run-001",
    );
  });
});
