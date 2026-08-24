import { describe, expect, it } from "vitest";
import {
  countSelectedCodexSkillResources,
  groupCodexSkillResources,
} from "@/lib/codexSkillResource";
import type { CodexSkillAvailabilityItem } from "@/types/codexSkill";

const makeSkill = (
  overrides: Partial<CodexSkillAvailabilityItem>,
): CodexSkillAvailabilityItem => ({
  key: "user:standalone",
  name: "standalone",
  description: "Standalone skill",
  scope: "user",
  origin: "custom",
  globallyEnabled: true,
  ...overrides,
});

describe("Codex Skill 資源分組", () => {
  it("將同一個 Plugin 的 Skills 合併，獨立 Skill 保留單列", () => {
    const resources = groupCodexSkillResources([
      makeSkill({
        key: "user:soap-toolkit:sentry",
        name: "soap-toolkit:sentry",
      }),
      makeSkill({
        key: "user:soap-toolkit:simplify",
        name: "soap-toolkit:simplify",
      }),
      makeSkill({ key: "user:generate2dsprite", name: "generate2dsprite" }),
    ]);

    expect(resources).toHaveLength(2);
    expect(resources[0]?.label).toBe("soap-toolkit");
    expect(resources[0]!.items).toHaveLength(2);
    expect(resources[1]?.label).toBe("generate2dsprite");
  });

  it("Pod badge 以 Plugin 與獨立 Skill 的列數計算", () => {
    expect(
      countSelectedCodexSkillResources([
        "user:soap-toolkit:sentry",
        "user:soap-toolkit:simplify",
        "user:generate2dsprite",
      ]),
    ).toBe(2);
  });
});
