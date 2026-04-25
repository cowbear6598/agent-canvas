import fs from "fs";
import os from "os";
import path from "path";

const INSTALLED_PLUGINS_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json",
);

// 5 秒 TTL 快取，避免每次 buildClaudeOptions 都重讀磁碟
const CACHE_TTL_MS = 5000;
let cachedPlugins: InstalledPlugin[] | null = null;
let cacheExpiresAt = 0;

/** 僅供測試使用：清除快取，讓下一次呼叫重新讀檔 */
export function clearScanInstalledPluginsCache(): void {
  cachedPlugins = null;
  cacheExpiresAt = 0;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  installPath: string;
  repo: string;
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

function readPluginManifest(installPath: string): PluginManifest | null {
  const manifestPath = path.join(installPath, ".claude-plugin", "plugin.json");

  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as PluginManifest;
  } catch {
    return null;
  }
}

export function scanInstalledPlugins(): InstalledPlugin[] {
  const now = Date.now();
  if (cachedPlugins !== null && now < cacheExpiresAt) {
    return cachedPlugins;
  }

  let fileContent: string;

  try {
    fileContent = fs.readFileSync(INSTALLED_PLUGINS_PATH, "utf-8");
  } catch {
    cachedPlugins = [];
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedPlugins;
  }

  let data: InstalledPluginsFile;

  try {
    data = JSON.parse(fileContent) as InstalledPluginsFile;
  } catch {
    cachedPlugins = [];
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedPlugins;
  }

  if (data.version !== 2 || !data.plugins || typeof data.plugins !== "object") {
    cachedPlugins = [];
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedPlugins;
  }

  const seenPaths = new Set<string>();
  const result: InstalledPlugin[] = [];

  for (const [pluginId, entries] of Object.entries(data.plugins)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!entry.installPath || seenPaths.has(entry.installPath)) continue;

      seenPaths.add(entry.installPath);

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
      });
    }
  }

  cachedPlugins = result;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedPlugins;
}
