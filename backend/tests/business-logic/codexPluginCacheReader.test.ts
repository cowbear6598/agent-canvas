import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanupTmpDir,
  createTmpDir,
  overrideEnv,
} from "../helpers/tmpDirHelper.js";
import { readCodexPluginCache } from "../../src/services/codex/codexPluginCacheReader.js";

describe("codexPluginCacheReader", () => {
  let tmpRoot: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tmpRoot = await createTmpDir("ccc-codex-plugin-cache-");
    restoreEnv = overrideEnv({ CODEX_HOME: path.join(tmpRoot, ".codex") });
  });

  afterEach(async () => {
    restoreEnv();
    await cleanupTmpDir(tmpRoot);
  });

  it("直接從 Plugin manifest 讀取 Skills 與 MCP", async () => {
    const pluginRoot = path.join(
      tmpRoot,
      ".codex",
      "plugins",
      "cache",
      "openai-curated",
      "docs",
      "1.0.0",
    );
    await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await fs.mkdir(path.join(pluginRoot, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "docs",
        skills: "./skills",
        mcpServers: {
          search: { command: "node", args: ["server.js"] },
          remote: { url: "https://example.com/mcp" },
        },
      }),
    );

    const entries = await readCodexPluginCache();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      pluginId: "docs@openai-curated",
      pluginName: "docs",
      source: "official",
      skillRoots: [path.join(pluginRoot, "skills")],
    });
    expect(entries[0]?.mcpServers).toEqual([
      expect.objectContaining({ name: "search", transport: "stdio" }),
      expect.objectContaining({ name: "remote", transport: "http" }),
    ]);
  });

  it("同一 Plugin 有多個 cache 版本時只保留最新 materialized 版本", async () => {
    const pluginRoot = path.join(
      tmpRoot,
      ".codex",
      "plugins",
      "cache",
      "personal",
      "toolkit",
    );
    for (const version of ["2.0.0", "10.0.0"]) {
      const versionRoot = path.join(pluginRoot, version);
      await fs.mkdir(path.join(versionRoot, ".codex-plugin"), { recursive: true });
      await fs.writeFile(
        path.join(versionRoot, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "toolkit", skills: "./skills" }),
      );
    }

    const entries = await readCodexPluginCache();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      pluginId: "toolkit@personal",
      rootPath: path.join(pluginRoot, "10.0.0"),
    });
  });

  it("單一 manifest 格式錯誤時仍保留其他 Plugin", async () => {
    const cacheRoot = path.join(tmpRoot, ".codex", "plugins", "cache", "personal");
    const validRoot = path.join(cacheRoot, "valid", "1");
    const brokenRoot = path.join(cacheRoot, "broken", "1");
    await fs.mkdir(path.join(validRoot, ".codex-plugin"), { recursive: true });
    await fs.mkdir(path.join(brokenRoot, ".codex-plugin"), { recursive: true });
    await fs.writeFile(
      path.join(validRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "valid", skills: "./skills" }),
    );
    await fs.writeFile(
      path.join(brokenRoot, ".codex-plugin", "plugin.json"),
      "{not-json",
    );

    expect((await readCodexPluginCache()).map((entry) => entry.pluginName)).toEqual([
      "valid",
    ]);
  });
});
