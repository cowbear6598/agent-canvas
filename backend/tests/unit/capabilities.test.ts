import { describe, it, expect } from "vitest";
import {
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
  GEMINI_AVAILABLE_MODELS,
  GEMINI_AVAILABLE_MODEL_VALUES,
  GEMINI_CAPABILITIES,
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

// ── A1（wire-up 回歸保護）──────────────────────────────────────────────────────
// 保護：確認 GEMINI_CAPABILITIES.mcp === true，即 Gemini Pod 已正確宣告 MCP 支援。
// 若未來有人誤將 mcp 改為 false 或刪除此欄位，CI 會立刻報錯。
describe("GEMINI_CAPABILITIES capability 回歸測試", () => {
  it("A1: GEMINI_CAPABILITIES.mcp 必須為 true（已透過 --allowed-mcp-server-names per-pod 隔離）", () => {
    expect(GEMINI_CAPABILITIES.mcp).toBe(true);
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
