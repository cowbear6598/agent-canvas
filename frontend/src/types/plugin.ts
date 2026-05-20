export interface InstalledPlugin {
  id: string;
  githubRepo: string;
  displayName: string;
  description?: string;
  installPath: string;
  installedAt: string;
  updatedAt: string;
}
