import { describe, it, expect } from "vitest";
import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
  GEMINI_CAPABILITIES,
  GEMINI_AVAILABLE_MODELS,
  GEMINI_AVAILABLE_MODEL_VALUES,
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

describe("GEMINI_CAPABILITIES smoke 測試", () => {
  it("GEMINI_CAPABILITIES 等於預期形狀", () => {
    expect(GEMINI_CAPABILITIES).toEqual({
      chat: true,
      plugin: false,
      repository: true,
      command: true,
      mcp: false,
    });
  });
});

describe("GEMINI_AVAILABLE_MODELS smoke 測試", () => {
  it("至少包含 gemini-2.5-pro", () => {
    const values = GEMINI_AVAILABLE_MODELS.map((m) => m.value);
    expect(values).toContain("gemini-2.5-pro");
  });

  it("至少包含 gemini-2.5-flash", () => {
    const values = GEMINI_AVAILABLE_MODELS.map((m) => m.value);
    expect(values).toContain("gemini-2.5-flash");
  });

  it("每個 model 都有非空的 label 與 value 字串", () => {
    for (const model of GEMINI_AVAILABLE_MODELS) {
      expect(typeof model.label).toBe("string");
      expect(model.label.length).toBeGreaterThan(0);
      expect(typeof model.value).toBe("string");
      expect(model.value.length).toBeGreaterThan(0);
    }
  });

  it("每個 model.value 符合 /^[a-zA-Z0-9._-]+$/ 格式", () => {
    const MODEL_VALUE_RE = /^[a-zA-Z0-9._-]+$/;
    for (const model of GEMINI_AVAILABLE_MODELS) {
      expect(
        MODEL_VALUE_RE.test(model.value),
        `model.value "${model.value}" 不符合格式`,
      ).toBe(true);
    }
  });
});

describe("GEMINI_AVAILABLE_MODEL_VALUES smoke 測試", () => {
  it("大小與 GEMINI_AVAILABLE_MODELS.length 一致", () => {
    expect(GEMINI_AVAILABLE_MODEL_VALUES.size).toBe(
      GEMINI_AVAILABLE_MODELS.length,
    );
  });

  it("GEMINI_AVAILABLE_MODELS 的每個 value 都在 GEMINI_AVAILABLE_MODEL_VALUES Set 中", () => {
    for (const model of GEMINI_AVAILABLE_MODELS) {
      expect(GEMINI_AVAILABLE_MODEL_VALUES.has(model.value)).toBe(true);
    }
  });

  it("GEMINI_AVAILABLE_MODEL_VALUES 的每個 value 都在 GEMINI_AVAILABLE_MODELS 中", () => {
    const modelValues = new Set(GEMINI_AVAILABLE_MODELS.map((m) => m.value));
    for (const v of GEMINI_AVAILABLE_MODEL_VALUES) {
      expect(modelValues.has(v)).toBe(true);
    }
  });
});
