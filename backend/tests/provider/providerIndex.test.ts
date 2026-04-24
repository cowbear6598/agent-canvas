import { describe, it, expect } from "vitest";
import {
  getProvider,
  providerRegistry,
} from "../../src/services/provider/index.js";

// ================================================================
// providerRegistry
// ================================================================
describe("providerRegistry", () => {
  it("應包含 claude 與 codex", () => {
    expect(Object.keys(providerRegistry)).toContain("claude");
    expect(Object.keys(providerRegistry)).toContain("codex");
  });
});

// ================================================================
// getProvider — metadata.capabilities
// ================================================================
describe("getProvider().metadata.capabilities", () => {
  it("claude 的 capabilities 應全部為 true", () => {
    const caps = getProvider("claude").metadata.capabilities;

    expect(caps.chat).toBe(true);
    expect(caps.outputStyle).toBe(true);
    expect(caps.skill).toBe(true);
    expect(caps.subAgent).toBe(true);
    expect(caps.repository).toBe(true);
    expect(caps.command).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.integration).toBe(true);
    expect(caps.runMode).toBe(true);
  });

  it("codex 的 capabilities 中 chat=true，其餘全部 false", () => {
    const caps = getProvider("codex").metadata.capabilities;

    expect(caps.chat).toBe(true);
    expect(caps.outputStyle).toBe(false);
    expect(caps.skill).toBe(false);
    expect(caps.subAgent).toBe(false);
    expect(caps.repository).toBe(false);
    expect(caps.command).toBe(false);
    expect(caps.mcp).toBe(false);
    expect(caps.integration).toBe(false);
    expect(caps.runMode).toBe(false);
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
});
