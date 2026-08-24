import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanupTmpDir,
  createTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";
import { resetCodexMcpCache } from "../../src/services/mcp/codexMcpReader.js";
import { readCodexSkills } from "../../src/services/codex/codexSkillReader.js";

async function writeSkill(
  skillRoot: string,
  name: string,
  description: string,
): Promise<string> {
  const skillPath = path.join(skillRoot, name, "SKILL.md");
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  );
  return skillPath;
}

describe("codexSkillReader", () => {
  let tmpRoot: string;
  let codexHome: string;
  let userSkills: string;
  let adminSkills: string;
  let configPath: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tmpRoot = await createTmpDir("ccc-codex-skill-reader-");
    codexHome = path.join(tmpRoot, ".codex");
    userSkills = path.join(tmpRoot, ".agents", "skills");
    adminSkills = path.join(tmpRoot, "admin-skills");
    configPath = path.join(codexHome, "config.toml");
    await fs.mkdir(codexHome, { recursive: true });
    restoreEnv = overrideEnv({
      CODEX_HOME: codexHome,
      CODEX_CONFIG_PATH: configPath,
      CODEX_USER_SKILLS_DIR: userSkills,
      CODEX_ADMIN_SKILLS_DIR: adminSkills,
    });
    resetCodexMcpCache();
  });

  afterEach(async () => {
    resetCodexMcpCache();
    restoreEnv();
    await cleanupTmpDir(tmpRoot);
  });

  it("搜尋 repo、user、admin、system 與 Plugin Skills", async () => {
    const repoRoot = path.join(tmpRoot, "repo");
    const cwd = path.join(repoRoot, "packages", "app");
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await fs.mkdir(cwd, { recursive: true });
    await writeSkill(path.join(repoRoot, ".agents", "skills"), "repo-plan", "Repo");
    const userSkillPath = await writeSkill(userSkills, "user-review", "User");
    await writeSkill(adminSkills, "admin-audit", "Admin");
    await writeSkill(path.join(codexHome, "skills", ".system"), "system-docs", "System");

    const pluginRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "personal",
      "toolkit",
      "1.0.0",
    );
    await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "toolkit", skills: "./skills" }),
    );
    await writeSkill(path.join(pluginRoot, "skills"), "bug", "Bug");

    await fs.writeFile(
      configPath,
      `[[skills.config]]\npath = ${JSON.stringify(userSkillPath)}\nenabled = false\n`,
    );

    const skills = await readCodexSkills(cwd, false);

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "repo-plan", scope: "repo" }),
        expect.objectContaining({
          name: "user-review",
          scope: "user",
          enabled: false,
        }),
        expect.objectContaining({ name: "admin-audit", scope: "admin" }),
        expect.objectContaining({ name: "system-docs", scope: "system" }),
        expect.objectContaining({ name: "toolkit:bug", scope: "user" }),
      ]),
    );
  });

  it("支援 symlink skill 目錄且避免重複掃描", async () => {
    const targetRoot = path.join(tmpRoot, "shared-skills");
    await writeSkill(targetRoot, "linked", "Linked");
    await fs.mkdir(userSkills, { recursive: true });
    await fs.symlink(path.join(targetRoot, "linked"), path.join(userSkills, "linked"));
    await fs.writeFile(configPath, "");
    const cwd = path.join(tmpRoot, "workspace");
    await fs.mkdir(cwd, { recursive: true });

    const skills = await readCodexSkills(cwd, false);

    expect(skills.filter((skill) => skill.name === "linked")).toHaveLength(1);
  });
});
