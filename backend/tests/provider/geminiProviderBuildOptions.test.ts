/**
 * GeminiProvider.buildOptions() 單元測試
 *
 * 驗證 buildOptions 從 Pod 設定正確建構 GeminiOptions：
 * - 空 providerConfig → 回傳 metadata.defaultOptions
 * - providerConfig.model 合法 → 採用之
 * - providerConfig.model 不合法（含空格 / 分號 / 換行 / @ / 空字串）→ fallback 為 default
 * - providerConfig.model 為非字串型別 → fallback 為 default
 * - 傳入 runContext → 不影響輸出（本 Phase 不使用）
 */

import { describe, it, expect } from "vitest";

import { geminiProvider } from "../../src/services/provider/geminiProvider.js";
import type { Pod } from "../../src/types/pod.js";

// ── 工具：建立最小化 Pod stub ────────────────────────────────────────────
function makePod(overrides: Partial<Pick<Pod, "providerConfig">> = {}): Pod {
  return {
    id: "pod-buildopts-gemini-001",
    name: "Test Pod",
    provider: "gemini",
    status: "idle",
    providerConfig: {},
    workspacePath: "/workspace/test",
    mcpServerNames: [],
    pluginIds: [],

    repositoryId: null,
    commandId: null,
    multiInstance: false,
    sessionId: null,
    x: 0,
    y: 0,
    rotation: 0,
    ...overrides,
  } as Pod;
}

describe("GeminiProvider.buildOptions()", () => {
  // ── B1：空 providerConfig → 回傳 metadata.defaultOptions ─────────────
  it("B1: 空 providerConfig 應回傳 metadata.defaultOptions（model=gemini-2.5-pro，resumeMode=cli）", async () => {
    const pod = makePod({ providerConfig: {} });
    const options = await geminiProvider.buildOptions(pod);

    expect(options).toEqual(geminiProvider.metadata.defaultOptions);
    expect(options.model).toBe("gemini-2.5-pro");
    expect(options.resumeMode).toBe("cli");
  });

  // ── B2：合法 model gemini-2.5-flash → 採用之 ─────────────────────────
  it("B2: providerConfig.model 為合法 gemini-2.5-flash 時應採用之", async () => {
    const pod = makePod({ providerConfig: { model: "gemini-2.5-flash" } });
    const options = await geminiProvider.buildOptions(pod);

    expect(options.model).toBe("gemini-2.5-flash");
    expect(options.resumeMode).toBe("cli");
  });

  // ── B3：非法字元 model → fallback 為 default ──────────────────────────
  it("B3: providerConfig.model 含非法字元時應 fallback 為 default model", async () => {
    // MODEL_RE = /^[a-zA-Z0-9._-]+$/：空格、分號、換行、@、空字串皆非法
    const illegalModels = [
      "model with spaces",
      "model;rm -rf",
      "model\nwith\nnewline",
      "model@invalid",
      "",
    ];

    for (const illegalModel of illegalModels) {
      const pod = makePod({ providerConfig: { model: illegalModel } });
      const options = await geminiProvider.buildOptions(pod);

      expect(options.model).toBe(geminiProvider.metadata.defaultOptions.model);
      expect(options.resumeMode).toBe("cli");
    }
  });

  // ── B4：providerConfig.model 為非字串型別 → fallback 為 default ──────
  it("B4: providerConfig.model 為非字串型別時應 fallback 為 default model", async () => {
    const pod = makePod({
      providerConfig: { model: 42 as unknown as string },
    });
    const options = await geminiProvider.buildOptions(pod);

    expect(options.model).toBe(geminiProvider.metadata.defaultOptions.model);
    expect(options.resumeMode).toBe("cli");
  });

  // ── B5：runContext 傳入時不影響輸出 ────────────────────────────────────
  it("B5: 傳入 runContext 時，輸出結果不應受影響（本 Phase 不使用 runContext）", async () => {
    const pod = makePod({ providerConfig: { model: "gemini-2.5-flash" } });
    const fakeRunContext = { runId: "run-001", instanceId: "inst-001" } as any;

    const withoutContext = await geminiProvider.buildOptions(pod);
    const withContext = await geminiProvider.buildOptions(pod, fakeRunContext);

    expect(withContext).toEqual(withoutContext);
    expect(withContext.model).toBe("gemini-2.5-flash");
    expect(withContext.resumeMode).toBe("cli");
  });
});
