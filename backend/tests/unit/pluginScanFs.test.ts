/**
 * pluginScanFs 單元測試
 *
 * 覆蓋以下測試案例：
 * - listSkillsForPlugin：結構無關地掃出所有 SKILL.md，skillName 為相對父目錄路徑
 *
 * 註：readSkillFile / readPluginFile / spawnPluginScript 已隨 Plugin MCP 精簡而移除
 * （改為 catalog-based 注入 + agent 原生 Read / Bash），故相關安全測試一併刪除。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { createTmpDir, cleanupTmpDir } from "../helpers/tmpDirHelper.js";
import { listSkillsForPlugin } from "../../src/services/plugin/pluginScanFs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTmpDir("plugin-scan-fs-test-");
});

afterEach(async () => {
  await cleanupTmpDir(tmpDir);
});

// ════════════════════════════════════════════════════════════════════════════
// listSkillsForPlugin
// ════════════════════════════════════════════════════════════════════════════

describe("listSkillsForPlugin", () => {
  it("標準 <root>/skills/<name>/SKILL.md 結構回傳 'skills/<name>' 形式 skillName", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(path.join(skillsDir, "foo"), { recursive: true });
    await fs.mkdir(path.join(skillsDir, "bar"), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "foo", "SKILL.md"),
      "# Foo Skill\nfoo 說明",
    );
    await fs.writeFile(
      path.join(skillsDir, "bar", "SKILL.md"),
      "# Bar Skill\nbar 說明",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(2);
    const names = result.map((s) => s.skillName).sort();
    expect(names).toEqual(["skills/bar", "skills/foo"]);
  });

  it("從 YAML frontmatter 的 description 欄位抽取 description", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(path.join(skillsDir, "alpha"), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "alpha", "SKILL.md"),
      `---\ndescription: 這是 frontmatter description\nauthor: test\n---\n\n# Alpha\n一些內容`,
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("skills/alpha");
    expect(result[0].description).toBe("這是 frontmatter description");
  });

  it("無 frontmatter 時從第一個非空行抽取 description（去掉 # 號）", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(path.join(skillsDir, "beta"), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "beta", "SKILL.md"),
      `# Beta Skill Title\n\n下面是說明`,
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("skills/beta");
    expect(result[0].description).toBe("Beta Skill Title");
  });

  it("沒有 SKILL.md 的目錄會被跳過", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(path.join(skillsDir, "with-skill"), { recursive: true });
    await fs.mkdir(path.join(skillsDir, "no-skill"), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "with-skill", "SKILL.md"),
      "# With Skill",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("skills/with-skill");
  });

  it("install dir 完全沒 SKILL.md 時回傳空陣列", async () => {
    const result = await listSkillsForPlugin(tmpDir);
    expect(result).toEqual([]);
  });

  it("非 SKILL.md 的檔案不會被當成 skill", async () => {
    const skillsDir = path.join(tmpDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "README.md"), "說明");

    const result = await listSkillsForPlugin(tmpDir);
    expect(result).toEqual([]);
  });

  it("root 單檔 SKILL.md（<root>/SKILL.md）回傳空字串 skillName", async () => {
    await fs.writeFile(
      path.join(tmpDir, "SKILL.md"),
      "# Root entry Skill\n入口說明",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("");
    expect(result[0].description).toBe("Root entry Skill");
  });

  it("marketplace 結構：<root>/plugins/<sub>/skills/<skill>/SKILL.md 完整路徑當 skillName", async () => {
    const subSkillsDir = path.join(tmpDir, "plugins", "soap-dev", "skills");
    await fs.mkdir(path.join(subSkillsDir, "plan"), { recursive: true });
    await fs.mkdir(path.join(subSkillsDir, "bug"), { recursive: true });
    await fs.writeFile(
      path.join(subSkillsDir, "plan", "SKILL.md"),
      "# Plan Skill\nplan 說明",
    );
    await fs.writeFile(
      path.join(subSkillsDir, "bug", "SKILL.md"),
      "# Bug Skill\nbug 說明",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(2);
    const names = result.map((s) => s.skillName).sort();
    expect(names).toEqual([
      "plugins/soap-dev/skills/bug",
      "plugins/soap-dev/skills/plan",
    ]);
  });

  it("混合結構：root SKILL.md + skills/<name> + plugins/<sub>/skills/<name> 同時並存皆會被掃出", async () => {
    // root 單檔
    await fs.writeFile(path.join(tmpDir, "SKILL.md"), "# Root Entry");

    // 標準
    await fs.mkdir(path.join(tmpDir, "skills", "top"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "skills", "top", "SKILL.md"),
      "# Top Skill",
    );

    // marketplace
    await fs.mkdir(path.join(tmpDir, "plugins", "subA", "skills", "nested"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "plugins", "subA", "skills", "nested", "SKILL.md"),
      "# Nested Skill",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(3);
    const names = result.map((s) => s.skillName).sort();
    expect(names).toEqual(["", "plugins/subA/skills/nested", "skills/top"]);
  });

  it("Codex 自訂 skills 路徑（<root>/custom/<name>/SKILL.md）也能掃出", async () => {
    const customDir = path.join(tmpDir, "my-custom-path", "translate");
    await fs.mkdir(customDir, { recursive: true });
    await fs.writeFile(path.join(customDir, "SKILL.md"), "# Translate");

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("my-custom-path/translate");
  });

  it(".git / node_modules 等目錄會被跳過", async () => {
    // .git 內如果剛好有 SKILL.md 不應被當成 skill
    await fs.mkdir(path.join(tmpDir, ".git", "fake-skill"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, ".git", "fake-skill", "SKILL.md"),
      "# Should be ignored",
    );

    // node_modules 同理
    await fs.mkdir(path.join(tmpDir, "node_modules", "pkg"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "node_modules", "pkg", "SKILL.md"),
      "# Should be ignored too",
    );

    // 一個合法的
    await fs.mkdir(path.join(tmpDir, "skills", "real"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "skills", "real", "SKILL.md"),
      "# Real Skill",
    );

    const result = await listSkillsForPlugin(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("skills/real");
  });
});
