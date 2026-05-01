import { describe, it, expect } from "vitest";
import {
  getProvider,
  providerRegistry,
  resolveModelWithFallback,
} from "../../src/services/provider/index.js";
import {
  CODEX_AVAILABLE_MODELS,
  GEMINI_AVAILABLE_MODELS,
} from "../../src/services/provider/capabilities.js";

// ================================================================
// providerRegistry
// ================================================================
describe("providerRegistry", () => {
  it("應包含 claude 與 codex", () => {
    expect(Object.keys(providerRegistry)).toContain("claude");
    expect(Object.keys(providerRegistry)).toContain("codex");
  });

  it("應包含 gemini", () => {
    expect(Object.keys(providerRegistry)).toContain("gemini");
    expect(providerRegistry.gemini).toBeDefined();
  });
});

// ================================================================
// getProvider — metadata.capabilities
// ================================================================
describe("getProvider().metadata.capabilities", () => {
  it("claude 的 capabilities 應全部為 true（runMode 已移除）", () => {
    const caps = getProvider("claude").metadata.capabilities;

    expect(caps.chat).toBe(true);
    expect(caps.plugin).toBe(true);
    expect(caps.repository).toBe(true);
    expect(caps.command).toBe(true);
    expect(caps.mcp).toBe(true);
  });

  it("codex 的 capabilities 中 chat=true、command=true、repository=true、plugin=true、mcp=true", () => {
    const caps = getProvider("codex").metadata.capabilities;

    expect(caps.chat).toBe(true);
    expect(caps.plugin).toBe(true);
    expect(caps.repository).toBe(true);
    expect(caps.command).toBe(true);
    expect(caps.mcp).toBe(true);
  });
});

// ================================================================
// getProvider().metadata.availableModels
// ================================================================
describe("getProvider().metadata.availableModels", () => {
  it("claude 的 availableModels 應為 Sonnet / Opus / Haiku 三筆且 label + value 完全一致", () => {
    const models = getProvider("claude").metadata.availableModels;

    // 明確斷言長度與每筆內容，避免順序改動或缺漏未被捕捉
    // Sonnet 為第一筆（前端 getDefaultModel 取 [0]，對齊 defaultOptions.model）
    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({ label: "Sonnet", value: "sonnet" });
    expect(models[1]).toEqual({ label: "Opus", value: "opus" });
    expect(models[2]).toEqual({ label: "Haiku", value: "haiku" });
  });

  it("codex 的 availableModels 應為 GPT-5.4 / GPT-5.5 / GPT-5.4-mini 三筆且 label + value 完全一致", () => {
    const models = getProvider("codex").metadata.availableModels;

    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({ label: "GPT-5.4", value: "gpt-5.4" });
    expect(models[1]).toEqual({ label: "GPT-5.5", value: "gpt-5.5" });
    expect(models[2]).toEqual({ label: "GPT-5.4-mini", value: "gpt-5.4-mini" });
  });

  it("claude 與 codex 的 availableModels 應為 frozen，避免前後端共用清單被意外改動", () => {
    expect(
      Object.isFrozen(getProvider("claude").metadata.availableModels),
    ).toBe(true);
    expect(Object.isFrozen(getProvider("codex").metadata.availableModels)).toBe(
      true,
    );
  });
});

// ================================================================
// getProvider
// ================================================================
describe("getProvider", () => {
  it("getProvider('claude') 應回傳 metadata.name === 'claude' 的 ClaudeProvider 實例", () => {
    const provider = getProvider("claude");

    expect(provider).toBeDefined();
    expect(provider.metadata.name).toBe("claude");
  });

  it("getProvider('codex') 應回傳 metadata.name === 'codex' 的 CodexProvider 實例", () => {
    const provider = getProvider("codex");

    expect(provider).toBeDefined();
    expect(provider.metadata.name).toBe("codex");
  });

  it("連續呼叫同一 ProviderName 應回傳相同實例（直接從 providerRegistry 讀取）", () => {
    const first = getProvider("claude");
    const second = getProvider("claude");

    // 嚴格相等：同一個物件參考
    expect(first).toBe(second);
  });

  it("getProvider('gemini') 應回傳 metadata.name === 'gemini' 的 GeminiProvider 實例", () => {
    const provider = getProvider("gemini");

    expect(provider).toBeDefined();
    expect(provider.metadata.name).toBe("gemini");
  });
});

// ================================================================
// resolveModelWithFallback — gemini
// ================================================================
describe("resolveModelWithFallback — gemini", () => {
  it("gemini 傳入合法 model 時應原值回傳，didFallback=false", () => {
    const validModel = GEMINI_AVAILABLE_MODELS[0].value;
    const result = resolveModelWithFallback("gemini", validModel);

    expect(result.resolved).toBe(validModel);
    expect(result.didFallback).toBe(false);
  });

  it("gemini 傳入合法 model 'gemini-2.5-pro' 時 resolved === 'gemini-2.5-pro'", () => {
    const result = resolveModelWithFallback("gemini", "gemini-2.5-pro");

    expect(result.resolved).toBe("gemini-2.5-pro");
    expect(result.didFallback).toBe(false);
  });

  it("gemini 傳入非法 model 時應 fallback 為 geminiProvider 預設 model", () => {
    const defaultModel = getProvider("gemini").metadata.defaultOptions as {
      model: string;
    };
    const result = resolveModelWithFallback("gemini", "invalid model");

    expect(result.resolved).toBe(defaultModel.model);
    expect(result.didFallback).toBe(true);
  });
});

// ================================================================
// CODEX_AVAILABLE_MODELS 每個 value 符合 MODEL_RE
// ================================================================
describe("CODEX_AVAILABLE_MODELS — 每個 value 符合 MODEL_RE", () => {
  // MODEL_RE = /^[a-zA-Z0-9._-]+$/
  // 用與 codexProvider 相同的規則驗證，確保所有合法 model 均可通過 CLI 注入防護
  const MODEL_RE = /^[a-zA-Z0-9._-]+$/;

  it("CODEX_AVAILABLE_MODELS 的每個 value 都應符合 MODEL_RE", () => {
    for (const { value } of CODEX_AVAILABLE_MODELS) {
      expect(MODEL_RE.test(value)).toBe(true);
    }
  });
});
