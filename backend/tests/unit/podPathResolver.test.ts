import { describe, it, expect } from "vitest";

// ── Mocks（需在 import 之前宣告）────────────────────────────────────────────

import { vi } from "vitest";

vi.mock("../../src/config/index.js", () => ({
  config: {
    repositoriesRoot: "/repos",
    canvasRoot: "/canvas",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { resolvePodCwd } from "../../src/services/shared/podPathResolver.js";
import type { Pod } from "../../src/types/pod.js";

// ── 輔助函式 ─────────────────────────────────────────────────────────────────

function createBasePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-test",
    name: "Test Pod",
    workspacePath: "/canvas/test-pod",
    mcpServerIds: [],
    pluginIds: [],
    repositoryId: null,
    providerConfig: { model: "opus" },
    integrationBindings: [],
    ...overrides,
  } as Pod;
}

// ── 測試 ────────────────────────────────────────────────────────────────────

describe("resolvePodCwd", () => {
  it("合法 workspacePath（在 canvasRoot 內）應正常回傳", () => {
    const pod = createBasePod({ workspacePath: "/canvas/my-pod" });

    const result = resolvePodCwd(pod);

    expect(result).toBe("/canvas/my-pod");
  });

  it("含路徑穿越字元（../）的 repositoryId 應 throw", () => {
    const pod = createBasePod({
      repositoryId: "../evil",
    });

    expect(() => resolvePodCwd(pod)).toThrow("非法的工作目錄路徑");
  });

  it("合法 repositoryId 應組合 repositoriesRoot 並回傳", () => {
    const pod = createBasePod({
      repositoryId: "my-repo",
    });

    const result = resolvePodCwd(pod);

    expect(result).toBe("/repos/my-repo");
  });

  it("workspacePath 在 canvasRoot 以外時應 throw", () => {
    const pod = createBasePod({
      workspacePath: "/tmp/evil-path",
      repositoryId: null,
    });

    expect(() => resolvePodCwd(pod)).toThrow("工作目錄不在允許範圍內");
  });
});
