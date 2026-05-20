/**
 * Plugin Skill Catalog builder。
 *
 * 對齊 Claude Code / Codex CLI 的「progressive disclosure」做法：
 *   - 在 session 首輪把所有可用 skill 的 name / description / 絕對路徑列進 prompt
 *   - agent 自行用原生 Read 開該路徑的 SKILL.md、用原生 Bash 跑該目錄下的 scripts
 *   - 不再需要 MCP 代執行（read_skill / read_plugin_file / exec_plugin_script 全被淘汰）
 *
 * 設計權衡：
 *   - catalog 是「passive resource」，沒有強制呼叫的 gate（不像 Goal Runtime 是 workflow gate）
 *   - 與 Codex 的 `SKILLS_INTRO_WITH_ABSOLUTE_PATHS` 一致使用絕對路徑而非 alias
 *   - 為了 token budget，描述字串會被截斷（單條上限）；超過 entries 上限時整段省略最後的 entry
 *     並補一行說明，避免把整個 prompt 撐爆
 */

import path from "path";
import { listSkillsForPlugin, type SkillInfo } from "./pluginScanFs.js";
import { managedPluginStore } from "./managedPluginRegistry.js";

// ─── 型別 ────────────────────────────────────────────────────────────────────

/**
 * 單一 skill 的 catalog entry。
 * skillDir 為 SKILL.md 所在的絕對目錄路徑；skillMdPath = path.join(skillDir, "SKILL.md")。
 */
export interface PluginSkillCatalogEntry {
  pluginId: string;
  skillName: string;
  description: string;
  /** SKILL.md 檔案的絕對路徑 */
  skillMdPath: string;
  /** SKILL.md 所在目錄的絕對路徑（agent 解析相對路徑時的 base） */
  skillDir: string;
}

// ─── budget 設定 ─────────────────────────────────────────────────────────────

/**
 * 單條 description 字元上限，超過會被截斷並附「…」。
 * Codex 的描述也會做截斷處理；此處取保守值 200，避免某個 plugin 的描述塞滿整個 prompt。
 */
const DESCRIPTION_CHAR_LIMIT = 200;

/**
 * Catalog 最多列出幾個 skill，超過直接砍尾並在最後加一行「還有 N 個未列出」。
 * 50 個對應 Codex 的 ~2% context window budget 在 200k token 模型上的近似值。
 */
const MAX_CATALOG_ENTRIES = 50;

// ─── catalog 組裝 ────────────────────────────────────────────────────────────

function truncateDescription(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= DESCRIPTION_CHAR_LIMIT) return trimmed;
  return `${trimmed.slice(0, DESCRIPTION_CHAR_LIMIT - 1)}…`;
}

/**
 * 將 SkillInfo（skillName = 相對父目錄路徑）轉成含絕對路徑的 catalog entry。
 * skillName 為空字串時代表 root 單檔 SKILL.md，此時 skillDir = installPath。
 */
function toCatalogEntry(
  pluginId: string,
  installPath: string,
  skill: SkillInfo,
): PluginSkillCatalogEntry {
  const skillDir =
    skill.skillName === ""
      ? installPath
      : path.join(installPath, skill.skillName);
  return {
    pluginId,
    skillName: skill.skillName,
    description: truncateDescription(skill.description),
    skillMdPath: path.join(skillDir, "SKILL.md"),
    skillDir,
  };
}

/**
 * 依 pluginIds 掃所有 SKILL.md，組成 catalog。
 *
 * - 找不到 plugin record 或掃描失敗的單顆 plugin 直接 skip，不影響其他 plugin
 * - 不在此處做排序，保留 pluginIds 順序與 listSkillsForPlugin 內部順序（fs.readdir）
 */
export async function buildPluginSkillCatalog(
  pluginIds: readonly string[],
): Promise<PluginSkillCatalogEntry[]> {
  const perPluginEntries = await Promise.all(
    pluginIds.map(async (pluginId): Promise<PluginSkillCatalogEntry[]> => {
      const record = managedPluginStore.getById(pluginId);
      if (!record) return [];

      let skills: SkillInfo[];
      try {
        skills = await listSkillsForPlugin(record.installPath);
      } catch {
        return [];
      }

      return skills.map((skill) =>
        toCatalogEntry(pluginId, record.installPath, skill),
      );
    }),
  );

  return perPluginEntries.flat();
}

// ─── prompt 格式化 ───────────────────────────────────────────────────────────

/**
 * catalog 標頭與使用說明。對齊 Codex `SKILLS_INTRO_WITH_ABSOLUTE_PATHS`
 * 與 `SKILLS_HOW_TO_USE_WITH_ABSOLUTE_PATHS` 的精神：
 *   - 告訴 LLM 這是 passive resource（need-based discovery，不是強制呼叫）
 *   - 教 LLM 怎麼 progressively disclose：先看 description，需要時再 Read 對應 SKILL.md
 *   - 明示 relative path 要以 skill 目錄為 base 解析
 */
const CATALOG_INTRO_LINES = [
  "## Available Plugin Skills",
  "Below are skills installed via plugin manager and enabled for this Pod.",
  "Each entry is a `SKILL.md` describing a workflow you can follow when relevant.",
  "",
  "How to use:",
  "- Treat this as a passive catalog: only open a `SKILL.md` when its description matches the current task.",
  "- To use a skill, open its `SKILL.md` at the absolute path listed below using your Read tool.",
  "- When `SKILL.md` references relative paths (e.g. `scripts/foo.py`), resolve them against the skill directory listed alongside, not the current working directory.",
  "- Prefer running existing scripts under the skill directory over re-implementing them inline.",
];

function formatEntryLine(entry: PluginSkillCatalogEntry): string {
  // 對齊 Codex 的「- {name}: {description} (file: {path})」格式
  // 補上 dir 讓 LLM 能解析 relative path
  const label =
    entry.skillName === ""
      ? entry.pluginId
      : entry.skillName.replace(/\\/g, "/");
  const desc = entry.description || "(no description)";
  return `- ${label}: ${desc} (file: ${entry.skillMdPath}, dir: ${entry.skillDir})`;
}

/**
 * 將 catalog 組成 prompt 文字段落；catalog 為空時回傳空字串
 * （讓呼叫端決定要不要連 header 也省略）。
 */
export function formatPluginSkillCatalogPrompt(
  catalog: readonly PluginSkillCatalogEntry[],
): string {
  if (catalog.length === 0) return "";

  const lines: string[] = [...CATALOG_INTRO_LINES, ""];

  const limit = Math.min(catalog.length, MAX_CATALOG_ENTRIES);
  for (let i = 0; i < limit; i += 1) {
    lines.push(formatEntryLine(catalog[i]));
  }

  if (catalog.length > MAX_CATALOG_ENTRIES) {
    const remaining = catalog.length - MAX_CATALOG_ENTRIES;
    lines.push(
      `- … and ${remaining} more skill(s) not listed here due to catalog size limit.`,
    );
  }

  return lines.join("\n");
}
