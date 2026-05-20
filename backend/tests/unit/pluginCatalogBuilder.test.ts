/**
 * pluginCatalogBuilder 單元測試。
 *
 * 覆蓋：
 * - buildPluginSkillCatalog：依 pluginIds 掃出 SKILL.md，產生含絕對路徑的 entries
 * - formatPluginSkillCatalogPrompt：catalog 文字格式（Codex 對齊）、空 catalog、entries 上限截斷
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { createTmpDir, cleanupTmpDir } from "../helpers/tmpDirHelper.js";

const getByIdMock =
  vi.fn<(id: string) => { id: string; installPath: string } | null>();

vi.mock("../../src/services/plugin/managedPluginRegistry.js", () => ({
  managedPluginStore: {
    getById: (id: string) => getByIdMock(id),
  },
}));

const { buildPluginSkillCatalog, formatPluginSkillCatalogPrompt } =
  await import("../../src/services/plugin/pluginCatalogBuilder.js");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTmpDir("plugin-catalog-builder-test-");
  getByIdMock.mockReset();
});

afterEach(async () => {
  await cleanupTmpDir(tmpDir);
});

describe("buildPluginSkillCatalog", () => {
  it("空 pluginIds 時直接回空陣列，不會觸碰 store", async () => {
    const result = await buildPluginSkillCatalog([]);
    expect(result).toEqual([]);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it("找不到 plugin record 的 id 直接 skip，不影響其他 plugin", async () => {
    const skillDir = path.join(tmpDir, "skills", "foo");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Foo\nfoo 說明");

    getByIdMock.mockImplementation((id) =>
      id === "real" ? { id: "real", installPath: tmpDir } : null,
    );

    const result = await buildPluginSkillCatalog(["ghost", "real"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      pluginId: "real",
      skillName: "skills/foo",
      description: "Foo",
      skillMdPath: path.join(tmpDir, "skills", "foo", "SKILL.md"),
      skillDir,
    });
  });

  it("root 單檔 SKILL.md：skillName 為空字串，skillDir = installPath", async () => {
    await fs.writeFile(
      path.join(tmpDir, "SKILL.md"),
      "---\ndescription: root level skill\n---\n",
    );

    getByIdMock.mockReturnValue({ id: "p1", installPath: tmpDir });

    const result = await buildPluginSkillCatalog(["p1"]);

    expect(result).toHaveLength(1);
    expect(result[0].skillName).toBe("");
    expect(result[0].skillDir).toBe(tmpDir);
    expect(result[0].skillMdPath).toBe(path.join(tmpDir, "SKILL.md"));
    expect(result[0].description).toBe("root level skill");
  });

  it("超過 200 字元的 description 會被截斷並補上「…」", async () => {
    const skillDir = path.join(tmpDir, "skills", "long");
    await fs.mkdir(skillDir, { recursive: true });
    const longDesc = "x".repeat(250);
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\ndescription: ${longDesc}\n---\n`,
    );

    getByIdMock.mockReturnValue({ id: "p1", installPath: tmpDir });

    const result = await buildPluginSkillCatalog(["p1"]);

    expect(result).toHaveLength(1);
    expect(result[0].description.length).toBe(200);
    expect(result[0].description.endsWith("…")).toBe(true);
  });
});

describe("formatPluginSkillCatalogPrompt", () => {
  it("空 catalog 時回傳空字串（呼叫端據此決定是否注入）", () => {
    expect(formatPluginSkillCatalogPrompt([])).toBe("");
  });

  it("entries 以 Codex 對齊格式輸出（含 file 與 dir 絕對路徑）", () => {
    const text = formatPluginSkillCatalogPrompt([
      {
        pluginId: "soap-dev",
        skillName: "skills/plan",
        description: "規劃任務",
        skillMdPath: "/abs/soap-dev/skills/plan/SKILL.md",
        skillDir: "/abs/soap-dev/skills/plan",
      },
    ]);

    expect(text).toContain("## Available Plugin Skills");
    expect(text).toContain(
      "- skills/plan: 規劃任務 (file: /abs/soap-dev/skills/plan/SKILL.md, dir: /abs/soap-dev/skills/plan)",
    );
  });

  it("超過 50 條時截斷並補一行說明剩餘數量", () => {
    const entries = Array.from({ length: 55 }, (_, i) => ({
      pluginId: "p",
      skillName: `skills/skill-${i}`,
      description: `desc ${i}`,
      skillMdPath: `/abs/skill-${i}/SKILL.md`,
      skillDir: `/abs/skill-${i}`,
    }));

    const text = formatPluginSkillCatalogPrompt(entries);

    expect(text).toContain("- skills/skill-49:");
    expect(text).not.toContain("- skills/skill-50:");
    expect(text).toContain("and 5 more skill(s) not listed here");
  });

  it("description 為空時以 (no description) 替代", () => {
    const text = formatPluginSkillCatalogPrompt([
      {
        pluginId: "p",
        skillName: "skills/empty",
        description: "",
        skillMdPath: "/abs/empty/SKILL.md",
        skillDir: "/abs/empty",
      },
    ]);

    expect(text).toContain("- skills/empty: (no description)");
  });

  it('root 單檔 skill（skillName=""）以 pluginId 作為條目 label', () => {
    const text = formatPluginSkillCatalogPrompt([
      {
        pluginId: "my-plugin",
        skillName: "",
        description: "root entry",
        skillMdPath: "/abs/my-plugin/SKILL.md",
        skillDir: "/abs/my-plugin",
      },
    ]);

    expect(text).toContain("- my-plugin: root entry");
  });
});
