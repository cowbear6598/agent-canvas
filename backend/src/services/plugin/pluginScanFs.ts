/**
 * Plugin 檔案系統工具模組。
 *
 * 所有路徑操作都加上邊界驗證，防止路徑穿越攻擊。
 * 此模組不持有任何狀態，可直接 import 使用。
 */

import path from "path";
import fs from "fs/promises";
import { logger } from "../../utils/logger.js";

// ─── 型別 ────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  skillName: string;
  description: string;
}

// ─── frontmatter / description 抽取 ─────────────────────────────────────────

// 從 SKILL.md 內容中抽取 description。
// 優先從 YAML frontmatter 的 description 欄位取值，若無則取第一個非空行。
function extractFrontmatterDescription(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;

  for (const line of content.slice(3, endIndex).split("\n")) {
    const match = line.match(/^description\s*:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

function extractDescription(content: string): string {
  const trimmed = content.trim();
  const frontmatterDescription = extractFrontmatterDescription(trimmed);
  if (frontmatterDescription) return frontmatterDescription;

  // fallback：第一個非空行
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l && !l.startsWith("---")) {
      // 移除 markdown heading 符號
      return l.replace(/^#+\s*/, "").trim();
    }
  }

  return "";
}

// ─── walk 設定 ────────────────────────────────────────────────────────────────

/**
 * 遞迴掃描時跳過的目錄名稱：
 * - .git / node_modules：常見大型目錄，永遠不含 plugin skill
 * - dist / build / target：build 產出物
 * - .next / .nuxt / .cache / coverage：framework / 工具產出
 */
const SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
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

/**
 * 遞迴深度上限，避免 install 目錄含 symlink loop 或極深的雜訊樹時失控。
 * 8 層足以涵蓋實務上看到的 marketplace + sub-plugin + skills/<name> 結構。
 */
const SCAN_MAX_DEPTH = 8;

async function readSkillInfo(
  installPath: string,
  currentDir: string,
): Promise<SkillInfo | null> {
  const skillMdPath = path.join(currentDir, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    return {
      skillName: path.relative(installPath, currentDir),
      description: extractDescription(content),
    };
  } catch (error) {
    logger.warn(
      "Plugin",
      "Warn",
      `讀取 SKILL.md 失敗，路徑: ${skillMdPath}，原因: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ─── walkForSkillMd ──────────────────────────────────────────────────────────

/**
 * 從 currentDir 遞迴往下走，把每個 SKILL.md 收進 results。
 * 透過 relative dir path 衍生 skillName（root 為空字串）。
 * 不解析任何 metadata 檔案（plugin.json / marketplace.json），純粹結構無關地找檔。
 */
async function walkForSkillMd(
  installPath: string,
  currentDir: string,
  depth: number,
  results: SkillInfo[],
): Promise<void> {
  if (depth > SCAN_MAX_DEPTH) return;

  let entries: Array<{ name: string; isDir: boolean; isFile: boolean }>;
  try {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    entries = dirents
      .filter((d) => {
        if (d.isSymbolicLink()) return false;
        return true;
      })
      .map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
        isFile: d.isFile(),
      }));
  } catch (error) {
    logger.warn(
      "Plugin",
      "Warn",
      `掃描目錄失敗，路徑: ${currentDir}，原因: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  for (const entry of entries) {
    if (entry.isFile && entry.name === "SKILL.md") {
      const skill = await readSkillInfo(installPath, currentDir);
      if (skill) results.push(skill);
      continue;
    }

    if (!entry.isDir || SCAN_SKIP_DIRS.has(entry.name)) continue;
    await walkForSkillMd(
      installPath,
      path.join(currentDir, entry.name),
      depth + 1,
      results,
    );
  }
}

// ─── listSkillsForPlugin ─────────────────────────────────────────────────────

/**
 * 列出 installPath 內所有 SKILL.md，結構無關。
 *
 * 設計理由：
 * Claude Code / Codex / Cursor 等多種 plugin metadata 的 skill 內容最後都落在
 * 某層目錄的 SKILL.md（root 單檔、skills/<name>/SKILL.md、marketplace 內
 * plugins/<sub>/skills/<name>/SKILL.md、Codex `.codex-plugin/plugin.json` 用
 * `"skills": "./xxx/"` 自訂路徑、...）。為了不綁定任一格式，scanner 採遞迴搜尋
 * 而非解析 metadata：每找到一個 SKILL.md 就以「相對於 installPath 的父目錄路徑」
 * 作為 skillName。
 *
 * skillName 例：
 *   - root 單檔 SKILL.md       → ""
 *   - skills/plan/SKILL.md     → "skills/plan"
 *   - plugins/foo/SKILL.md     → "plugins/foo"
 *   - plugins/foo/skills/plan  → "plugins/foo/skills/plan"
 */
export async function listSkillsForPlugin(
  installPath: string,
): Promise<SkillInfo[]> {
  const results: SkillInfo[] = [];
  await walkForSkillMd(installPath, installPath, 0, results);
  return results;
}
