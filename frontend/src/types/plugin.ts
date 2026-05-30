export type InstalledPluginSourceType = "github" | "upload";

export interface InstalledPluginSource {
  type: InstalledPluginSourceType;
  ref: string;
}

export interface InstalledPlugin {
  id: string;
  source: InstalledPluginSource;
  displayName: string;
  description?: string;
  installPath: string;
  sortIndex: number;
  installedAt: string;
  updatedAt: string;
}

export function getInstalledPluginSourceLabel(
  source: InstalledPluginSource,
): string {
  return source.type === "github" ? "GitHub" : "本地上傳";
}
