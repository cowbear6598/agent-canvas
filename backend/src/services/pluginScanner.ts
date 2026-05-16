/**
 * PluginScanner 模組：掃描 Claude 與 Codex 已安裝的 plugin 清單，
 * 回傳 InstalledPlugin[]。
 *
 * 主要 entry point：
 *   - {@link scanInstalledPlugins}（provider?: "claude" | "codex"）
 *     → 依 provider 掃描對應來源，套用 30 秒 per-provider TTL 快取後回傳清單。
 *   - {@link clearScanInstalledPluginsCache}（僅供測試使用）
 *     → 清除所有 per-provider 快取，強制下次呼叫重新讀檔。
 *
 * 資料來源：
 *   - Claude：~/.claude/plugins/installed_plugins.json（version 2 格式）
 *   - Codex：~/.codex/plugins/cache/<marketplace>/<pluginName>/<version>/
 */
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../utils/logger.js";
import { isPathWithinDirectory } from "../utils/pathValidator.js";

const INSTALLED_PLUGINS_PATH =
  process.env.CLAUDE_PLUGINS_INSTALLED_PATH ??
  path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");

const CODEX_PLUGINS_CACHE_DIR =
  process.env.CODEX_PLUGINS_CACHE_DIR ??
  path.join(os.homedir(), ".codex", "plugins", "cache");

/**
 * 解析 Claude plugins 根目錄路徑。
 * 優先讀取測試專用 env var CLAUDE_PLUGINS_ROOT_OVERRIDE，
 * 沒設時 fallback 為 os.homedir()/.claude/plugins（預設行為不變）。
 * 此 helper 使呼叫端在測試中可透過 env var 注入假路徑，
 * 不需修改任何預設行為，且不依賴 ESM 無法 spy 的 os.homedir()。
 */
function resolveClaudePluginsRoot(): string {
  return (
    process.env.CLAUDE_PLUGINS_ROOT_OVERRIDE ??
    path.join(os.homedir(), ".claude", "plugins")
  );
}

// 30 秒 TTL 快取，避免每次 buildClaudeOptions 都重讀磁碟
// per-source cache，key 為資料來源（"claude" / "codex"），
// 注意：每個來源的 plugin 只標記自己的 provider（以來源為界），
// 因此 scanInstalledPlugins(provider) 掃全部來源後以 compatibleProviders 過濾，
// 不會造成跨 provider 的 plugin 外洩。
type PluginSource = "claude" | "codex";
const CACHE_TTL_MS = 30000;
const pluginCache = new Map<
  PluginSource,
  { plugins: InstalledPlugin[]; expiresAt: number }
>();

/** 僅供測試使用：清除所有 per-source 快取，讓下一次呼叫重新讀檔 */
export function clearScanInstalledPluginsCache(): void {
  pluginCache.clear();
}

// plugin id 白名單格式：只允許字母、數字、點、底線、@、連字號
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9._@-]+$/;

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  installPath: string;
  repo: string;
  compatibleProviders: ("claude" | "codex")[];
}

interface PluginEntry {
  scope: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
  projectPath?: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginEntry[]>;
}

interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
}

function readManifest(manifestPath: string): PluginManifest | null {
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as PluginManifest;
  } catch (error) {
    // 檔案不存在屬正常情況（plugin 可能尚未安裝），靜默略過；
    // 其他錯誤（如 JSON 解析失敗）則記錄 warn 以便排查
    const isNotFound =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!isNotFound) {
      // 以 ~ 取代 homedir，避免 log 洩漏使用者帳號路徑
      const home = os.homedir();
      const displayPath = manifestPath.startsWith(home)
        ? `~${manifestPath.substring(home.length)}`
        : manifestPath;
      logger.warn(
        "Run",
        "Warn",
        `讀取 manifest 失敗，路徑：${displayPath}，錯誤：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }
}

function readPluginManifest(installPath: string): PluginManifest | null {
  return readManifest(path.join(installPath, ".claude-plugin", "plugin.json"));
}

/** 掃描 Claude 來源（~/.claude/plugins/installed_plugins.json） */
function scanClaudeInstalledPlugins(): InstalledPlugin[] {
  let fileContent: string;

  try {
    fileContent = fs.readFileSync(INSTALLED_PLUGINS_PATH, "utf-8");
  } catch {
    return [];
  }

  let data: InstalledPluginsFile;

  try {
    data = JSON.parse(fileContent) as InstalledPluginsFile;
  } catch {
    return [];
  }

  if (data.version !== 2 || !data.plugins || typeof data.plugins !== "object") {
    return [];
  }

  const seenPaths = new Set<string>();
  const result: InstalledPlugin[] = [];

  // resolveClaudePluginsRoot 提到迴圈外，整次掃描共用一份，避免重複呼叫
  const claudePluginsRoot = resolveClaudePluginsRoot();

  for (const [pluginId, entries] of Object.entries(data.plugins)) {
    if (!Array.isArray(entries)) continue;

    if (!PLUGIN_ID_PATTERN.test(pluginId)) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.installPath || seenPaths.has(entry.installPath)) continue;

      // 驗證 installPath 必須在允許的 Claude plugins 目錄內，防止惡意路徑注入
      if (!isPathWithinDirectory(entry.installPath, claudePluginsRoot)) {
        logger.warn(
          "Run",
          "Warn",
          `略過不在允許路徑範圍內的 Claude plugin installPath（pluginId 已遮罩）`,
        );
        continue;
      }

      seenPaths.add(entry.installPath);

      // Claude 來源固定為 ["claude"]，不偵測跨 provider manifest
      const manifest = readPluginManifest(entry.installPath);
      const atIndex = pluginId.indexOf("@");
      const repo = atIndex !== -1 ? pluginId.substring(atIndex + 1) : "";

      result.push({
        id: pluginId,
        name: manifest?.name ?? pluginId,
        version: manifest?.version ?? entry.version ?? "",
        description: manifest?.description ?? "",
        installPath: entry.installPath,
        repo,
        compatibleProviders: ["claude"],
      });
    }
  }

  return result;
}

/**
 * 從 pluginDir 內所有 version 子目錄中，選出字典序最大（最新）的合法 version 目錄路徑。
 * 回傳 { latestVersion, installPath }；若無合法版本目錄則回傳 null。
 *
 * 使用 readdirSync withFileTypes 直接透過 dirent.isDirectory() 過濾，
 * 避免對每個 entry 額外呼叫 statSync。
 *
 * @warning 僅適用於固定格式版本號（單位數版號）。
 *   跨多位數版本（例如 1.10.0 vs 1.9.0）排序會錯，因為使用字典序（.sort()）而非語意版號比較。
 *   若未來需支援多位數版號，應引入 semver 比較邏輯。
 */
function resolveLatestVersion(
  pluginDir: string,
): { latestVersion: string; installPath: string } | null {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(pluginDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const validVersions = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (validVersions.length === 0) return null;

  const latestVersion = validVersions.sort().at(-1)!;
  return { latestVersion, installPath: path.join(pluginDir, latestVersion) };
}

/**
 * 解析單一 Codex plugin 目錄，回傳 InstalledPlugin 或 null（不合法時）。
 * 負責：plugin id 驗證、版本選擇、manifest 讀取、compatibleProviders 組合。
 */
function scanCodexPlugin(
  marketplaceName: string,
  pluginName: string,
  pluginDir: string,
): InstalledPlugin | null {
  const pluginId = `${pluginName}@${marketplaceName}`;

  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    return null;
  }

  const resolved = resolveLatestVersion(pluginDir);
  if (!resolved) return null;

  const { latestVersion, installPath } = resolved;

  // Codex 來源必須有 .codex-plugin/plugin.json 才視為合法
  const codexManifest = readManifest(
    path.join(installPath, ".codex-plugin", "plugin.json"),
  );
  if (!codexManifest) return null;

  // Codex 來源固定為 ["codex"]，不偵測跨 provider manifest
  return {
    id: pluginId,
    name: codexManifest.name ?? pluginId,
    version: codexManifest.version ?? latestVersion,
    description: codexManifest.description ?? "",
    installPath,
    repo: marketplaceName,
    compatibleProviders: ["codex"],
  };
}

/** 掃描 Codex 來源（~/.codex/plugins/cache/<marketplaceName>/<pluginName>/<version>/） */
function scanCodexInstalledPlugins(): InstalledPlugin[] {
  const result: InstalledPlugin[] = [];

  // 掃 marketplaces
  let marketplaceDirs: string[];
  try {
    marketplaceDirs = fs.readdirSync(CODEX_PLUGINS_CACHE_DIR);
  } catch {
    // 目錄不存在時靜默回空
    return [];
  }

  for (const marketplaceName of marketplaceDirs) {
    const marketplaceDir = path.join(CODEX_PLUGINS_CACHE_DIR, marketplaceName);

    // 掃該 marketplace 底下的 plugins
    let pluginDirents: fs.Dirent[];
    try {
      pluginDirents = fs.readdirSync(marketplaceDir, { withFileTypes: true });
    } catch {
      continue;
    }

    // 對每個 plugin 解析資料（僅處理目錄，略過檔案）
    for (const dirent of pluginDirents) {
      if (!dirent.isDirectory()) continue;
      const pluginName = dirent.name;
      const pluginDir = path.join(marketplaceDir, pluginName);
      const plugin = scanCodexPlugin(marketplaceName, pluginName, pluginDir);
      if (plugin) result.push(plugin);
    }
  }

  return result;
}

/** 合併 N 個來源結果，以 id 為 key 去重；同 id 出現多次時合併 compatibleProviders */
function mergePlugins(...sources: InstalledPlugin[][]): InstalledPlugin[] {
  const map = new Map<string, InstalledPlugin>();

  for (const plugins of sources) {
    for (const plugin of plugins) {
      const existing = map.get(plugin.id);
      if (existing) {
        // 合併 compatibleProviders，去除重複
        const merged = Array.from(
          new Set([
            ...existing.compatibleProviders,
            ...plugin.compatibleProviders,
          ]),
        ) as ("claude" | "codex")[];
        map.set(plugin.id, { ...existing, compatibleProviders: merged });
      } else {
        map.set(plugin.id, plugin);
      }
    }
  }

  return Array.from(map.values());
}

// 支援 plugin 的 provider 集合：未列入此集合的 provider 一律回傳空陣列
export const PLUGIN_SUPPORTED_PROVIDERS = new Set<string>([
  "claude",
  "codex",
]);

/**
 * 取得單一來源的掃描結果（套用 30 秒 TTL 快取）。
 * 來源 key 為 "claude" / "codex"，僅代表「掃描入口」，
 * 不代表回傳結果中 plugin 的 compatibleProviders 限制。
 */
function getSourcePlugins(source: PluginSource): InstalledPlugin[] {
  const now = Date.now();
  const cached = pluginCache.get(source);
  if (cached && now < cached.expiresAt) {
    return cached.plugins;
  }

  let plugins: InstalledPlugin[];
  if (source === "claude") {
    plugins = scanClaudeInstalledPlugins();
  } else {
    plugins = scanCodexInstalledPlugins();
  }

  pluginCache.set(source, { plugins, expiresAt: now + CACHE_TTL_MS });
  return plugins;
}

export function scanInstalledPlugins(provider?: string): InstalledPlugin[] {
  // 不支援 plugin 的 provider 直接回傳空陣列，避免在後續邏輯誤判
  if (provider !== undefined && !PLUGIN_SUPPORTED_PROVIDERS.has(provider)) {
    return [];
  }

  // 全集：合併所有來源（per-source 快取由 getSourcePlugins 負責）
  const merged = mergePlugins(
    getSourcePlugins("claude"),
    getSourcePlugins("codex"),
  );

  if (provider === undefined) {
    return merged;
  }

  // 指定 provider：以 compatibleProviders 過濾全集，
  // 確保「裝在 Codex cache 但同時宣告相容 claude」的 plugin 也會被列入 claude 結果。
  return merged.filter((plugin) =>
    plugin.compatibleProviders.includes(
      provider as "claude" | "codex",
    ),
  );
}
