import {
  isCodexSystemSkillPath,
  readCodexSkills,
  type CodexSkillMetadata,
} from "./codexSkillReader.js";
import { resolveCodexPluginSource } from "./codexPluginCacheReader.js";

export type CodexSkillScope = "user" | "repo" | "system" | "admin";
export type CodexSkillOrigin = "official" | "custom";

export interface CodexSkillAvailabilityItem {
  key: string;
  name: string;
  description: string;
  shortDescription?: string;
  scope: CodexSkillScope;
  origin: CodexSkillOrigin;
  globallyEnabled: boolean;
}

export interface CodexSkillRuntimeEntry {
  key: string;
  path: string;
  globallyEnabled: boolean;
}

type SkillLoader = (
  cwd: string,
  forceReload: boolean,
) => Promise<CodexSkillMetadata[]>;

export function buildCodexSkillKey(
  skill: Pick<CodexSkillMetadata, "scope" | "name">,
): string {
  return `${skill.scope}:${skill.name}`;
}

export function resolveCodexSkillOrigin(path: string): CodexSkillOrigin {
  if (
    isCodexSystemSkillPath(path) ||
    resolveCodexPluginSource(path) === "official"
  ) {
    return "official";
  }
  return "custom";
}

export class CodexSkillService {
  constructor(private readonly loadSkills: SkillLoader = readCodexSkills) {}

  async list(
    cwd: string,
    forceReload = false,
  ): Promise<{
    items: CodexSkillAvailabilityItem[];
    runtimeEntries: CodexSkillRuntimeEntry[];
  }> {
    const skills = await this.loadSkills(cwd, forceReload);
    const seen = new Set<string>();
    const items: CodexSkillAvailabilityItem[] = [];
    const runtimeEntries: CodexSkillRuntimeEntry[] = [];

    for (const skill of skills) {
      const key = buildCodexSkillKey(skill);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        name: skill.name,
        description: skill.description,
        ...(skill.shortDescription
          ? { shortDescription: skill.shortDescription }
          : {}),
        scope: skill.scope,
        origin: resolveCodexSkillOrigin(skill.path),
        globallyEnabled: skill.enabled,
      });
      runtimeEntries.push({
        key,
        path: skill.path,
        globallyEnabled: skill.enabled,
      });
    }

    return { items, runtimeEntries };
  }

  resolveSelectedKeys(
    currentKeys: readonly string[],
    initialized: boolean,
    entries: readonly CodexSkillRuntimeEntry[],
  ): string[] {
    if (!initialized) return [];
    const selectableKeys = new Set(
      entries
        .filter((entry) => entry.globallyEnabled)
        .map((entry) => entry.key),
    );
    return [...new Set(currentKeys)].filter((key) => selectableKeys.has(key));
  }

  buildRuntimeConfigArgs(
    selectedKeys: readonly string[],
    entries: readonly CodexSkillRuntimeEntry[],
  ): string[] {
    if (entries.length === 0) return [];
    const selected = new Set(selectedKeys);
    const config = entries.map(
      (entry) =>
        `{path=${JSON.stringify(entry.path)},enabled=${
          entry.globallyEnabled && selected.has(entry.key)
        }}`,
    );
    return ["-c", `skills.config=[${config.join(",")}]`];
  }
}

export const codexSkillService = new CodexSkillService();
