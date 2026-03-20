import fs from "fs";
import os from "os";
import path from "path";

const INSTALLED_PLUGINS_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json",
);

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  installPath: string;
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

    for (const entry of entries) {
      if (!entry.installPath || seenPaths.has(entry.installPath)) continue;

      seenPaths.add(entry.installPath);

      const manifest = readPluginManifest(entry.installPath);

      result.push({
        id: pluginId,
        name: manifest?.name ?? pluginId,
        version: manifest?.version ?? entry.version ?? "",
        description: manifest?.description ?? "",
        installPath: entry.installPath,
      });
    }
  }

  return result;
}
