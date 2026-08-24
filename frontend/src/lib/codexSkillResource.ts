import type {
  CodexSkillAvailabilityItem,
  CodexSkillOrigin,
} from "@/types/codexSkill";

export interface CodexSkillResource {
  id: string;
  label: string;
  origin: CodexSkillOrigin;
  items: CodexSkillAvailabilityItem[];
}

interface CodexSkillResourceIdentity {
  id: string;
  label: string;
}

const getPluginName = (name: string): string | null => {
  const separatorIndex = name.indexOf(":");
  return separatorIndex > 0 ? name.slice(0, separatorIndex) : null;
};

const getResourceIdentity = (
  skill: Pick<CodexSkillAvailabilityItem, "key" | "name" | "origin">,
): CodexSkillResourceIdentity => {
  const pluginName = getPluginName(skill.name);
  if (pluginName !== null) {
    return {
      id: `${skill.origin}:plugin:${pluginName}`,
      label: pluginName,
    };
  }

  return {
    id: `${skill.origin}:skill:${skill.key}`,
    label: skill.name,
  };
};

export const groupCodexSkillResources = (
  skills: CodexSkillAvailabilityItem[],
): CodexSkillResource[] => {
  const resources = new Map<string, CodexSkillResource>();

  for (const skill of skills) {
    const identity = getResourceIdentity(skill);
    const existing = resources.get(identity.id);
    if (existing) {
      existing.items.push(skill);
      continue;
    }

    resources.set(identity.id, {
      ...identity,
      origin: skill.origin,
      items: [skill],
    });
  }

  return [...resources.values()];
};

export const countSelectedCodexSkillResources = (keys: string[]): number => {
  const resourceIds = new Set<string>();

  for (const key of keys) {
    const scopeSeparatorIndex = key.indexOf(":");
    const name =
      scopeSeparatorIndex >= 0 ? key.slice(scopeSeparatorIndex + 1) : key;
    const pluginName = getPluginName(name);

    resourceIds.add(
      pluginName === null ? `skill:${key}` : `plugin:${pluginName}`,
    );
  }

  return resourceIds.size;
};
