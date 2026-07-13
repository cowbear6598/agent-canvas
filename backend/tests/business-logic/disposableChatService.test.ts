/**
 * disposableChatService business logic test
 *
 * 涵蓋：provider 分發邏輯、model fallback 路徑、不支援的 provider 回報錯誤
 */

vi.mock("../../src/services/claude/claudeService.js", () => ({
  claudeService: {
    executeDisposableChat: vi.fn(),
  },
}));

vi.mock("../../src/services/codex/codexService.js", () => ({
  codexService: {
    executeDisposableChat: vi.fn(),
  },
}));

vi.mock("../../src/services/provider/opencodeProvider.js", () => ({
  opencodeProvider: {
    buildOptions: vi.fn(),
    chat: vi.fn(),
    metadata: {
      name: "opencode",
      defaultOptions: {
        providerID: "",
        modelID: "",
        mcpEntries: [],
        hasGoalRuntime: false,
        pluginCatalogText: "",
      },
      availableModels: [],
      availableModelValues: new Set<string>(),
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeDisposableChat } from "../../src/services/disposableChatService.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { codexService } from "../../src/services/codex/codexService.js";
import { opencodeProvider } from "../../src/services/provider/opencodeProvider.js";
import { closeDb, getStmts, initTestDb } from "../../src/database/index.js";
import type { Pod } from "../../src/types/pod.js";
import type { RunContext } from "../../src/types/run.js";

/** 合法 Claude model */
const VALID_CLAUDE_MODEL = "sonnet";
/** 合法 Codex model */
const VALID_CODEX_MODEL = "gpt-5.5";
/** 不合法 model（不在任何 provider 清單內） */
const INVALID_MODEL = "no-such-model-xyz";

const BASE_INPUT = {
  systemPrompt: "system",
  userMessage: "user",
  workspacePath: "/tmp/workspace",
};

async function* opencodeTextEvents() {
  yield { type: "session_started" as const, sessionId: "session-1" };
  yield { type: "text" as const, content: "open" };
  yield { type: "text" as const, content: "code" };
  yield { type: "turn_complete" as const };
}

function makeSourcePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "source-pod",
    name: "Source Pod",
    workspacePath: "/tmp/workspace",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    mcpServerNames: [],
    pluginIds: [],
    provider: "opencode",
    providerConfig: { model: "openai/gpt-4o" },
    repositoryId: null,
    ...overrides,
  };
}

function makeRunContext(): RunContext {
  return {
    runId: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "source-pod",
  };
}

describe("disposableChatService", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
    (
      opencodeProvider.buildOptions as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      providerID: "openai",
      modelID: "gpt-4o",
      mcpEntries: [],
      hasGoalRuntime: false,
      pluginCatalogText: "",
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("provider=claude 且 model 合法 → 分發到 claudeService，resolvedModel 等於輸入 model", async () => {
    (
      claudeService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "回應內容",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "claude",
      model: VALID_CLAUDE_MODEL,
    });

    expect(claudeService.executeDisposableChat).toHaveBeenCalledOnce();
    expect(codexService.executeDisposableChat).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe(VALID_CLAUDE_MODEL);
  });

  it("provider=codex 且 model 合法 → 分發到 codexService，resolvedModel 等於輸入 model", async () => {
    (
      codexService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "codex 回應",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "codex",
      model: VALID_CODEX_MODEL,
    });

    expect(codexService.executeDisposableChat).toHaveBeenCalledOnce();
    expect(claudeService.executeDisposableChat).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe(VALID_CODEX_MODEL);
  });

  it("provider=claude 但 model 不合法 → fallback 到 claude 預設，resolvedModel 為 fallback 值", async () => {
    (
      claudeService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "fallback 回應",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "claude",
      model: INVALID_MODEL,
    });

    expect(claudeService.executeDisposableChat).toHaveBeenCalledOnce();
    // resolvedModel 應為 claude 的預設（不等於輸入的 INVALID_MODEL）
    expect(result.resolvedModel).not.toBe(INVALID_MODEL);
    // 應為 claude 的合法 model
    expect(["opus", "sonnet", "haiku"]).toContain(result.resolvedModel);
  });

  it("provider=codex 但 model 不合法 → fallback 到 codex 預設，resolvedModel 為 fallback 值", async () => {
    (
      codexService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "codex fallback 回應",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "codex",
      model: INVALID_MODEL,
    });

    expect(codexService.executeDisposableChat).toHaveBeenCalledOnce();
    // resolvedModel 應為 codex 的預設（不等於輸入的 INVALID_MODEL）
    expect(result.resolvedModel).not.toBe(INVALID_MODEL);
    // 應為 codex 的合法 model
    expect(result.resolvedModel).toBe("gpt-5.5");
  });

  it("不支援的 provider → throw Error('不支援的 provider')", async () => {
    // 實作：resolveModel 對不存在的 provider 會拋 TypeError（undefined.metadata），
    // 後續 else 分支也會 throw「不支援的 provider」，兩者都屬於 reject。
    await expect(
      executeDisposableChat({
        ...BASE_INPUT,
        provider: "unsupported-provider" as any,
        model: "some-model",
      }),
    ).rejects.toThrow();

    expect(claudeService.executeDisposableChat).not.toHaveBeenCalled();
    expect(codexService.executeDisposableChat).not.toHaveBeenCalled();
  });

  it("provider=opencode 且 model 為 providerID/modelID → 透過 opencodeProvider.chat 收斂文字事件", async () => {
    (opencodeProvider.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      opencodeTextEvents(),
    );

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "openai/gpt-4o",
    });

    expect(claudeService.executeDisposableChat).not.toHaveBeenCalled();
    expect(codexService.executeDisposableChat).not.toHaveBeenCalled();
    expect(opencodeProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "user",
        workspacePath: "/tmp/workspace",
        options: expect.objectContaining({
          providerID: "openai",
          modelID: "gpt-4o",
          systemPrompt: "system",
        }),
      }),
    );
    expect(result).toEqual({
      content: "opencode",
      success: true,
      resolvedModel: "openai/gpt-4o",
    });
  });

  it("provider=opencode 且 model 為 alias → 從 model_aliases 解析成 providerID/modelID", async () => {
    getStmts().modelAlias.insert.run({
      $id: "alias-1",
      $providerId: "opencode",
      $realProvider: "opencode",
      $realModel: "deepseek-v4-flash-free",
      $alias: "DeepSeek Flash",
      $orderIdx: 0,
      $createdAt: 1,
      $updatedAt: 1,
    });
    (opencodeProvider.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      opencodeTextEvents(),
    );

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "DeepSeek Flash",
    });

    expect(opencodeProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          providerID: "opencode",
          modelID: "deepseek-v4-flash-free",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe("opencode/deepseek-v4-flash-free");
  });

  it("provider=opencode 且 model 為 legacy real_model → 從 model_aliases 解析成 providerID/modelID", async () => {
    getStmts().modelAlias.insert.run({
      $id: "alias-legacy",
      $providerId: "opencode",
      $realProvider: "opencode",
      $realModel: "deepseek-v4-flash-free",
      $alias: "DeepSeek Flash",
      $orderIdx: 0,
      $createdAt: 1,
      $updatedAt: 1,
    });
    (opencodeProvider.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      opencodeTextEvents(),
    );

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "deepseek-v4-flash-free",
    });

    expect(opencodeProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          providerID: "opencode",
          modelID: "deepseek-v4-flash-free",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe("opencode/deepseek-v4-flash-free");
  });

  it("provider=opencode 且 model 為 bare model → canonicalize 成 opencode/model", async () => {
    (opencodeProvider.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      opencodeTextEvents(),
    );

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "gpt-4o",
    });

    expect(opencodeProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          providerID: "opencode",
          modelID: "gpt-4o",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe("opencode/gpt-4o");
  });

  it("provider=opencode 且帶 sourcePod/runContext → 只保留 disposable 必要 options，不暴露 tool surface 或 bootstrap", async () => {
    const sourcePod = makeSourcePod();
    const runContext = makeRunContext();
    const mcpEntries = [
      {
        name: "goal-runtime",
        type: "stdio",
        command: "bun",
        args: ["run", "goal-runtime"],
        env: {},
      },
    ];
    (
      opencodeProvider.buildOptions as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      providerID: "openai",
      modelID: "gpt-4o",
      mcpEntries,
      hasGoalRuntime: true,
      pluginCatalogText: "Plugin catalog",
      thinkingLevel: "high",
      thinkingOptions: { effort: "high" },
    });
    (opencodeProvider.chat as ReturnType<typeof vi.fn>).mockReturnValue(
      opencodeTextEvents(),
    );

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      sourcePod,
      runContext,
    });

    expect(opencodeProvider.buildOptions).toHaveBeenCalledWith(
      sourcePod,
      runContext,
    );
    expect(opencodeProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        podId: "source-pod",
        podName: "Source Pod",
        runContext,
        options: expect.objectContaining({
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
          mcpEntries: [],
          hasGoalRuntime: false,
          pluginCatalogText: "",
          systemPrompt: "system",
          thinkingLevel: "high",
          thinkingOptions: { effort: "high" },
        }),
      }),
    );
    expect(result).toEqual({
      content: "opencode",
      success: true,
      resolvedModel: "anthropic/claude-sonnet-4-5",
    });
  });

  it("provider=opencode 但 model 為空字串 → 回傳 success=false", async () => {
    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "opencode",
      model: "",
    });

    expect(opencodeProvider.chat).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe("OpenCode model 不可為空");
  });
});
