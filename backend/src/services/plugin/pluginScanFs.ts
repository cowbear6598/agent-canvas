/**
 * Plugin 檔案系統工具模組。
 *
 * 所有路徑操作都加上邊界驗證，防止路徑穿越攻擊。
 * 此模組不持有任何狀態，可直接 import 使用。
 */

import path from "path";
import fs from "fs/promises";

// ─── 型別 ────────────────────────────────────────────────────────────────────

export interface SkillInfo {
  skillName: string;
  description: string;
}

// ─── frontmatter / description 抽取 ─────────────────────────────────────────

// 從 SKILL.md 內容中抽取 description。
// 優先從 YAML frontmatter 的 description 欄位取值，若無則取第一個非空行。
function extractDescription(content: string): string {
  const trimmed = content.trim();

  // YAML frontmatter 判斷
  if (trimmed.startsWith("---")) {
    const endIdx = trimmed.indexOf("---", 3);
    if (endIdx !== -1) {
      const frontmatter = trimmed.slice(3, endIdx);
      for (const line of frontmatter.split("\n")) {
        const match = line.match(/^description\s*:\s*(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
    }
  }

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
    entries = dirents.map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
      isFile: d.isFile(),
    }));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isFile && entry.name === "SKILL.md") {
      const skillMdPath = path.join(currentDir, entry.name);
      let content: string;
      try {
        content = await fs.readFile(skillMdPath, "utf-8");
      } catch {
        continue;
      }
      const relDir = path.relative(installPath, currentDir);
      results.push({
        // root SKILL.md 用空字串表示；read_skill 端對應特例處理
        skillName: relDir,
        description: extractDescription(content),
      });
      continue;
    }

    if (entry.isDir) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      await walkForSkillMd(
        installPath,
        path.join(currentDir, entry.name),
        depth + 1,
        results,
      );
    }
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
