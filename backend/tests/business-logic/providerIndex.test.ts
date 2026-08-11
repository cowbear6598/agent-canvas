import { describe, expect, it } from "vitest";
import {
  getProvider,
  resolveModelWithFallback,
} from "../../src/services/provider/index.js";

describe("resolveModelWithFallback — claude / codex", () => {
  it("claude 傳入合法 model 時應原值回傳，didFallback=false", () => {
    const result = resolveModelWithFallback("claude", "sonnet");

    expect(result.resolved).toBe("sonnet");
    expect(result.didFallback).toBe(false);
  });

  it("codex 傳入合法 model 'gpt-5.6-luna' 時維持原值", () => {
    const result = resolveModelWithFallback("codex", "gpt-5.6-luna");

    expect(result.resolved).toBe("gpt-5.6-luna");
    expect(result.didFallback).toBe(false);
  });

  it("codex 傳入已退役的 gpt-5.4 時應 fallback 為 gpt-5.6-luna", () => {
    const result = resolveModelWithFallback("codex", "gpt-5.4");

    expect(result.resolved).toBe("gpt-5.6-luna");
    expect(result.didFallback).toBe(true);
  });

  it("claude 傳入非法 model 時應 fallback 為 claude 預設 model", () => {
    const defaultModel = getProvider("claude").metadata.defaultOptions as {
      model: string;
    };
    const result = resolveModelWithFallback("claude", "invalid model");

    expect(result.resolved).toBe(defaultModel.model);
    expect(result.didFallback).toBe(true);
  });

  it("opencode 使用 providerID/modelID 動態模型時不應被靜態清單 fallback", () => {
    const result = resolveModelWithFallback("opencode", "openai/gpt-4o");

    expect(result).toEqual({
      resolved: "openai/gpt-4o",
      didFallback: false,
    });
  });
});
