import { promises as fs } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pod } from "../../src/types/pod.js";
import { gitService } from "../../src/services/workspace/gitService.js";
import { provisionRunExecutionResources } from "../../src/services/runtime/runExecutionResources.js";

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Pod 1",
    status: "idle",
    workspacePath: "/tmp/pod-1",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    mcpServerNames: [],
    pluginIds: [],
    provider: "claude",
    providerConfig: null,
    repositoryId: null,
    commandId: null,
    multiInstance: true,
    integrationBindings: [],
    ...overrides,
  };
}

describe("runExecutionResources", () => {
  beforeEach(() => {
    vi.spyOn(fs, "rm").mockResolvedValue(undefined);
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
  });

  it("repo pod 建立 detached worktree 失敗時應直接報錯，不回退到原始 repo cwd", async () => {
    const pod = makePod({
      id: "pod-repo",
      repositoryId: "repo-1",
      workspacePath: "/tmp/ignored",
    });

    vi.spyOn(fs, "access").mockResolvedValue(undefined);
    vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
      success: true,
      data: true,
    } as any);
    vi.spyOn(gitService, "hasCommits").mockResolvedValue({
      success: true,
      data: true,
    } as any);
    vi.spyOn(gitService, "syncToRemoteLatest").mockResolvedValue({
      success: true,
      data: undefined,
    } as any);
    vi.spyOn(gitService, "createDetachedWorktree").mockResolvedValue({
      success: false,
      error: "boom",
    } as any);

    await expect(
      provisionRunExecutionResources({
        pod,
        runId: "run-1",
        worktreeCache: new Map(),
      }),
    ).rejects.toThrow("建立 detached worktree 失敗：boom");
  });

  it("non-repo workspace 應直接重用 pod 自己的 cwd，允許多個 run 同時使用", async () => {
    const sharedWorkspace = path.resolve("/tmp/shared-pod-workspace");
    const firstPod = makePod({
      id: "pod-a",
      workspacePath: sharedWorkspace,
    });
    const secondPod = makePod({
      id: "pod-b",
      workspacePath: sharedWorkspace,
    });

    const first = await provisionRunExecutionResources({
      pod: firstPod,
      runId: "run-1",
      worktreeCache: new Map(),
    });

    expect(first.workspacePath).toBe(sharedWorkspace);

    const third = await provisionRunExecutionResources({
      pod: secondPod,
      runId: "run-2",
      worktreeCache: new Map(),
    });

    expect(third.workspacePath).toBe(sharedWorkspace);
  });
});
