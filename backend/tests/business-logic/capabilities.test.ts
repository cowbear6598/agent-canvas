import { describe, it, expect } from "vitest";
import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
} from "../../src/services/provider/capabilities.js";

describe("CODEX_AVAILABLE_MODELS model value 在 CODEX_AVAILABLE_MODEL_VALUES 中", () => {
  it("CODEX_AVAILABLE_MODELS 的每個 value 都在 CODEX_AVAILABLE_MODEL_VALUES Set 中", () => {
    for (const model of CODEX_AVAILABLE_MODELS) {
      expect(CODEX_AVAILABLE_MODEL_VALUES.has(model.value)).toBe(true);
    }
  });

  it("CODEX_AVAILABLE_MODEL_VALUES 的大小與 CODEX_AVAILABLE_MODELS 一致", () => {
    expect(CODEX_AVAILABLE_MODEL_VALUES.size).toBe(
      CODEX_AVAILABLE_MODELS.length,
    );
  });

  it("每個 model 都有 label 與 value 字串", () => {
    for (const model of CODEX_AVAILABLE_MODELS) {
      expect(typeof model.label).toBe("string");
      expect(model.label.length).toBeGreaterThan(0);
      expect(typeof model.value).toBe("string");
      expect(model.value.length).toBeGreaterThan(0);
    }
  });
});

describe("CLAUDE_AVAILABLE_MODELS model value 在 CLAUDE_AVAILABLE_MODEL_VALUES 中", () => {
  it("CLAUDE_AVAILABLE_MODELS 的每個 value 都在 CLAUDE_AVAILABLE_MODEL_VALUES Set 中", () => {
    for (const model of CLAUDE_AVAILABLE_MODELS) {
      expect(CLAUDE_AVAILABLE_MODEL_VALUES.has(model.value)).toBe(true);
    }
  });
});
