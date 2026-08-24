import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";
import {
  readCodexPluginEnabledOverrides,
  readCodexSkillEnabledOverrides,
} from "../mcp/codexMcpReader.js";
import {
  getCodexHomePath,
  readCodexPluginCache,
} from "./codexPluginCacheReader.js";
import type { CodexSkillScope } from "./codexSkillService.js";

export interface CodexSkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: CodexSkillScope;
  enabled: boolean;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  shortDescription?: string;
  bodyStart: number;
}

const SKILL_SCAN_MAX_DEPTH = 10;
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
]);

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function decodeScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function readFrontmatterField(
  lines: string[],
  fieldNames: readonly string[],
): string | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (!match || !fieldNames.includes(match[1] ?? "")) continue;
    const rawValue = match[2] ?? "";
    if (rawValue !== ">" && rawValue !== "|") {
      const value = decodeScalar(rawValue);
      return value || undefined;
    }

    const block: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? "";
      if (line && !/^\s+/.test(line)) break;
      block.push(line.trim());
    }
    const separator = rawValue === ">" ? " " : "\n";
    const value = block.join(separator).trim();
    return value || undefined;
  }
  return undefined;
}

function parseFrontmatter(content: string): SkillFrontmatter {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { bodyStart: 0 };
  }

  const lines = normalized.split(/\r?\n/);
  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) return { bodyStart: 0 };
  const frontmatterLines = lines.slice(1, endIndex);
  return {
    name: readFrontmatterField(frontmatterLines, ["name"]),
    description: readFrontmatterField(frontmatterLines, ["description"]),
    shortDescription: readFrontmatterField(frontmatterLines, [
      "short-description",
      "short_description",
    ]),
    bodyStart: lines.slice(0, endIndex + 1).join("\n").length,
  };
}

function findBodyDescription(content: string, bodyStart: number): string {
  for (const rawLine of content.slice(bodyStart).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---") continue;
    return line.replace(/^#+\s*/, "").trim();
  }
  return "";
}

export function isCodexSystemSkillPath(skillPath: string): boolean {
  return skillPath.replaceAll("\\", "/").includes("/skills/.system/");
}

function resolveScope(
  skillPath: string,
  defaultScope: CodexSkillScope,
): CodexSkillScope {
  return isCodexSystemSkillPath(skillPath) ? "system" : defaultScope;
}

async function readSkill(
  skillPath: string,
  defaultScope: CodexSkillScope,
  namePrefix: string,
  enabledOverrides: ReadonlyMap<string, boolean>,
): Promise<CodexSkillMetadata | null> {
  try {
    const content = await fs.readFile(skillPath, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const baseName = frontmatter.name ?? path.basename(path.dirname(skillPath));
    if (!baseName) return null;
    const normalizedPath = path.resolve(skillPath);
    const description =
      frontmatter.description ?? findBodyDescription(content, frontmatter.bodyStart);

    return {
      name: `${namePrefix}${baseName}`,
      description,
      ...(frontmatter.shortDescription
        ? { shortDescription: frontmatter.shortDescription }
        : {}),
      path: normalizedPath,
      scope: resolveScope(normalizedPath, defaultScope),
      enabled: enabledOverrides.get(normalizedPath) ?? true,
    };
  } catch (error) {
    logger.warn(
      "Chat",
      "Warn",
      `讀取 Codex Skill 失敗：${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function scanSkillTree(
  currentPath: string,
  defaultScope: CodexSkillScope,
  namePrefix: string,
  enabledOverrides: ReadonlyMap<string, boolean>,
  results: CodexSkillMetadata[],
  visited: Set<string>,
  depth: number,
): Promise<void> {
  if (depth > SKILL_SCAN_MAX_DEPTH) return;

  let realPath: string;
  let entries: Dirent[];
  try {
    realPath = await fs.realpath(currentPath);
    if (visited.has(realPath)) return;
    visited.add(realPath);
    entries = await fs.readdir(realPath, { withFileTypes: true });
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn(
        "Chat",
        "Warn",
        `掃描 Codex Skills 目錄失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
    const skill = await readSkill(
      path.join(realPath, "SKILL.md"),
      defaultScope,
      namePrefix,
      enabledOverrides,
    );
    if (skill) results.push(skill);
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name === "SKILL.md") return;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return;
      await scanSkillTree(
        path.join(realPath, entry.name),
        defaultScope,
        namePrefix,
        enabledOverrides,
        results,
        visited,
        depth + 1,
      );
    }),
  );
}

async function findRepoSkillRoots(cwd: string): Promise<string[]> {
  const roots: string[] = [];
  const startPath = path.resolve(cwd);
  let currentPath = startPath;

  while (true) {
    roots.push(path.join(currentPath, ".agents", "skills"));
    try {
      await fs.access(path.join(currentPath, ".git"));
      return roots;
    } catch {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return [path.join(startPath, ".agents", "skills")];
      }
      currentPath = parentPath;
    }
  }
}

async function scanRoot(
  rootPath: string,
  scope: CodexSkillScope,
  namePrefix: string,
  enabledOverrides: ReadonlyMap<string, boolean>,
): Promise<CodexSkillMetadata[]> {
  const results: CodexSkillMetadata[] = [];
  await scanSkillTree(
    rootPath,
    scope,
    namePrefix,
    enabledOverrides,
    results,
    new Set(),
    0,
  );
  return results;
}

/** 直接搜尋 Codex 已知的 Skills 位置，不啟動 App Server。 */
export async function readCodexSkills(
  cwd: string,
  _forceReload: boolean,
): Promise<CodexSkillMetadata[]> {
  const enabledOverrides = new Map(
    readCodexSkillEnabledOverrides(cwd).map((entry) => [
      path.resolve(entry.path),
      entry.enabled,
    ]),
  );
  const pluginEnabledOverrides = new Map(
    readCodexPluginEnabledOverrides(cwd).map((entry) => [
      entry.pluginId,
      entry.enabled,
    ]),
  );
  const plugins = await readCodexPluginCache();
  const repoRoots = await findRepoSkillRoots(cwd);
  const userSkillRoot =
    process.env.CODEX_USER_SKILLS_DIR ?? path.join(os.homedir(), ".agents", "skills");
  const adminSkillRoot =
    process.env.CODEX_ADMIN_SKILLS_DIR ?? "/etc/codex/skills";

  const pluginSkills = await Promise.all(
    plugins.flatMap((plugin) => {
      const enabled =
        plugin.enabled &&
        pluginEnabledOverrides.get(plugin.pluginId) !== false &&
        pluginEnabledOverrides.get(plugin.pluginName) !== false;
      if (!enabled) return [];
      return plugin.skillRoots.map((skillRoot) =>
        scanRoot(
          skillRoot,
          "user",
          `${plugin.pluginName}:`,
          enabledOverrides,
        ),
      );
    }),
  );
  const repoSkills = await Promise.all(
    repoRoots.map((rootPath) =>
      scanRoot(rootPath, "repo", "", enabledOverrides),
    ),
  );
  const [userSkills, legacyAndSystemSkills, adminSkills] = await Promise.all([
    scanRoot(userSkillRoot, "user", "", enabledOverrides),
    scanRoot(
      path.join(getCodexHomePath(), "skills"),
      "user",
      "",
      enabledOverrides,
    ),
    scanRoot(adminSkillRoot, "admin", "", enabledOverrides),
  ]);

  const discoveredSkills = [
    ...pluginSkills.flat(),
    ...repoSkills.flat(),
    ...userSkills,
    ...legacyAndSystemSkills,
    ...adminSkills,
  ];

  const seenPaths = new Set<string>();
  const uniqueSkills = new Map<string, CodexSkillMetadata>();
  for (const skill of discoveredSkills) {
    if (seenPaths.has(skill.path)) continue;
    seenPaths.add(skill.path);
    const key = `${skill.scope}\0${skill.name}`;
    if (!uniqueSkills.has(key)) uniqueSkills.set(key, skill);
  }

  return [...uniqueSkills.values()];
}
