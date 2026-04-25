export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  repo: string;
  compatibleProviders: ("claude" | "codex")[];
}
