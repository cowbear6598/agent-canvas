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
