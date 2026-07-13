import { beforeEach, describe, expect, it } from "vitest";
import {
  getStmts,
  initTestDb,
  resetDb,
} from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { sanitizeProviderConfigStrict } from "../../src/services/pod/providerConfigResolver.js";

describe("providerConfigResolver", () => {
  beforeEach(() => {
    resetStatements();
    resetDb();
    initTestDb();
  });

  it("拒絕未註冊 alias 的 opencode model", () => {
    expect(() =>
      sanitizeProviderConfigStrict({ model: "openai/gpt-4.1" }, "opencode"),
    ).toThrowError("Provider opencode 不支援此 model");
  });

  it("允許已註冊 alias 的 opencode model", () => {
    getStmts().modelAlias.insert.run({
      $id: "alias-opencode-1",
      $providerId: "opencode",
      $realProvider: "openai",
      $realModel: "gpt-4.1",
      $alias: "GPT-4.1",
      $orderIdx: 0,
      $createdAt: 1,
      $updatedAt: 1,
    });

    expect(
      sanitizeProviderConfigStrict({ model: "openai/gpt-4.1" }, "opencode"),
    ).toEqual({ model: "openai/gpt-4.1" });
  });

  it.each([
    ["claude", "claude-fable-5", "high"],
    ["codex", "gpt-5.6-sol", "medium"],
    ["codex", "gpt-5.6-terra", "medium"],
    ["codex", "gpt-5.6-luna", "medium"],
  ] as const)(
    "允許 %s 的新 model %s 並補入預設 thinking level",
    (provider, model, thinkingLevel) => {
      expect(sanitizeProviderConfigStrict({ model }, provider)).toEqual({
        model,
        thinkingLevel,
      });
    },
  );
});
