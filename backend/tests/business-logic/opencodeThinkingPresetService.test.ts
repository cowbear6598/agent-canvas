import { describe, expect, it } from "vitest";
import { buildOpencodeThinkingPresetSnapshot } from "../../src/services/provider/opencodeThinkingPresetService.js";

describe("buildOpencodeThinkingPresetSnapshot", () => {
  it("支援任意 provider：model metadata 有 reasoning 與 variants 時依官方 variants 產生 presets", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "google",
      modelID: "gemini-3.5-flash",
      providerMetadata: { id: "google" },
      modelMetadata: {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        reasoning: true,
        variants: {
          minimal: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: "minimal",
            },
          },
          low: {
            thinkingConfig: { includeThoughts: true, thinkingLevel: "low" },
          },
          medium: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel: "medium",
            },
          },
          high: {
            thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
          },
        },
      },
      fetchedAt: 123,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期 variants model 應產生 presets");

    expect(result.snapshot.defaultLevel).toBe("medium");
    expect(result.snapshot.levels).toEqual([
      { id: "minimal", label: "Minimal", options: { variant: "minimal" } },
      { id: "low", label: "Low", options: { variant: "low" } },
      { id: "medium", label: "Medium", options: { variant: "medium" } },
      { id: "high", label: "High", options: { variant: "high" } },
    ]);
    expect(result.snapshot.metadata).toMatchObject({
      providerID: "google",
      modelID: "gemini-3.5-flash",
    });
  });

  it("支援 OpenCode resolved model shape：capabilities.reasoning=true 時依 variants array 產生 presets", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "google",
      modelID: "gemini-3.5-flash",
      providerMetadata: { id: "google" },
      modelMetadata: {
        id: "gemini-3.5-flash",
        providerID: "google",
        name: "Gemini 3.5 Flash",
        capabilities: {
          reasoning: true,
          temperature: true,
          attachment: true,
          toolcall: true,
        },
        options: { variant: "high" },
        variants: [
          {
            id: "low",
            headers: {},
            body: {},
            aisdk: { provider: {}, request: {} },
          },
          {
            id: "high",
            headers: {},
            body: {},
            aisdk: { provider: {}, request: {} },
          },
        ],
      },
      fetchedAt: 124,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期 capabilities.reasoning 應產生 presets");

    expect(result.snapshot.defaultLevel).toBe("high");
    expect(result.snapshot.levels.map((level) => level.id)).toEqual([
      "low",
      "high",
    ]);
  });

  it("variants 中 disabled=true 的項目不應顯示為可選 preset", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "openai",
      modelID: "gpt-5",
      modelMetadata: {
        id: "gpt-5",
        name: "GPT-5",
        reasoning: true,
        variants: {
          fast: { disabled: true },
          high: { reasoningEffort: "high" },
        },
      },
      fetchedAt: 125,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期有效 variants 應產生 presets");

    expect(result.snapshot.defaultLevel).toBe("high");
    expect(result.snapshot.levels).toEqual([
      { id: "high", label: "High", options: { variant: "high" } },
    ]);
  });

  it("model 有 reasoning 但沒有 variants 時不自造 presets", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "custom",
      modelID: "reasoning-model",
      modelMetadata: {
        id: "reasoning-model",
        name: "Reasoning Model",
        reasoning: true,
      },
      fetchedAt: 126,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期缺少 variants 仍可建立 alias");

    expect(result.snapshot.levels).toEqual([]);
    expect(result.snapshot.defaultLevel).toBeNull();
  });

  it("model 不支援 reasoning 時仍回傳成功 snapshot，但沒有 thinking levels", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "google",
      modelID: "gemini-3.5-lite",
      modelMetadata: {
        id: "gemini-3.5-lite",
        name: "Gemini 3.5 Lite",
        reasoning: false,
      },
      fetchedAt: 456,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期無 reasoning model 仍可建立 alias");

    expect(result.snapshot.levels).toEqual([]);
    expect(result.snapshot.defaultLevel).toBeNull();
    expect(result.snapshot.metadata).toMatchObject({
      reason: "reasoning_not_supported",
    });
  });

  it("缺少 model metadata 時仍回傳成功 snapshot，避免新增 alias 被 metadata 阻擋", () => {
    const result = buildOpencodeThinkingPresetSnapshot({
      providerID: "custom-provider",
      modelID: "custom-model",
      fetchedAt: 789,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("預期 metadata 缺失時仍可建立 alias");

    expect(result.snapshot.levels).toEqual([]);
    expect(result.snapshot.defaultLevel).toBeNull();
    expect(result.snapshot.metadata).toMatchObject({
      providerID: "custom-provider",
      modelID: "custom-model",
      model: null,
      reason: "model_metadata_missing",
    });
  });
});
