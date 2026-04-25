import { describe, it, expect } from "vitest";
import {
  CODEX_CAPABILITIES,
  CODEX_AVAILABLE_MODELS,
  CODEX_AVAILABLE_MODEL_VALUES,
  CLAUDE_CAPABILITIES,
  CLAUDE_AVAILABLE_MODELS,
  CLAUDE_AVAILABLE_MODEL_VALUES,
} from "../../src/services/provider/capabilities.js";

describe("CODEX_CAPABILITIES 能力旗標", () => {
  it("chat 應為 true", () => {
    expect(CODEX_CAPABILITIES.chat).toBe(true);
  });

  it("skill 應為 false（Codex 不支援 Skill）", () => {
    expect(CODEX_CAPABILITIES.skill).toBe(false);
  });

  it("subAgent 應為 false（Codex 不支援 SubAgent）", () => {
    expect(CODEX_CAPABILITIES.subAgent).toBe(false);
  });

  it("mcp 應為 false（Codex 不支援 MCP）", () => {
    expect(CODEX_CAPABILITIES.mcp).toBe(false);
  });

  it("integration 應為 false（Codex 不支援 Integration）", () => {
    expect(CODEX_CAPABILITIES.integration).toBe(false);
  });

  it("runMode 應為 false（Codex 不支援 Run 模式）", () => {
    expect(CODEX_CAPABILITIES.runMode).toBe(false);
  });

  it("repository 應為 true（Codex 支援 Repository）", () => {
    expect(CODEX_CAPABILITIES.repository).toBe(true);
  });

  it("command 應為 true（Codex 支援 Command）", () => {
    expect(CODEX_CAPABILITIES.command).toBe(true);
  });
});

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

describe("CLAUDE_CAPABILITIES 能力旗標", () => {
  it("所有能力應為 true（Claude 支援所有功能）", () => {
    expect(CLAUDE_CAPABILITIES.chat).toBe(true);
    expect(CLAUDE_CAPABILITIES.skill).toBe(true);
    expect(CLAUDE_CAPABILITIES.subAgent).toBe(true);
    expect(CLAUDE_CAPABILITIES.repository).toBe(true);
    expect(CLAUDE_CAPABILITIES.command).toBe(true);
    expect(CLAUDE_CAPABILITIES.mcp).toBe(true);
    expect(CLAUDE_CAPABILITIES.integration).toBe(true);
    expect(CLAUDE_CAPABILITIES.runMode).toBe(true);
  });
});

describe("CLAUDE_AVAILABLE_MODELS model value 在 CLAUDE_AVAILABLE_MODEL_VALUES 中", () => {
  it("CLAUDE_AVAILABLE_MODELS 的每個 value 都在 CLAUDE_AVAILABLE_MODEL_VALUES Set 中", () => {
    for (const model of CLAUDE_AVAILABLE_MODELS) {
      expect(CLAUDE_AVAILABLE_MODEL_VALUES.has(model.value)).toBe(true);
    }
  });
});
