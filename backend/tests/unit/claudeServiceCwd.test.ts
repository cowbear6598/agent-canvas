// 必須在 import 前 mock
let mockQueryGenerator: any;

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn((...args: any[]) => mockQueryGenerator(...args)),
  };
});

vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn(() => "/usr/local/bin/claude"),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  claudeService,
  type StreamEvent,
} from "../../src/services/claude/claudeService.js";
import * as claudeAgentSdk from "@anthropic-ai/claude-agent-sdk";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { outputStyleService } from "../../src/services/outputStyleService.js";
import { config } from "../../src/config";

function createSuccessGenerator() {
  return async function* () {
    yield {
      type: "system",
      subtype: "init",
      session_id: "test-session",
    };
    yield {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "OK" }],
      },
    };
    yield {
      type: "result",
      subtype: "success",
      result: "OK",
    };
  };
}

describe("ClaudeService — cwd 解析", () => {
  let streamEvents: StreamEvent[];
  let originalRepositoriesRoot: string;
  let originalCanvasRoot: string;

  const onStream = (event: StreamEvent): void => {
    streamEvents.push(event);
  };

  beforeEach(() => {
    streamEvents = [];
    mockQueryGenerator = null;

    originalRepositoriesRoot = config.repositoriesRoot;
    originalCanvasRoot = config.canvasRoot;
    (config as any).repositoriesRoot = "/test/repos";
    (config as any).canvasRoot = "/test/canvas";

    vi.spyOn(podStore, "getByIdGlobal").mockReturnValue(null as any);
    vi.spyOn(podStore, "setClaudeSessionId").mockImplementation(() => {});
    vi.spyOn(outputStyleService, "getContent").mockResolvedValue(null);

    (claudeAgentSdk.query as any).mockClear();
  });

  afterEach(() => {
    (config as any).repositoriesRoot = originalRepositoriesRoot;
    (config as any).canvasRoot = originalCanvasRoot;
    vi.restoreAllMocks();
  });

  const createMockPod = (overrides = {}) => ({
    id: "test-pod-id",
    name: "Test Pod",
    model: "claude-sonnet-4-5-20250929" as const,
    claudeSessionId: null,
    repositoryId: null,
    workspacePath: "/test/canvas/workspace",
    commandId: null,
    outputStyleId: null,
    status: "idle" as const,
    pluginIds: [] as string[],
    ...overrides,
  });

  it("Run mode 下有 worktreePath 的 Instance 使用 worktree 路徑作為 cwd", async () => {
    const podId = "test-pod-id";
    const runId = "run-cwd-1";
    const worktreePath = "/test/repos/my-repo-run-run-cwd-1-test-pod-id";

    const mockPod = createMockPod({ repositoryId: "my-repo" });

    vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
      canvasId: "test-canvas",
      pod: mockPod as any,
    });

    vi.spyOn(runStore, "getPodInstance").mockReturnValue({
      id: "inst-1",
      runId,
      podId,
      status: "running",
      claudeSessionId: null,
      errorMessage: null,
      triggeredAt: null,
      completedAt: null,
      autoPathwaySettled: "pending",
      directPathwaySettled: "not-applicable",
      worktreePath,
    });

    mockQueryGenerator = createSuccessGenerator();

    await claudeService.sendMessage(podId, "test", onStream, {
      runContext: { runId, canvasId: "test-canvas", sourcePodId: podId },
    });

    expect(claudeAgentSdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: worktreePath,
        }),
      }),
    );
  });

  it("Run mode 下沒有 worktreePath 的 Instance 使用 Pod 原始路徑（fallback）", async () => {
    const podId = "test-pod-id";
    const runId = "run-cwd-2";

    const mockPod = createMockPod({ repositoryId: "my-repo" });

    vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
      canvasId: "test-canvas",
      pod: mockPod as any,
    });

    // worktreePath 為 null
    vi.spyOn(runStore, "getPodInstance").mockReturnValue({
      id: "inst-2",
      runId,
      podId,
      status: "running",
      claudeSessionId: null,
      errorMessage: null,
      triggeredAt: null,
      completedAt: null,
      autoPathwaySettled: "pending",
      directPathwaySettled: "not-applicable",
      worktreePath: null,
    });

    mockQueryGenerator = createSuccessGenerator();

    await claudeService.sendMessage(podId, "test", onStream, {
      runContext: { runId, canvasId: "test-canvas", sourcePodId: podId },
    });

    // 應使用 repositoryId 對應的原始路徑，而不是 worktree
    expect(claudeAgentSdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: "/test/repos/my-repo",
        }),
      }),
    );
  });

  it("Normal mode 下 cwd 解析邏輯完全不變（不受 worktree 邏輯影響）", async () => {
    const podId = "test-pod-id";

    const mockPod = createMockPod({ repositoryId: "my-repo" });

    vi.spyOn(podStore, "getByIdGlobal").mockReturnValue({
      canvasId: "test-canvas",
      pod: mockPod as any,
    });

    const getPodInstanceSpy = vi.spyOn(runStore, "getPodInstance");

    mockQueryGenerator = createSuccessGenerator();

    // Normal mode：不傳 runOptions
    await claudeService.sendMessage(podId, "test", onStream);

    // Normal mode 下不應查詢 runStore
    expect(getPodInstanceSpy).not.toHaveBeenCalled();

    // cwd 使用 repositoryId 對應的路徑
    expect(claudeAgentSdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: "/test/repos/my-repo",
        }),
      }),
    );
  });
});
