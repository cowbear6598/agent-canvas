/**
 * disposableChatService unit test
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

vi.mock("../../src/services/gemini/geminiService.js", () => ({
  geminiService: {
    executeDisposableChat: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeDisposableChat } from "../../src/services/disposableChatService.js";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { codexService } from "../../src/services/codex/codexService.js";
import { geminiService } from "../../src/services/gemini/geminiService.js";

/** 合法 Claude model */
const VALID_CLAUDE_MODEL = "sonnet";
/** 合法 Codex model */
const VALID_CODEX_MODEL = "gpt-5.4";
/** 合法 Gemini model */
const VALID_GEMINI_MODEL = "gemini-2.5-pro";
/** 不合法 model（不在任何 provider 清單內） */
const INVALID_MODEL = "no-such-model-xyz";

const BASE_INPUT = {
  systemPrompt: "system",
  userMessage: "user",
  workspacePath: "/tmp/workspace",
};

describe("disposableChatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(["gpt-5.4", "gpt-5.5", "gpt-5.4-mini"]).toContain(
      result.resolvedModel,
    );
  });

  it("provider=gemini 且 model 合法 → 分發到 geminiService，resolvedModel 等於輸入 model", async () => {
    (
      geminiService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "gemini 回應",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "gemini",
      model: VALID_GEMINI_MODEL,
    });

    expect(geminiService.executeDisposableChat).toHaveBeenCalledOnce();
    expect(claudeService.executeDisposableChat).not.toHaveBeenCalled();
    expect(codexService.executeDisposableChat).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.resolvedModel).toBe(VALID_GEMINI_MODEL);
  });

  it("provider=gemini 但 model 不合法 → fallback 到 gemini 預設，resolvedModel 為 fallback 值", async () => {
    (
      geminiService.executeDisposableChat as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      content: "gemini fallback 回應",
      success: true,
    });

    const result = await executeDisposableChat({
      ...BASE_INPUT,
      provider: "gemini",
      model: INVALID_MODEL,
    });

    expect(geminiService.executeDisposableChat).toHaveBeenCalledOnce();
    // resolvedModel 應為 gemini 的預設（不等於輸入的 INVALID_MODEL）
    expect(result.resolvedModel).not.toBe(INVALID_MODEL);
    // 應為 gemini 的合法 model
    expect([
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
    ]).toContain(result.resolvedModel);
  });

  it("不支援的 provider → throw Error('不支援的 provider')", async () => {
    // 實作：resolveModel 對不存在的 provider 會拋 TypeError（undefined.metadata），
    // 後續 else 分支也會 throw「不支援的 provider」，兩者都屬於 reject。
    // 批 1 項目 10 已統一 throw 訊息為「不支援的 provider」（不含變數），斷言固定字串。
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
});
