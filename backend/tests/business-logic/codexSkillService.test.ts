import { describe, expect, it } from "vitest";
import {
  CodexSkillService,
  resolveCodexSkillOrigin,
} from "../../src/services/codex/codexSkillService.js";

function makeLoader() {
  return async () => [
    {
      name: "review",
      description: "Review changes",
      path: "/home/test/.codex/skills/.system/review/SKILL.md",
      scope: "user" as const,
      enabled: true,
    },
    {
      name: "repo-plan",
      description: "Plan repository changes",
      path: "/repo/.agents/skills/repo-plan/SKILL.md",
      scope: "repo" as const,
      enabled: true,
    },
    {
      name: "admin-only",
      description: "Disabled by policy",
      path: "/skills/admin-only/SKILL.md",
      scope: "admin" as const,
      enabled: false,
    },
  ];
}

describe("CodexSkillService", () => {
  it("列出安全的 Skill metadata，不把絕對路徑送到前端", async () => {
    const service = new CodexSkillService(makeLoader());
    const result = await service.list("/repo");

    expect(result.items[0]).toEqual({
      key: "user:review",
      name: "review",
      description: "Review changes",
      scope: "user",
      origin: "official",
      globallyEnabled: true,
    });
    expect(result.items[0]).not.toHaveProperty("path");
    expect(result.runtimeEntries[0]?.path).toBe(
      "/home/test/.codex/skills/.system/review/SKILL.md",
    );
    expect(result.items[1]?.origin).toBe("custom");
  });

  it("依 Codex 官方目錄與 OpenAI plugin namespace 區分官方和自行安裝 Skills", () => {
    expect(
      resolveCodexSkillOrigin(
        "/home/test/.codex/skills/.system/openai-docs/SKILL.md",
      ),
    ).toBe("official");
    expect(
      resolveCodexSkillOrigin(
        "/home/test/.codex/plugins/cache/openai-primary-runtime/documents/skills/documents/SKILL.md",
      ),
    ).toBe("official");
    expect(
      resolveCodexSkillOrigin(
        "/home/test/.codex/plugins/cache/personal/soap-toolkit/skills/bug/SKILL.md",
      ),
    ).toBe("custom");
    expect(
      resolveCodexSkillOrigin(
        "/home/test/.codex/skills/generate2dsprite/SKILL.md",
      ),
    ).toBe("custom");
  });

  it("舊 Pod 首次初始化維持全關，之後只保留有效白名單", async () => {
    const service = new CodexSkillService(makeLoader());
    const { runtimeEntries } = await service.list("/repo");

    expect(service.resolveSelectedKeys([], false, runtimeEntries)).toEqual([]);
    expect(
      service.resolveSelectedKeys(
        ["user:review", "admin:admin-only", "missing:skill", "user:review"],
        true,
        runtimeEntries,
      ),
    ).toEqual(["user:review"]);
  });

  it("為每個已發現 Skill 產生單次執行覆寫，未選與全域停用項目保持關閉", async () => {
    const service = new CodexSkillService(makeLoader());
    const { runtimeEntries } = await service.list("/repo");
    const args = service.buildRuntimeConfigArgs(
      ["user:review", "admin:admin-only"],
      runtimeEntries,
    );

    expect(args[0]).toBe("-c");
    expect(args[1]).toContain(
      '{path="/home/test/.codex/skills/.system/review/SKILL.md",enabled=true}',
    );
    expect(args[1]).toContain(
      '{path="/repo/.agents/skills/repo-plan/SKILL.md",enabled=false}',
    );
    expect(args[1]).toContain(
      '{path="/skills/admin-only/SKILL.md",enabled=false}',
    );
  });
});
