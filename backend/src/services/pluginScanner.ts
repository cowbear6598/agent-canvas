import fs from "fs";
import os from "os";
import path from "path";

const INSTALLED_PLUGINS_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json",
);

const CODEX_PLUGINS_CACHE_DIR = path.join(
  os.homedir(),
  ".codex",
  "plugins",
  "cache",
);

// 5 秒 TTL 快取，避免每次 buildClaudeOptions 都重讀磁碟
// 快取保存全集（不分 provider），provider 過濾在取值後做，避免快取碎片化
const CACHE_TTL_MS = 5000;
let cachedPlugins: InstalledPlugin[] | null = null;
let cacheExpiresAt = 0;

/** 僅供測試使用：清除快取，讓下一次呼叫重新讀檔 */
export function clearScanInstalledPluginsCache(): void {
  cachedPlugins = null;
  cacheExpiresAt = 0;
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
  } catch {
    return null;
  }
}

function readPluginManifest(installPath: string): PluginManifest | null {
  return readManifest(path.join(installPath, ".claude-plugin", "plugin.json"));
}

/** 偵測 installPath 下有哪些 provider 的 plugin.json 存在 */
function detectCompatibleProviders(
  installPath: string,
): ("claude" | "codex")[] {
  const providers: ("claude" | "codex")[] = [];
  if (readManifest(path.join(installPath, ".claude-plugin", "plugin.json"))) {
    providers.push("claude");
  }
  if (readManifest(path.join(installPath, ".codex-plugin", "plugin.json"))) {
    providers.push("codex");
  }
  return providers;
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

  for (const [pluginId, entries] of Object.entries(data.plugins)) {
    if (!Array.isArray(entries)) continue;

    if (!PLUGIN_ID_PATTERN.test(pluginId)) {
      console.warn(`[pluginScanner] 略過不合法的 plugin id：${pluginId}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.installPath || seenPaths.has(entry.installPath)) continue;

      seenPaths.add(entry.installPath);

      const manifest = readPluginManifest(entry.installPath);
      const atIndex = pluginId.indexOf("@");
      const repo = atIndex !== -1 ? pluginId.substring(atIndex + 1) : "";
      const compatibleProviders = detectCompatibleProviders(entry.installPath);

      // Claude 來源至少包含 claude（installed_plugins.json 有記錄即代表已安裝 Claude plugin）
      if (!compatibleProviders.includes("claude")) {
        compatibleProviders.unshift("claude");
      }

      result.push({
        id: pluginId,
        name: manifest?.name ?? pluginId,
        version: manifest?.version ?? entry.version ?? "",
        description: manifest?.description ?? "",
        installPath: entry.installPath,
        repo,
        compatibleProviders,
      });
    }
  }

  return result;
}

/** 掃描 Codex 來源（~/.codex/plugins/cache/<marketplaceName>/<pluginName>/<version>/） */
function scanCodexInstalledPlugins(): InstalledPlugin[] {
  const result: InstalledPlugin[] = [];

  let marketplaceDirs: string[];
  try {
    marketplaceDirs = fs.readdirSync(CODEX_PLUGINS_CACHE_DIR);
  } catch {
    // 目錄不存在時靜默回空
    return [];
  }

  for (const marketplaceName of marketplaceDirs) {
    const marketplaceDir = path.join(CODEX_PLUGINS_CACHE_DIR, marketplaceName);

    let pluginDirs: string[];
    try {
      const stat = fs.statSync(marketplaceDir);
      if (!stat.isDirectory()) continue;
      pluginDirs = fs.readdirSync(marketplaceDir);
    } catch {
      continue;
    }

    for (const pluginName of pluginDirs) {
      const pluginId = `${pluginName}@${marketplaceName}`;

      if (!PLUGIN_ID_PATTERN.test(pluginId)) {
        console.warn(
          `[pluginScanner] 略過不合法的 codex plugin id：${pluginId}`,
        );
        continue;
      }

      const pluginDir = path.join(marketplaceDir, pluginName);

      let versionDirs: string[];
      try {
        const stat = fs.statSync(pluginDir);
        if (!stat.isDirectory()) continue;
        versionDirs = fs.readdirSync(pluginDir);
      } catch {
        continue;
      }

      // 取字典序最大的 version 目錄
      const validVersions = versionDirs.filter((v) => {
        try {
          return fs.statSync(path.join(pluginDir, v)).isDirectory();
        } catch {
          return false;
        }
      });

      if (validVersions.length === 0) continue;

      const latestVersion = validVersions.sort().at(-1)!;
      const installPath = path.join(pluginDir, latestVersion);

      // Codex 來源必須有 .codex-plugin/plugin.json 才視為合法
      const codexManifest = readManifest(
        path.join(installPath, ".codex-plugin", "plugin.json"),
      );
      if (!codexManifest) continue;

      const compatibleProviders: ("claude" | "codex")[] = ["codex"];
      const claudeManifest = readManifest(
        path.join(installPath, ".claude-plugin", "plugin.json"),
      );
      if (claudeManifest) {
        compatibleProviders.push("claude");
      }

      // 優先使用 claude manifest 的 name/description（若有），否則 codex manifest
      const manifest = claudeManifest ?? codexManifest;

      result.push({
        id: pluginId,
        name: manifest.name ?? pluginId,
        version: codexManifest.version ?? latestVersion,
        description: manifest.description ?? "",
        installPath,
        repo: marketplaceName,
        compatibleProviders,
      });
    }
  }

  return result;
}

/** 合併兩來源結果，以 id 為 key 去重；同 id 兩邊都有時合併 compatibleProviders */
function mergePlugins(
  claudePlugins: InstalledPlugin[],
  codexPlugins: InstalledPlugin[],
): InstalledPlugin[] {
  const map = new Map<string, InstalledPlugin>();

  for (const plugin of claudePlugins) {
    map.set(plugin.id, plugin);
  }

  for (const plugin of codexPlugins) {
    const existing = map.get(plugin.id);
    if (existing) {
      // 合併 compatibleProviders，去除重複
      const merged = Array.from(
        new Set([
          ...existing.compatibleProviders,
          ...plugin.compatibleProviders,
        ]),
      );
      map.set(plugin.id, { ...existing, compatibleProviders: merged });
    } else {
      map.set(plugin.id, plugin);
    }
  }

  return Array.from(map.values());
}

export function scanInstalledPlugins(
  provider?: "claude" | "codex",
): InstalledPlugin[] {
  const now = Date.now();
  if (cachedPlugins !== null && now < cacheExpiresAt) {
    // 快取命中：provider 過濾在此做
    if (provider) {
      return cachedPlugins.filter((p) =>
        p.compatibleProviders.includes(provider),
      );
    }
    return cachedPlugins;
  }

  // 重新掃描全集並快取
  const claudePlugins = scanClaudeInstalledPlugins();
  const codexPlugins = scanCodexInstalledPlugins();
  cachedPlugins = mergePlugins(claudePlugins, codexPlugins);
  cacheExpiresAt = now + CACHE_TTL_MS;

  if (provider) {
    return cachedPlugins.filter((p) =>
      p.compatibleProviders.includes(provider),
    );
  }
  return cachedPlugins;
}
