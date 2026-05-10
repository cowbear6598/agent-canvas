import { describe, expect, it } from "vitest";
import {
  classifyGeminiTerminalError,
  GEMINI_CAPACITY_EXHAUSTED_ERROR_CODE,
  GEMINI_QUOTA_EXCEEDED_ERROR_CODE,
  GEMINI_RATE_LIMITED_ERROR_CODE,
} from "../../src/services/provider/geminiErrorClassifier.js";

describe("classifyGeminiTerminalError", () => {
  it("B1: quota wording 與 resource exhausted 並存時，應優先分類為 GEMINI_QUOTA_EXCEEDED", () => {
    const classified = classifyGeminiTerminalError(
      "RESOURCE_EXHAUSTED: 429 quota exceeded for this account",
    );

    expect(classified?.code).toBe(GEMINI_QUOTA_EXCEEDED_ERROR_CODE);
  });

  it("B2: rate limit wording 與 resource exhausted 並存時，應優先分類為 GEMINI_RATE_LIMITED", () => {
    const classified = classifyGeminiTerminalError(
      "429 RESOURCE_EXHAUSTED because of rate limit on this model",
    );

    expect(classified?.code).toBe(GEMINI_RATE_LIMITED_ERROR_CODE);
  });

  it("B3: 純 resource exhausted 而無 quota/rate wording 時，仍分類為 GEMINI_CAPACITY_EXHAUSTED", () => {
    const classified = classifyGeminiTerminalError(
      "RESOURCE_EXHAUSTED: model capacity exhausted",
    );

    expect(classified?.code).toBe(GEMINI_CAPACITY_EXHAUSTED_ERROR_CODE);
  });
});
