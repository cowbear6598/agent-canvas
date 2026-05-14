import { promises as fs } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "../../src/config/index.js";
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
    vi.restoreAllMocks();
    vi.spyOn(fs, "rm").mockResolvedValue(undefined);
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
  });

  it("repo pod 建立 run repo clone 失敗時應直接報錯，不回退到原始 repo cwd", async () => {
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
    vi.spyOn(gitService, "hasOriginRemote").mockResolvedValue({
      success: true,
      data: true,
    } as any);
    vi.spyOn(gitService, "syncToRemoteLatest").mockResolvedValue({
      success: true,
      data: undefined,
    } as any);
    vi.spyOn(gitService, "createLocalClone").mockResolvedValue({
      success: false,
      error: "boom",
    } as any);

    await expect(
      provisionRunExecutionResources({
        pod,
        runId: "run-1",
        runRepoCache: new Map(),
      }),
    ).rejects.toThrow("建立 run repo clone 失敗：boom");
  });

  it("repo pod 不是 git repository 時，應直接重用原始 repository cwd", async () => {
    const pod = makePod({
      id: "pod-repo-non-git",
      repositoryId: "repo-plain-dir",
      workspacePath: "/tmp/ignored",
    });

    vi.spyOn(fs, "access").mockResolvedValue(undefined);
    vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
      success: true,
      data: false,
    } as any);

    const result = await provisionRunExecutionResources({
      pod,
      runId: "run-plain-dir",
      runRepoCache: new Map(),
    });

    expect(result.workspacePath).toBe(
      path.resolve(path.join(config.repositoriesRoot, "repo-plain-dir")),
    );
    expect(result.runRepoPath).toBeNull();
  });

  it("repo pod 沒有任何 commit 時，應直接重用原始 repository cwd", async () => {
    const pod = makePod({
      id: "pod-repo-empty",
      repositoryId: "repo-empty",
      workspacePath: "/tmp/ignored",
    });

    vi.spyOn(fs, "access").mockResolvedValue(undefined);
    vi.spyOn(gitService, "isGitRepository").mockResolvedValue({
      success: true,
      data: true,
    } as any);
    vi.spyOn(gitService, "hasCommits").mockResolvedValue({
      success: true,
      data: false,
    } as any);

    const result = await provisionRunExecutionResources({
      pod,
      runId: "run-empty-repo",
      runRepoCache: new Map(),
    });

    expect(result.workspacePath).toBe(
      path.resolve(path.join(config.repositoriesRoot, "repo-empty")),
    );
    expect(result.runRepoPath).toBeNull();
  });

  it("repository 無 origin remote 時 fallback 回 sourceRepoPath", async () => {
    const pod = makePod({
      id: "pod-repo-no-origin",
      repositoryId: "repo-no-origin",
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
    vi.spyOn(gitService, "hasOriginRemote").mockResolvedValue({
      success: true,
      data: false,
    } as any);
    const createLocalCloneSpy = vi
      .spyOn(gitService, "createLocalClone")
      .mockResolvedValue({ success: true, data: undefined } as any);
    const syncSpy = vi
      .spyOn(gitService, "syncToRemoteLatest")
      .mockResolvedValue({ success: true, data: undefined } as any);

    const result = await provisionRunExecutionResources({
      pod,
      runId: "run-no-origin",
      runRepoCache: new Map(),
    });

    expect(result.workspacePath).toBe(
      path.resolve(path.join(config.repositoriesRoot, "repo-no-origin")),
    );
    expect(result.runRepoPath).toBeNull();
    expect(createLocalCloneSpy).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
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
      runRepoCache: new Map(),
    });

    expect(first.workspacePath).toBe(sharedWorkspace);

    const third = await provisionRunExecutionResources({
      pod: secondPod,
      runId: "run-2",
      runRepoCache: new Map(),
    });

    expect(third.workspacePath).toBe(sharedWorkspace);
  });

  it("syncToRemoteLatest 失敗時應 throw，訊息包含「同步 remote 最新版本失敗」", async () => {
    const pod = makePod({
      id: "pod-repo-sync-fail",
      repositoryId: "repo-sync-fail",
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
    vi.spyOn(gitService, "hasOriginRemote").mockResolvedValue({
      success: true,
      data: true,
    } as any);
    vi.spyOn(gitService, "syncToRemoteLatest").mockResolvedValue({
      success: false,
      error: "fetch-fail",
    } as any);

    await expect(
      provisionRunExecutionResources({
        pod,
        runId: "run-sync-fail",
        runRepoCache: new Map(),
      }),
    ).rejects.toThrow("同步 remote 最新版本失敗");
  });
});
