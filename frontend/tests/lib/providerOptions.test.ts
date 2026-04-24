import { describe, it, expect } from "vitest";
import { getClaudeOptions, getCodexOptions } from "@/lib/providerOptions";
import type { Pod } from "@/types";

/** 建立最小合法的 Claude Pod */
function makeClaudePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-claude-1",
    name: "Claude Pod",
    x: 100,
    y: 150,
    rotation: 0,
    output: [],
    provider: "claude",
    providerConfig: { model: "claude-sonnet-4-5" },
    ...overrides,
  };
}

/** 建立最小合法的 Codex Pod */
function makeCodexPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-codex-1",
    name: "Codex Pod",
    x: 200,
    y: 250,
    rotation: 0,
    output: [],
    provider: "codex",
    providerConfig: { model: "codex-mini-latest" },
    ...overrides,
  };
}

describe("providerOptions", () => {
  // --- 情境 1：Claude Pod → getClaudeOptions 回 ClaudeOptions 且 model 正確 ---
  describe("getClaudeOptions", () => {
    it("Claude Pod 應回傳 ClaudeOptions 且 model 正確", () => {
      const pod = makeClaudePod();
      const options = getClaudeOptions(pod);
      expect(options).toEqual({ model: "claude-sonnet-4-5" });
      expect(options.model).toBe("claude-sonnet-4-5");
    });

    it("自訂 model 的 Claude Pod 應回傳對應 model", () => {
      const pod = makeClaudePod({
        providerConfig: { model: "claude-opus-4-5" },
      });
      const options = getClaudeOptions(pod);
      expect(options.model).toBe("claude-opus-4-5");
    });
  });

  // --- 情境 2：Codex Pod → getCodexOptions 回 CodexOptions 且 model 正確 ---
  describe("getCodexOptions", () => {
    it("Codex Pod 應回傳 CodexOptions 且 model 正確", () => {
      const pod = makeCodexPod();
      const options = getCodexOptions(pod);
      expect(options).toEqual({ model: "codex-mini-latest" });
      expect(options.model).toBe("codex-mini-latest");
    });

    it("自訂 model 的 Codex Pod 應回傳對應 model", () => {
      const pod = makeCodexPod({ providerConfig: { model: "gpt-4o" } });
      const options = getCodexOptions(pod);
      expect(options.model).toBe("gpt-4o");
    });
  });

  // --- 情境 3：provider 不符 helper → 拋錯 ---
  describe("provider 不符時拋錯", () => {
    it("對 Claude Pod 呼叫 getCodexOptions 應拋錯", () => {
      const pod = makeClaudePod();
      expect(() => getCodexOptions(pod)).toThrow(
        "Pod provider 為 claude，無法取得 CodexOptions",
      );
    });

    it("對 Codex Pod 呼叫 getClaudeOptions 應拋錯", () => {
      const pod = makeCodexPod();
      expect(() => getClaudeOptions(pod)).toThrow(
        "Pod provider 為 codex，無法取得 ClaudeOptions",
      );
    });

    it("未知 provider Pod 呼叫 getClaudeOptions 應拋錯", () => {
      const pod = makeClaudePod({ provider: "unknown-provider" });
      expect(() => getClaudeOptions(pod)).toThrow(
        "Pod provider 為 unknown-provider，無法取得 ClaudeOptions",
      );
    });

    it("未知 provider Pod 呼叫 getCodexOptions 應拋錯", () => {
      const pod = makeCodexPod({ provider: "unknown-provider" });
      expect(() => getCodexOptions(pod)).toThrow(
        "Pod provider 為 unknown-provider，無法取得 CodexOptions",
      );
    });
  });
});
