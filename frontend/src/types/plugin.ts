export interface InstalledPlugin {
  id: string;
  githubRepo: string;
  displayName: string;
  description?: string;
  installPath: string;
  sortIndex: number;
  installedAt: string;
  updatedAt: string;
}
